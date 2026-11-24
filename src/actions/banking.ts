"use server";
import { revalidatePath } from "next/cache";
import { and, between, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts, bankTransactions, voucherLines, vouchers, accounts } from "@/db/schema";
import { assertCan, requireCompany } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/auth";
import { D } from "@/engines/core";
import { extractText, parseCsv, validateUpload } from "@/services/extract";
import { accountByRole, postVoucher } from "@/services/posting";
import type { FormState } from "./auth";

const fail = (e: unknown): FormState => ({ error: (e as Error).message });
import { parseDate, categorise, num } from "@/services/bankparse";

export async function addBankAccount(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const name = String(fd.get("name") ?? "").trim(); if (name.length < 2) return { error: "Enter an account name." };
    const ledger = await accountByRole(ctx.company.id, "bank");
    await db.insert(bankAccounts).values({ companyId: ctx.company.id, name, bankName: String(fd.get("bankName") ?? ""), last4: String(fd.get("last4") ?? "").slice(-4), ledgerAccountId: String(fd.get("ledger") || ledger?.id) });
    await audit(ctx, "bank.add", "bank_account", name); revalidatePath("/banking"); return { ok: "Bank account added. Only the last 4 digits are stored; credentials are never requested." };
  } catch (e) { return fail(e); }
}

export async function importStatement(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const [acct] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, String(fd.get("bankAccountId"))), eq(bankAccounts.companyId, ctx.company.id)));
    const f = fd.get("file"); if (!acct) return { error: "Select a bank account." };
    if (!(f instanceof File) || !f.size) return { error: "Choose a CSV or Excel statement." };
    const buf = Buffer.from(await f.arrayBuffer()); const err = validateUpload(f.name, f.type, f.size, buf); if (err) return { error: err };
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg") return { error: "Structured import supports CSV and Excel. PDF/image statements need an OCR/table-extraction provider, which is not configured — export your statement as CSV/XLSX from net-banking." };
    const text = (await extractText(buf, f.name)).text; const rows = parseCsv(text.split("\n").filter((l) => !l.startsWith("## ")).join("\n"));
    if (rows.length < 2) return { error: "No data rows found." };
    const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /(narration|description|particulars|details|remarks)/i.test(c)));
    if (hi < 0) return { error: "Could not find a header row with Date and Narration/Description columns." };
    const h = rows[hi].map((c) => c.toLowerCase().trim()); const col = (re: RegExp) => h.findIndex((c) => re.test(c));
    const ci = { date: col(/date/), desc: col(/narration|description|particulars|details|remarks/), dr: col(/debit|withdrawal|dr\b/), cr: col(/credit|deposit|cr\b/), amt: col(/^amount/), type: col(/type|dr\/cr/) };
    const batch = `b${Date.now()}`; const seen = new Map<string, number>(); const out: (typeof bankTransactions.$inferInsert)[] = []; let skipped = 0;
    for (const r of rows.slice(hi + 1)) {
      const date = parseDate(r[ci.date] ?? ""); if (!date) { skipped++; continue; }
      let debit = ci.dr >= 0 ? num(r[ci.dr]) : 0, credit = ci.cr >= 0 ? num(r[ci.cr]) : 0;
      if (ci.amt >= 0 && !debit && !credit) { const a = num(r[ci.amt]); const t = (r[ci.type] ?? "").toLowerCase(); if (a < 0 || /dr|debit|withdraw/.test(t)) debit = Math.abs(a); else credit = Math.abs(a); }
      if (!debit && !credit) { skipped++; continue; }
      const description = (r[ci.desc] ?? "").trim().slice(0, 300);
      const base = sha256(`${acct.id}|${date}|${description}|${debit}|${credit}`); const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
      out.push({ bankAccountId: acct.id, companyId: ctx.company.id, date, description, debit: D(debit).toFixed(2), credit: D(credit).toFixed(2), category: categorise(description), hash: `${base}:${k}`, batch });
    }
    if (!out.length) return { error: "No valid transactions parsed." };
    const existing = new Set((await db.select({ h: bankTransactions.hash }).from(bankTransactions).where(eq(bankTransactions.bankAccountId, acct.id))).map((x) => x.h));
    let dups = 0; for (const o of out) if (existing.has(o.hash)) { o.status = "duplicate"; dups++; }
    await db.insert(bankTransactions).values(out); await audit(ctx, "bank.import", "bank_account", acct.id, { rows: out.length, dups, file: f.name });
    revalidatePath("/banking"); return { ok: `Imported ${out.length} transactions (${dups} flagged duplicate, ${skipped} unreadable rows skipped). Categories were assigned by keyword rules — review them.` };
  } catch (e) { return fail(e); }
}

