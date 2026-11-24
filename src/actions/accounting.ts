"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, costCentres, financialYears, fixedAssets, inventoryItems, voucherLines, vouchers } from "@/db/schema";
import { requireCompany, assertCan, type CompanyCtx } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { postVoucher, accountByRole } from "@/services/posting";
import { loadStatements } from "@/services/finance";
import { depreciationForYear, reversalLines, VOUCHER_TYPES } from "@/engines/accounting";
import { D } from "@/engines/core";
import { seedDemoData } from "@/services/demo";
import { recordInventoryMovement } from "@/services/inventory";
import type { FormState } from "./auth";

const fail = (e: unknown): FormState => ({ error: (e as Error).message });
const guard = async (perm: "write" | "approve" | "admin" = "write") => { const ctx = await requireCompany(); assertCan(ctx, perm); return ctx; };

const voucherSchema = z.object({
  type: z.enum(VOUCHER_TYPES), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), narration: z.string().max(500), currency: z.string().length(3).default("INR"), fxRate: z.string().default("1"),
  lines: z.array(z.object({ accountId: z.string().uuid(), debit: z.string(), credit: z.string(), costCentreId: z.string().uuid().nullable().optional(), narration: z.string().max(200).optional() })).min(2).max(60),
});

export async function createVoucher(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const p = voucherSchema.safeParse(JSON.parse(String(fd.get("payload") ?? "{}")));
    if (!p.success) return { error: p.error.issues[0].message };
    const v = await postVoucher(ctx, { ...p.data, lines: p.data.lines.map((l) => ({ ...l, debit: l.debit || "0", credit: l.credit || "0" })) });
    revalidatePath("/accounting"); revalidatePath("/dashboard");
    return { ok: `Posted ${v.number} dated ${v.date}.` };
  } catch (e) { return fail(e); }
}

export async function reverseVoucher(id: string) {
  const ctx = await guard("approve");
  const [v] = await db.select().from(vouchers).where(and(eq(vouchers.id, id), eq(vouchers.companyId, ctx.company.id)));
  if (!v || v.status !== "posted") throw new Error("Voucher not found or already reversed.");
  if (v.reversalOf) throw new Error("A reversal voucher cannot itself be reversed; post a fresh entry.");
  const lines = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, id));
  const today = new Date().toISOString().slice(0, 10);
  const date = today >= ctx.fy.startDate && today <= ctx.fy.endDate ? today : v.date;
  const r = await postVoucher(ctx, { type: "journal", date, narration: `Reversal of ${v.number}: ${v.narration}`, lines: reversalLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, partyId: l.partyId }))), source: "manual", reversalOf: v.id });
  await db.update(vouchers).set({ status: "reversed" }).where(eq(vouchers.id, id));
  await audit(ctx, "voucher.reverse", "voucher", id, { reversal: r.number });
  revalidatePath("/accounting"); revalidatePath("/dashboard");
}

export async function createAccount(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const p = z.object({ code: z.string().trim().min(2).max(12), name: z.string().trim().min(2).max(80), type: z.enum(["asset", "liability", "equity", "income", "expense"]), role: z.string().max(30).default("other"), groupName: z.string().max(60).default("") }).parse(Object.fromEntries(fd));
    await db.insert(accounts).values({ ...p, companyId: ctx.company.id });
    await audit(ctx, "account.create", "account", p.code, p);
    revalidatePath("/accounting");
    return { ok: `Ledger ${p.code} ${p.name} created.` };
  } catch (e) { return fail(String((e as Error).message).includes("accounts_company_code") ? new Error("Account code already exists.") : e); }
}
export async function setOpeningBalance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard("approve");
    const amt = D(String(fd.get("amount") ?? "0")); const side = String(fd.get("side"));
    const signed = side === "cr" ? amt.neg() : amt;
    const [a] = await db.select().from(accounts).where(and(eq(accounts.id, String(fd.get("accountId")), ), eq(accounts.companyId, ctx.company.id)));
    if (!a) return { error: "Account not found." };
    await db.update(accounts).set({ openingBalance: signed.toFixed(2) }).where(eq(accounts.id, a.id));
    await audit(ctx, "account.opening", "account", a.id, { before: a.openingBalance, after: signed.toFixed(2) });
    revalidatePath("/accounting");
    return { ok: `Opening balance of ${a.name} set to ${amt.toFixed(2)} ${side === "cr" ? "Cr" : "Dr"}.` };
  } catch (e) { return fail(e); }
}
export async function createCostCentre(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const name = String(fd.get("name") ?? "").trim(); if (name.length < 2) return { error: "Enter a name." };
    await db.insert(costCentres).values({ companyId: ctx.company.id, name, category: String(fd.get("category") ?? "Department") });
    revalidatePath("/accounting"); return { ok: "Cost centre created." };
  } catch (e) { return fail(e); }
}

