"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents } from "@/db/schema";
import { assertCan, requireCompany } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { D } from "@/engines/core";
import { accountByRole, postVoucher } from "@/services/posting";
import type { FormState } from "./auth";

export async function uploadDocument(_previous: FormState, _formData: FormData): Promise<FormState> {
  return {
    error: "Document uploads are disabled until this form uses configured secure storage and antivirus scanning.",
  };
}

export async function confirmFields(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const [d] = await db.select().from(documents).where(and(eq(documents.id, String(fd.get("id"))), eq(documents.companyId, ctx.company.id)));
    if (!d) return { error: "Document not found." };
    const keys = ["invoiceNumber", "date", "gstin", "pan", "taxable", "cgst", "sgst", "igst", "total"]; const fields: Record<string, string> = {};
    for (const k of keys) fields[k] = String(fd.get(k) ?? "").trim();
    for (const k of ["taxable", "cgst", "sgst", "igst", "total"]) if (fields[k] && isNaN(Number(fields[k]))) return { error: `${k} must be numeric.` };
    await db.update(documents).set({ extracted: { ...(d.extracted as object), fields, confirmedBy: ctx.user.id, confirmedAt: new Date().toISOString() }, status: "confirmed", docType: String(fd.get("docType") || d.docType) }).where(eq(documents.id, d.id));
    await audit(ctx, "document.confirm", "document", d.id, fields); revalidatePath("/documents"); return { ok: "Fields confirmed by you. You may now post to the books." };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function postDocument(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "approve");
    if (fd.get("verified") !== "on") return { error: "Tick the confirmation: a human must verify extracted values before posting." };
    const [d] = await db.select().from(documents).where(and(eq(documents.id, String(fd.get("id"))), eq(documents.companyId, ctx.company.id)));
    if (!d || d.status !== "confirmed") return { error: "Confirm the extracted fields first." };
    const f = (d.extracted as { fields: Record<string, string> }).fields; const total = D(f.total || 0);
    if (total.lte(0)) return { error: "Confirmed total must be positive." };
    const [exp] = await db.select().from(accounts).where(and(eq(accounts.id, String(fd.get("expenseId"))), eq(accounts.companyId, ctx.company.id)));
    const [cr] = await db.select().from(accounts).where(and(eq(accounts.id, String(fd.get("creditId"))), eq(accounts.companyId, ctx.company.id)));
    if (!exp || !cr) return { error: "Choose both ledgers." };
    const date = (f.date.match(/^\d{4}-\d{2}-\d{2}$/) ? f.date : String(fd.get("date"))) || new Date().toISOString().slice(0, 10);
    const cg = D(f.cgst || 0), sg = D(f.sgst || 0), ig = D(f.igst || 0); const base = total.minus(cg).minus(sg).minus(ig);
    const lines = [{ accountId: exp.id, debit: base.toFixed(2), credit: 0 }] as { accountId: string; debit: string | number; credit: string | number }[];
    for (const [amt, role] of [[cg, "input_cgst"], [sg, "input_sgst"], [ig, "input_igst"]] as const) if (amt.gt(0)) { const a = await accountByRole(ctx.company.id, role); if (a) lines.push({ accountId: a.id, debit: amt.toFixed(2), credit: 0 }); }
    lines.push({ accountId: cr.id, debit: 0, credit: total.toFixed(2) });
    const v = await postVoucher(ctx, { type: "purchase", date, narration: `From document ${d.name} (${f.invoiceNumber || "no number"}) — human-confirmed`, lines, source: "document" });
    await db.update(documents).set({ status: "posted", voucherId: v.id }).where(eq(documents.id, d.id));
    await audit(ctx, "document.post", "document", d.id, { voucher: v.number }); revalidatePath("/documents"); revalidatePath("/dashboard");
    return { ok: `Posted ${v.number}.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function deleteDocument(id: string) {
  const ctx = await requireCompany(); assertCan(ctx, "approve");
  await db.update(documents).set({ deletedAt: new Date() }).where(and(eq(documents.id, id), eq(documents.companyId, ctx.company.id)));
  await audit(ctx, "document.delete", "document", id); revalidatePath("/documents");
}
