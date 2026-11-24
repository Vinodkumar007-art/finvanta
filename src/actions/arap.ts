"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, parties, reminders } from "@/db/schema";
import { assertCan, requireCompany } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { GSTIN_RE, PAN_RE } from "@/engines/tax";
import { approveInvoice, createInvoice, recordPayment } from "@/services/invoicing";
import { convertSalesDocument, createSalesDocument } from "@/services/sales-documents";
import { D } from "@/engines/core";
import type { FormState } from "./auth";

const fail = (e: unknown): FormState => ({ error: (e as Error).message });

export async function createParty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = z.object({ kind: z.enum(["customer", "vendor", "deductee"]), name: z.string().trim().min(2).max(120), gstin: z.string().trim().toUpperCase().optional(), pan: z.string().trim().toUpperCase().optional(), email: z.string().email().optional().or(z.literal("")), phone: z.string().max(20).optional(), stateCode: z.string().default("27"), creditLimit: z.string().default("0"), creditDays: z.coerce.number().int().min(0).max(365).default(30), deducteeType: z.enum(["individual", "company"]).default("company") }).parse(Object.fromEntries(fd));
    if (p.gstin && !GSTIN_RE.test(p.gstin)) return { error: "GSTIN format invalid." };
    if (p.pan && !PAN_RE.test(p.pan)) return { error: "PAN format invalid." };
    await db.insert(parties).values({ ...p, companyId: ctx.company.id, gstin: p.gstin || null, pan: p.pan || null, email: p.email || null });
    await audit(ctx, "party.create", "party", p.name, { kind: p.kind }); revalidatePath("/receivables"); revalidatePath("/payables"); revalidatePath("/tax");
    return { ok: `${p.name} added.` };
  } catch (e) { return fail(e); }
}

const invSchema = z.object({ kind: z.enum(["sales", "purchase"]), partyId: z.string().uuid(), date: z.string(), dueDate: z.string(), placeOfSupply: z.string().optional(), notes: z.string().max(500).optional(), number: z.string().max(40).optional(),
  items: z.array(z.object({ description: z.string().min(1).max(200), hsn: z.string().max(10).default(""), qty: z.number().positive(), rate: z.string(), gstRate: z.number().min(0).max(40), inventoryItemId: z.string().uuid().optional() })).min(1).max(50) });
export async function createInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = invSchema.safeParse(JSON.parse(String(fd.get("payload") ?? "{}")));
    if (!p.success) return { error: p.error.issues[0].message };
    const inv = await createInvoice(ctx, { ...p.data, fyId: ctx.fy.id });
    revalidatePath("/receivables"); revalidatePath("/payables");
    return { ok: `Invoice ${inv.number} created (total ${inv.total}). It awaits approval before posting to the ledger.` };
  } catch (e) { return fail(e); }
}
const salesDocumentSchema = z.object({
  type: z.enum(["quotation", "proforma", "sales_order", "delivery_challan"]),
  partyId: z.string().uuid(),
  date: z.string(),
  validUntil: z.string().optional(),
  placeOfSupply: z.string().optional(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({ description: z.string().min(1).max(200), hsn: z.string().max(10).default(""), qty: z.number().positive(), rate: z.string(), gstRate: z.number().min(0).max(40), inventoryItemId: z.string().uuid().optional() })).min(1).max(50),
});
export async function createSalesDocumentAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const parsed = salesDocumentSchema.safeParse(JSON.parse(String(fd.get("payload") ?? "{}")));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const document = await createSalesDocument(ctx, { ...parsed.data, validUntil: parsed.data.validUntil || undefined, fyId: ctx.fy.id });
    revalidatePath("/receivables");
    return { ok: `${document.number} saved as a draft. Convert it to create a tax invoice pending approval.` };
  } catch (e) { return fail(e); }
}
export async function convertSalesDocumentAction(id: string) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  await convertSalesDocument(ctx, id);
  revalidatePath("/receivables"); revalidatePath("/tax"); revalidatePath("/dashboard");
}
export async function approveInvoiceAction(id: string, _: FormState, _fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "approve");
    await approveInvoice(ctx, id);
    revalidatePath("/receivables"); revalidatePath("/payables"); revalidatePath("/dashboard"); revalidatePath("/accounting");
    return { ok: "Invoice approved and posted." };
  } catch (e) { return fail(e); }
}
export async function cancelInvoiceAction(id: string) {
  const ctx = await requireCompany(); assertCan(ctx, "approve");
  const [i] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.company.id)));
  if (!i || i.status !== "pending_approval") throw new Error("Only invoices awaiting approval can be cancelled; reverse the voucher for approved invoices.");
  await db.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, id)); await audit(ctx, "invoice.cancel", "invoice", id);
  revalidatePath("/receivables"); revalidatePath("/payables");
}
export async function recordPaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = z.object({ invoiceId: z.string().uuid(), amount: z.string(), date: z.string(), mode: z.string().default("bank"), reference: z.string().max(60).optional() }).parse(Object.fromEntries(fd));
    const v = await recordPayment(ctx, p); revalidatePath("/receivables"); revalidatePath("/payables"); revalidatePath("/dashboard");
    return { ok: `Recorded and posted ${v.number}.` };
  } catch (e) { return fail(e); }
}
export async function draftReminder(id: string) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  const [row] = await db.select({ i: invoices, p: parties }).from(invoices).innerJoin(parties, eq(parties.id, invoices.partyId)).where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.company.id)));
  if (!row) throw new Error("Invoice not found.");
  const out = D(row.i.total).minus(row.i.paid); const days = Math.floor((Date.now() - Date.parse(row.i.dueDate)) / 86400000);
  const msg = `Dear ${row.p.name},\n\nThis is a ${days > 0 ? `reminder that invoice ${row.i.number} dated ${row.i.date} is ${days} day(s) overdue` : `courtesy reminder for invoice ${row.i.number} due on ${row.i.dueDate}`}. Outstanding amount: ${ctx.company.baseCurrency} ${out.toFixed(2)}.\n\nKindly arrange payment at the earliest or let us know if there is a query.\n\nRegards,\n${ctx.company.name}`;
  await db.insert(reminders).values({ companyId: ctx.company.id, invoiceId: id, message: msg });
  await audit(ctx, "reminder.draft", "invoice", id); revalidatePath("/receivables"); revalidatePath("/payables");
}
