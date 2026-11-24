import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, invoices, parties } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { createInvoicePdf, normalizeInvoicePdfOptions } from "@/services/invoice-pdf";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiCtx(req, { needCompany: true }); if ("error" in a) return a.error;
  const { id } = await params;
  const [row] = await db.select({ i: invoices, p: parties }).from(invoices).innerJoin(parties, eq(parties.id, invoices.partyId)).where(and(eq(invoices.id, id), eq(invoices.companyId, a.ctx.company.id)));
  if (!row) return json({ error: "Not found" }, 404);
  const [co] = await db.select().from(companies).where(eq(companies.id, a.ctx.company.id));
  const { i, p } = row;
  const pdf = createInvoicePdf({
    company: {
      name: co.name,
      address: co.address,
      gstin: co.gstin,
      pan: co.pan,
      stateCode: co.stateCode,
      currency: co.baseCurrency,
    },
    invoice: {
      kind: i.kind === "sales" ? "sales" : "purchase",
      number: i.number,
      date: i.date,
      dueDate: i.dueDate,
      placeOfSupply: i.placeOfSupply,
      items: i.items,
      taxable: i.taxable,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      total: i.total,
      paid: i.paid,
      notes: i.notes,
    },
    party: { name: p.name, gstin: p.gstin, pan: p.pan },
  }, normalizeInvoicePdfOptions(
    new URL(req.url).searchParams.get("layout"),
    new URL(req.url).searchParams.get("language"),
  ));
  const filename = i.number.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}.pdf"` } });
}
