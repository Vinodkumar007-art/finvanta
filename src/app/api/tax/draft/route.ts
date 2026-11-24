import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, invoices, parties } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { invoiceRows } from "@/services/finance";
import { gstr3bSummary } from "@/engines/tax";
import { D } from "@/engines/core";
import { audit } from "@/lib/audit";
import { gstCsv } from "@/services/gst-csv";

export const dynamic = "force-dynamic";
const META = { status: "DRAFT — prepared by FINVANTA for review. NOT filed or submitted to any government portal." };

export async function GET(req: Request) {
  const a = await apiCtx(req, { needCompany: true }); if ("error" in a) return a.error;
  const ctx = a.ctx; const u = new URL(req.url); const type = u.searchParams.get("type");
  const [co] = await db.select().from(companies).where(eq(companies.id, ctx.company.id));
  const download = (name: string, body: unknown) => new Response(JSON.stringify({ _meta: META, ...(body as object) }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}.json"` } });
  const downloadCsv = (name: string, rows: (string | number | null | undefined)[][]) =>
    new Response(`\uFEFF${gstCsv([["FINVANTA GST CSV review export — NOT a portal upload or filing"], ...rows])}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
    });
  const format = u.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return json({ error: "Format must be json or csv." }, 400);
  await audit(ctx, "tax.draft.download", "draft", type ?? "");

  if (type === "gstr1") {
    const rows = (await invoiceRows(ctx, "sales")).filter(({ inv }) => ["approved", "partially_paid", "paid"].includes(inv.status));
    if (format === "csv") {
      return downloadCsv(`GSTR1-register-${ctx.fy.label.replace(/\W+/g, "")}`, [
        ["Invoice number", "Invoice date", "Customer", "Customer GSTIN", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Invoice value"],
        ...rows.map(({ inv, party }) => [inv.number, inv.date, party.name, party.gstin ?? "", inv.placeOfSupply, inv.taxable, inv.cgst, inv.sgst, inv.igst, inv.total]),
      ]);
    }
    const b2b = rows.filter((r) => r.party.gstin).map(({ inv, party }) => ({ ctin: party.gstin, inum: inv.number, idt: inv.date, val: inv.total, pos: inv.placeOfSupply, itms: inv.items.map((it, i) => ({ num: i + 1, hsn: it.hsn, rt: it.gstRate, txval: D(it.rate).mul(it.qty).toFixed(2) })) }));
    const b2c = rows.filter((r) => !r.party.gstin).map(({ inv }) => ({ inum: inv.number, idt: inv.date, pos: inv.placeOfSupply, txval: inv.taxable, iamt: inv.igst, camt: inv.cgst, samt: inv.sgst }));
    const hsn: Record<string, { hsn: string; qty: number; txval: string }> = {};
    rows.forEach(({ inv }) => inv.items.forEach((it) => { const h = (hsn[it.hsn || "NA"] ??= { hsn: it.hsn || "NA", qty: 0, txval: "0" }); h.qty += it.qty; h.txval = D(h.txval).plus(D(it.rate).mul(it.qty)).toFixed(2); }));
    return download(`GSTR1-draft-${ctx.fy.label.replace(/\W+/g, "")}`, { gstin: co.gstin, fp: ctx.fy.label, b2b, b2c, hsn: Object.values(hsn) });
  }
  if (type === "gstr3b") {
    const approvedStatuses = ["approved", "partially_paid", "paid"];
    const [s, p] = await Promise.all([
      invoiceRows(ctx, "sales").then((rows) => rows.filter(({ inv }) => approvedStatuses.includes(inv.status))),
      invoiceRows(ctx, "purchase").then((rows) => rows.filter(({ inv }) => approvedStatuses.includes(inv.status))),
    ]);
    const map = (r: typeof s) => r.map(({ inv, party }) => ({ gstin: party.gstin, invoiceNo: inv.number, date: inv.date, taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst }));
    const x = gstr3bSummary(map(s), map(p));
    const f = (d: { toFixed(n: number): string }) => d.toFixed(2);
    if (format === "csv") {
      return downloadCsv(`GSTR3B-summary-${ctx.fy.label.replace(/\W+/g, "")}`, [
        ["Measure", "IGST", "CGST", "SGST"],
        ["Outward taxable supplies", f(x.outward.igst), f(x.outward.cgst), f(x.outward.sgst)],
        ["ITC available from books", f(x.itc.igst), f(x.itc.cgst), f(x.itc.sgst)],
        ["Tax payable in cash", f(x.setoff.cashIgst), f(x.setoff.cashCgst), f(x.setoff.cashSgst)],
      ]);
    }
    return download(`GSTR3B-draft-${ctx.fy.label.replace(/\W+/g, "")}`, { gstin: co.gstin, outward: { taxable: f(x.outward.taxable), igst: f(x.outward.igst), cgst: f(x.outward.cgst), sgst: f(x.outward.sgst) }, itcAvailable: { igst: f(x.itc.igst), cgst: f(x.itc.cgst), sgst: f(x.itc.sgst) }, taxPayableInCash: { igst: f(x.setoff.cashIgst), cgst: f(x.setoff.cashCgst), sgst: f(x.setoff.cashSgst) }, note: "Period is the selected financial year; split by return month before filing." });
  }
  if (type === "einvoice" || type === "eway") {
    const id = u.searchParams.get("id") ?? "";
    const [row] = await db.select({ inv: invoices, p: parties }).from(invoices).innerJoin(parties, eq(parties.id, invoices.partyId)).where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.company.id), eq(invoices.kind, "sales")));
    if (!row) return json({ error: "Invoice not found" }, 404);
    const { inv, p } = row;
    if (type === "einvoice") return download(`einvoice-${inv.number}`, {
      Version: "1.1", TranDtls: { TaxSch: "GST", SupTyp: p.gstin ? "B2B" : "B2C", RegRev: "N" }, DocDtls: { Typ: "INV", No: inv.number, Dt: inv.date.split("-").reverse().join("/") },
      SellerDtls: { Gstin: co.gstin, LglNm: co.name, Stcd: co.stateCode }, BuyerDtls: { Gstin: p.gstin ?? "URP", LglNm: p.name, Pos: inv.placeOfSupply, Stcd: p.stateCode },
      ItemList: inv.items.map((it, i) => ({ SlNo: String(i + 1), PrdDesc: it.description, HsnCd: it.hsn, Qty: it.qty, UnitPrice: it.rate, TotAmt: D(it.rate).mul(it.qty).toFixed(2), GstRt: it.gstRate })),
      ValDtls: { AssVal: inv.taxable, CgstVal: inv.cgst, SgstVal: inv.sgst, IgstVal: inv.igst, TotInvVal: inv.total }, note: "IRN and QR code are generated only by the Invoice Registration Portal.",
    });
    return download(`eway-${inv.number}`, { supplyType: "O", docType: "INV", docNo: inv.number, docDate: inv.date, fromGstin: co.gstin, fromStateCode: co.stateCode, toGstin: p.gstin ?? "URP", toStateCode: p.stateCode, totalValue: inv.taxable, cgstValue: inv.cgst, sgstValue: inv.sgst, igstValue: inv.igst, totInvValue: inv.total, itemList: inv.items.map((it) => ({ productName: it.description, hsnCode: it.hsn, quantity: it.qty, taxableAmount: D(it.rate).mul(it.qty).toFixed(2), gstRate: it.gstRate })), note: "Transport details are captured in FINVANTA's record; the e-way bill number is generated only on the NIC portal." });
  }
  return json({ error: "Unknown draft type" }, 400);
}
