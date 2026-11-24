"use server";
import { revalidatePath } from "next/cache";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { complianceRecords, parties, tdsEntries, tdsSections, invoices } from "@/db/schema";
import { assertCan, requireCompany } from "@/lib/ctx";
import { audit, logCalc } from "@/lib/audit";
import { D } from "@/engines/core";
import { computeTds, tdsQuarter, type CgAssetType } from "@/engines/tax";
import { accountByRole, postVoucher } from "@/services/posting";
import type { CalcRecord } from "@/engines/core";
import type { FormState } from "./auth";

const fail = (e: unknown): FormState => ({ error: (e as Error).message });

export async function saveCalcLog(rec: CalcRecord) {
  const ctx = await requireCompany();
  if (!rec?.name || typeof rec.formula !== "string") return;
  await logCalc(ctx, { ...rec, name: String(rec.name).slice(0, 80), formula: rec.formula.slice(0, 500), assumptions: (rec.assumptions ?? []).slice(0, 10).map((x) => String(x).slice(0, 300)), source: String(rec.source).slice(0, 200), inputs: JSON.parse(JSON.stringify(rec.inputs ?? {}).slice(0, 4000)), result: JSON.parse(JSON.stringify(rec.result ?? {}).slice(0, 4000)) });
}

export async function updateTdsSection(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "approve");
    const p = z.object({ section: z.string(), rateIndividual: z.string(), rateOther: z.string(), singleThreshold: z.string(), annualThreshold: z.string() }).parse(Object.fromEntries(fd));
    for (const v of [p.rateIndividual, p.rateOther]) if (D(v).lt(0) || D(v).gt(50)) return { error: "Rates must be between 0 and 50%." };
    await db.update(tdsSections).set(p).where(and(eq(tdsSections.companyId, ctx.company.id), eq(tdsSections.section, p.section)));
    await audit(ctx, "tds.section.update", "tds_section", p.section, p); revalidatePath("/tax"); return { ok: `Section ${p.section} updated.` };
  } catch (e) { return fail(e); }
}

export async function recordTdsDeduction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = z.object({ deducteeId: z.string().uuid(), section: z.string(), amount: z.string(), date: z.string(), post: z.string().optional() }).parse(Object.fromEntries(fd));
    const [d] = await db.select().from(parties).where(and(eq(parties.id, p.deducteeId), eq(parties.companyId, ctx.company.id)));
    const [cfg] = await db.select().from(tdsSections).where(and(eq(tdsSections.companyId, ctx.company.id), eq(tdsSections.section, p.section)));
    if (!d || !cfg) return { error: "Deductee or section not found." };
    const fyEntries = await db.select().from(tdsEntries).where(and(eq(tdsEntries.companyId, ctx.company.id), eq(tdsEntries.deducteeId, d.id), eq(tdsEntries.section, p.section), gte(tdsEntries.date, ctx.fy.startDate), lte(tdsEntries.date, ctx.fy.endDate)));
    const ytd = fyEntries.reduce((s, e) => s.plus(e.gross), D(0));
    const rec = computeTds(cfg, { amount: p.amount, deducteeType: (d.deducteeType as "individual" | "company") ?? "company", panAvailable: !!d.pan, paidYtd: ytd });
    const r = rec.result as { applicable: boolean; base: string; rate: string; tds: string };
    await logCalc(ctx, rec);
    if (!r.applicable || D(r.tds).lte(0)) return { ok: `No TDS applicable on ${p.amount} under ${p.section} (threshold not crossed). Calculation logged.` };
    let voucherId: string | null = null;
    if (p.post === "on") {
      const ap = await accountByRole(ctx.company.id, "ap"); const tds = await accountByRole(ctx.company.id, "tds_payable");
      if (!ap || !tds) return { error: "AP / TDS payable ledgers missing." };
      const v = await postVoucher(ctx, { type: "journal", date: p.date, narration: `TDS u/s ${p.section} on ${d.name}`, source: "manual", lines: [{ accountId: ap.id, debit: r.tds, credit: 0, partyId: d.id }, { accountId: tds.id, debit: 0, credit: r.tds }] });
      voucherId = v.id;
    }
    await db.insert(tdsEntries).values({ companyId: ctx.company.id, deducteeId: d.id, section: p.section, date: p.date, gross: D(r.base).toFixed(2), rate: r.rate, tds: r.tds, voucherId });
    await audit(ctx, "tds.record", "tds_entry", d.id, { section: p.section, tds: r.tds }); revalidatePath("/tax");
    return { ok: `TDS ₹${r.tds} @ ${r.rate}% on base ${r.base} recorded${voucherId ? " and posted to ledger" : " (register only)"}. Quarter ${tdsQuarter(p.date)}.` };
  } catch (e) { return fail(e); }
}