export async function closeFinancialYear(id: string) {
  const ctx = await guard("admin");
  const fy = ctx.fys.find((f) => f.id === id); if (!fy) throw new Error("Financial year not found.");
  const s = await loadStatements({ company: ctx.company, fy });
  if (!s.tb.balanced) throw new Error(`Cannot close: trial balance is out of balance by ${s.tb.difference.toFixed(2)}.`);
  await db.update(financialYears).set({ status: "closed", closedAt: new Date() }).where(eq(financialYears.id, id));
  const next = new Date(Date.parse(fy.endDate) + 86400000); const end = new Date(Date.UTC(next.getUTCFullYear() + 1, next.getUTCMonth(), 0));
  const y = next.getUTCFullYear(); const label = ctx.company.fyStartMonth === 1 ? `${y}` : `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  if (!ctx.fys.some((f) => f.startDate === next.toISOString().slice(0, 10))) await db.insert(financialYears).values({ companyId: ctx.company.id, label, startDate: next.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
  await audit(ctx, "fy.close", "financial_year", id, { label: fy.label, netProfit: s.pl.netProfit.toFixed(2) });
  revalidatePath("/", "layout");
}
export async function reopenFinancialYear(id: string) {
  const ctx = await guard("admin");
  await db.update(financialYears).set({ status: "open", closedAt: null }).where(and(eq(financialYears.id, id), eq(financialYears.companyId, ctx.company.id)));
  await audit(ctx, "fy.reopen", "financial_year", id); revalidatePath("/", "layout");
}

export async function addFixedAsset(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const p = z.object({ name: z.string().min(2), category: z.string(), purchaseDate: z.string(), cost: z.string(), salvage: z.string().default("0"), lifeYears: z.coerce.number().int().min(1).max(60), method: z.enum(["SLM", "WDV"]), wdvRate: z.string().default("15") }).parse(Object.fromEntries(fd));
    if (D(p.cost).lte(0)) return { error: "Cost must be positive." };
    await db.insert(fixedAssets).values({ ...p, companyId: ctx.company.id, accumulated: "0" });
    await audit(ctx, "asset.add", "fixed_asset", p.name); revalidatePath("/accounting"); return { ok: "Asset added to the register." };
  } catch (e) { return fail(e); }
}
/** Posts ONE journal for the FY: Dr Depreciation / Cr Accumulated depreciation, and updates register. */
export async function runDepreciation(): Promise<void> {
  const ctx = await guard("approve");
  const assets = await db.select().from(fixedAssets).where(and(eq(fixedAssets.companyId, ctx.company.id), isNull(fixedAssets.deletedAt)));
  const rows = assets.map((a) => ({ a, dep: depreciationForYear({ cost: a.cost, salvage: a.salvage, lifeYears: a.lifeYears, method: a.method as "SLM" | "WDV", wdvRate: a.wdvRate ?? 15, accumulated: a.accumulated }) })).filter((x) => x.dep.gt(0));
  if (!rows.length) throw new Error("No depreciation due.");
  const total = rows.reduce((s, x) => s.plus(x.dep), D(0));
  const dep = await accountByRole(ctx.company.id, "depreciation"); const acc = await accountByRole(ctx.company.id, "accum_dep");
  if (!dep || !acc) throw new Error("Depreciation ledgers missing.");
  await postVoucher(ctx, { type: "journal", date: ctx.fy.endDate, narration: `Depreciation for ${ctx.fy.label} (${rows.length} assets)`, source: "depreciation", lines: [{ accountId: dep.id, debit: total.toFixed(2), credit: 0 }, { accountId: acc.id, debit: 0, credit: total.toFixed(2) }] });
  for (const { a, dep: d } of rows) await db.update(fixedAssets).set({ accumulated: D(a.accumulated).plus(d).toFixed(2) }).where(eq(fixedAssets.id, a.id));
  revalidatePath("/accounting");
}

export async function addInventoryItem(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const p = z.object({ sku: z.string().min(1).max(30), name: z.string().min(2), unit: z.string().default("Nos"), hsn: z.string().optional(), reorderLevel: z.string().default("0") }).parse(Object.fromEntries(fd));
    await db.insert(inventoryItems).values({ ...p, companyId: ctx.company.id }); revalidatePath("/accounting"); return { ok: "Item created." };
  } catch (e) { return fail(String((e as Error).message).includes("inv_sku_uq") ? new Error("SKU already exists.") : e); }
}
export async function inventoryMove(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await guard();
    const p = z.object({ itemId: z.string().uuid(), kind: z.enum(["in", "out"]), qty: z.string(), rate: z.string().default("0"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().optional() }).parse(Object.fromEntries(fd));
    await recordInventoryMovement(ctx.company.id, p);
    revalidatePath("/accounting"); revalidatePath("/receivables"); revalidatePath("/payables"); return { ok: "Stock movement recorded." };
  } catch (e) { return fail(e); }
}

export async function loadDemoData(): Promise<void> {
  const ctx: CompanyCtx = await guard("admin");
  const has = await db.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.companyId, ctx.company.id)).limit(1);
  if (has.length) throw new Error("This company already has vouchers; demo data can only be loaded into an empty company.");
  await seedDemoData({ org: ctx.org, user: ctx.user, company: ctx.company }, ctx.company.id);
  revalidatePath("/", "layout");
}
