import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, invoices, parties, salesDocuments, type InvoiceItem, type SalesDocumentType } from "@/db/schema";
import { D } from "@/engines/core";
import { invoiceTotals } from "@/engines/tax";
import { audit } from "@/lib/audit";
import { validateInventoryLinks } from "./inventory";

type Actor = { org: { id: string }; user: { id: string }; company: { id: string; stateCode: string } };
type SalesDocumentInput = {
  type: SalesDocumentType;
  partyId: string;
  date: string;
  validUntil?: string;
  placeOfSupply?: string;
  items: InvoiceItem[];
  notes?: string;
  fyId: string;
};

const prefixes: Record<SalesDocumentType, string> = {
  quotation: "QUO",
  proforma: "PRO",
  sales_order: "SO",
  delivery_challan: "DC",
};

export async function createSalesDocument(ctx: Actor, input: SalesDocumentInput) {
  if (!input.items.length || input.items.some((item) => !item.description.trim() || item.qty <= 0 || D(item.rate).lt(0))) {
    throw new Error("Each line needs a description, positive quantity and non-negative rate.");
  }
  await validateInventoryLinks(ctx.company.id, input.items);
  const [party] = await db.select().from(parties).where(and(eq(parties.id, input.partyId), eq(parties.companyId, ctx.company.id)));
  if (!party) throw new Error("Party not found in this company.");
  const [company] = await db.select().from(companies).where(eq(companies.id, ctx.company.id));
  if (!company) throw new Error("Company not found.");
  const pos = input.placeOfSupply || party.stateCode;
  const totals = invoiceTotals(input.items, company.stateCode, pos);
  const [{ n }] = await db.select({ n: count() }).from(salesDocuments)
    .where(and(eq(salesDocuments.companyId, ctx.company.id), eq(salesDocuments.fyId, input.fyId), eq(salesDocuments.type, input.type)));
  const number = `${prefixes[input.type]}-${String(Number(n) + 1).padStart(4, "0")}`;
  const [document] = await db.insert(salesDocuments).values({
    companyId: ctx.company.id,
    fyId: input.fyId,
    type: input.type,
    number,
    partyId: input.partyId,
    date: input.date,
    validUntil: input.validUntil || null,
    placeOfSupply: pos,
    items: input.items,
    taxable: totals.taxable.toFixed(2),
    cgst: totals.cgst.toFixed(2),
    sgst: totals.sgst.toFixed(2),
    igst: totals.igst.toFixed(2),
    total: totals.total.toFixed(2),
    notes: input.notes,
    createdBy: ctx.user.id,
  }).returning();
  await audit(ctx, "sales_document.create", "sales_document", document.id, { number, type: input.type });
  return document;
}

export async function convertSalesDocument(ctx: Actor, id: string) {
  const invoice = await db.transaction(async (tx) => {
    const [document] = await tx.select().from(salesDocuments)
      .where(and(eq(salesDocuments.id, id), eq(salesDocuments.companyId, ctx.company.id)))
      .for("update");
    if (!document) throw new Error("Sales document not found.");
    if (document.status !== "draft") throw new Error("Only a draft sales document can be converted.");
    const [party] = await tx.select().from(parties).where(and(eq(parties.id, document.partyId), eq(parties.companyId, ctx.company.id)));
    if (!party) throw new Error("Party not found in this company.");
    const [company] = await tx.select().from(companies).where(eq(companies.id, ctx.company.id));
    if (!company) throw new Error("Company not found.");
    const totals = invoiceTotals(document.items, company.stateCode, document.placeOfSupply);
    const [{ n }] = await tx.select({ n: count() }).from(invoices)
      .where(and(eq(invoices.companyId, ctx.company.id), eq(invoices.kind, "sales"), eq(invoices.fyId, document.fyId)));
    const due = new Date(`${document.date}T00:00:00.000Z`);
    due.setUTCDate(due.getUTCDate() + party.creditDays);
    const [created] = await tx.insert(invoices).values({
      companyId: ctx.company.id,
      fyId: document.fyId,
      kind: "sales",
      number: `INV-${String(Number(n) + 1).padStart(4, "0")}`,
      partyId: document.partyId,
      date: document.date,
      dueDate: due.toISOString().slice(0, 10),
      placeOfSupply: document.placeOfSupply,
      items: document.items,
      taxable: totals.taxable.toFixed(2),
      cgst: totals.cgst.toFixed(2),
      sgst: totals.sgst.toFixed(2),
      igst: totals.igst.toFixed(2),
      total: totals.total.toFixed(2),
      paid: "0",
      status: "pending_approval",
      notes: document.notes,
      createdBy: ctx.user.id,
    }).returning();
    await tx.update(salesDocuments).set({ status: "converted", convertedInvoiceId: created.id })
      .where(eq(salesDocuments.id, document.id));
    return created;
  });
  await audit(ctx, "sales_document.convert", "sales_document", id, { invoiceId: invoice.id, invoiceNumber: invoice.number });
  await audit(ctx, "invoice.create", "invoice", invoice.id, { number: invoice.number, total: invoice.total, sourceDocumentId: id });
  return invoice;
}