export async function recordChallan(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "approve");
    const p = z.object({ quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]), bsr: z.string().min(3), challanNo: z.string().min(1), date: z.string(), amount: z.string(), post: z.string().optional() }).parse(Object.fromEntries(fd));
    const entries = (await db.select().from(tdsEntries).where(and(eq(tdsEntries.companyId, ctx.company.id), isNull(tdsEntries.challanId), gte(tdsEntries.date, ctx.fy.startDate), lte(tdsEntries.date, ctx.fy.endDate)))).filter((e) => tdsQuarter(e.date) === p.quarter);
    const due = entries.reduce((s, e) => s.plus(e.tds), D(0));
    if (!D(p.amount).eq(due)) return { error: `Challan amount ${p.amount} must equal unlinked TDS for ${p.quarter} (${due.toFixed(2)}). Reconcile before recording.` };
    const [c] = await db.insert(complianceRecords).values({ companyId: ctx.company.id, type: "challan", ref: p.challanNo, status: "recorded_by_user", payload: { ...p, entries: entries.length, note: "Deposit recorded by user; verify on OLTAS/ITNS-281." } }).returning();
    for (const e of entries) await db.update(tdsEntries).set({ challanId: c.id }).where(eq(tdsEntries.id, e.id));
    if (p.post === "on") {
      const bank = await accountByRole(ctx.company.id, "bank"); const tds = await accountByRole(ctx.company.id, "tds_payable");
      if (bank && tds) await postVoucher(ctx, { type: "payment", date: p.date, narration: `TDS deposit challan ${p.challanNo} (${p.quarter})`, lines: [{ accountId: tds.id, debit: p.amount, credit: 0 }, { accountId: bank.id, debit: 0, credit: p.amount }] });
    }
    await audit(ctx, "tds.challan", "challan", c.id, p); revalidatePath("/tax");
    return { ok: `Challan ${p.challanNo} recorded against ${entries.length} deduction(s). This records your deposit; it does not make the deposit.` };
  } catch (e) { return fail(e); }
}

export async function addComplianceRecord(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = z.object({ type: z.enum(["notice", "form16", "form16a", "einvoice", "eway"]), ref: z.string().min(1).max(60), dueDate: z.string().optional(), note: z.string().max(2000).optional(), status: z.string().default("draft") }).parse(Object.fromEntries(fd));
    await db.insert(complianceRecords).values({ companyId: ctx.company.id, type: p.type, ref: p.ref, dueDate: p.dueDate || null, status: p.status, payload: { note: p.note ?? "" } });
    await audit(ctx, "compliance.add", p.type, p.ref); revalidatePath("/tax"); return { ok: "Record saved." };
  } catch (e) { return fail(e); }
}

export async function prepareEinvoice(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const kind = String(fd.get("kind"));
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, String(fd.get("invoiceId"))), eq(invoices.companyId, ctx.company.id), eq(invoices.kind, "sales")));
    if (!inv) return { error: "Select an approved sales invoice." };
    if (inv.status === "pending_approval") return { error: "Approve the invoice first." };
    await db.insert(complianceRecords).values({ companyId: ctx.company.id, type: kind === "eway" ? "eway" : "einvoice", ref: inv.number, status: "ready", payload: kind === "eway" ? { invoiceId: inv.id, transporter: String(fd.get("transporter") ?? ""), vehicle: String(fd.get("vehicle") ?? "").toUpperCase(), distanceKm: Number(fd.get("distance") ?? 0) } : { invoiceId: inv.id } });
    await audit(ctx, "compliance.prepare", kind, inv.number); revalidatePath("/tax");
    return { ok: `${kind === "eway" ? "E-way bill" : "E-invoice"} JSON prepared for ${inv.number}. Upload it on the official portal/IRP — FINVANTA has not submitted anything.` };
  } catch (e) { return fail(e); }
}
export type { CgAssetType };