export async function autoReconcile(bankAccountId: string) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  const [acct] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, ctx.company.id)));
  if (!acct?.ledgerAccountId) throw new Error("Bank account has no linked ledger.");
  const txns = await db.select().from(bankTransactions).where(and(eq(bankTransactions.bankAccountId, bankAccountId), eq(bankTransactions.status, "unmatched")));
  const used = new Set((await db.select({ v: bankTransactions.matchedVoucherId }).from(bankTransactions).where(eq(bankTransactions.bankAccountId, bankAccountId))).map((x) => x.v).filter(Boolean) as string[]);
  let matched = 0;
  for (const t of txns) {
    const isDebit = D(t.debit).gt(0); const amt = isDebit ? t.debit : t.credit;
    const d = new Date(t.date + "T00:00:00Z"); const lo = new Date(d.getTime() - 3 * 86400000).toISOString().slice(0, 10), hi = new Date(d.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const cands = await db.select({ vid: vouchers.id }).from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt))).where(and(eq(voucherLines.accountId, acct.ledgerAccountId), eq(isDebit ? voucherLines.credit : voucherLines.debit, amt), between(vouchers.date, lo, hi)));
    const pick = cands.find((c) => !used.has(c.vid)); if (!pick) continue;
    used.add(pick.vid); await db.update(bankTransactions).set({ status: "matched", matchedVoucherId: pick.vid }).where(eq(bankTransactions.id, t.id)); matched++;
  }
  await audit(ctx, "bank.reconcile", "bank_account", bankAccountId, { matched, scanned: txns.length }); revalidatePath("/banking");
}

export async function postFromTxn(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "approve");
    const [t] = await db.select().from(bankTransactions).where(and(eq(bankTransactions.id, String(fd.get("txnId"))), eq(bankTransactions.companyId, ctx.company.id)));
    const [other] = await db.select().from(accounts).where(and(eq(accounts.id, String(fd.get("accountId"))), eq(accounts.companyId, ctx.company.id)));
    if (!t || !other) return { error: "Select an unmatched transaction and a counter-ledger." };
    if (t.status !== "unmatched") return { error: "Transaction is not unmatched." };
    const [ba] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, t.bankAccountId)); if (!ba.ledgerAccountId) return { error: "Bank account has no linked ledger." };
    const isDebit = D(t.debit).gt(0); const amt = isDebit ? t.debit : t.credit;
    const v = await postVoucher(ctx, { type: isDebit ? "payment" : "receipt", date: t.date, narration: `Bank: ${t.description}`, source: "bank", lines: isDebit ? [{ accountId: other.id, debit: amt, credit: 0 }, { accountId: ba.ledgerAccountId, debit: 0, credit: amt }] : [{ accountId: ba.ledgerAccountId, debit: amt, credit: 0 }, { accountId: other.id, debit: 0, credit: amt }] });
    await db.update(bankTransactions).set({ status: "posted", matchedVoucherId: v.id }).where(eq(bankTransactions.id, t.id)); revalidatePath("/banking"); revalidatePath("/dashboard");
    return { ok: `Posted ${v.number} and matched.` };
  } catch (e) { return fail(e); }
}
export async function setTxnStatus(id: string, status: "ignored" | "unmatched") {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  await db.update(bankTransactions).set({ status, matchedVoucherId: null }).where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, ctx.company.id))); revalidatePath("/banking");
}
void sql;
