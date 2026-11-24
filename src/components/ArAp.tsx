import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invoices, parties, reminders, salesDocuments } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Badge, Card, Notice, PageHeader, Stat, Tabs, compact, inr } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExportMenu from "@/components/ExportMenu";
import ActionForm from "@/components/ActionForm";
import InvoiceForm from "@/components/InvoiceForm";
import InvoiceApprovalForm from "@/components/InvoiceApprovalForm";
import InvoicePdfOptions from "@/components/InvoicePdfOptions";
import { STATES } from "@/lib/states";
import { ageing } from "@/services/finance";
import { buildReport } from "@/services/reports";
import { getInventoryCatalog } from "@/services/inventory";
import { cancelInvoiceAction, convertSalesDocumentAction, createParty, draftReminder, recordPaymentAction } from "@/actions/arap";
import { D } from "@/engines/core";

export default async function ArAp({ kind, sp }: { kind: "sales" | "purchase"; sp: Record<string, string | undefined> }) {
  const ctx = await requireCompany(); const ar = kind === "sales"; const tab = sp.tab ?? "invoices";
  const canWrite = can(ctx.role, "write"), canApprove = can(ctx.role, "approve");
  const today = new Date().toISOString().slice(0, 10); const base = ar ? "/receivables" : "/payables";
  const ps = await db.select().from(parties).where(and(eq(parties.companyId, ctx.company.id), eq(parties.kind, ar ? "customer" : "vendor"), isNull(parties.deletedAt)));
  const inventoryOptions = tab === "new" || (tab === "documents" && ar)
    ? (await getInventoryCatalog(ctx.company.id)).map(({ id, sku, name, unit, hsn, onHand, belowReorder, hasHistoryError }) => ({ id, sku, name, unit, hsn, onHand, belowReorder, hasHistoryError }))
    : [];
  const rows = await db.select({ i: invoices, p: parties }).from(invoices).innerJoin(parties, eq(parties.id, invoices.partyId)).where(and(eq(invoices.companyId, ctx.company.id), eq(invoices.kind, kind), isNull(invoices.deletedAt))).orderBy(desc(invoices.date));
  const documentRows = ar && tab === "documents" ? await db.select({ d: salesDocuments, p: parties }).from(salesDocuments).innerJoin(parties, eq(parties.id, salesDocuments.partyId))
    .where(eq(salesDocuments.companyId, ctx.company.id)).orderBy(desc(salesDocuments.date)) : [];
  const open = rows.filter((r) => ["approved", "partially_paid"].includes(r.i.status));
  const outstanding = open.reduce((s, r) => s.plus(r.i.total).minus(r.i.paid), D(0));
  const overdue = open.filter((r) => r.i.dueDate < today).reduce((s, r) => s.plus(r.i.total).minus(r.i.paid), D(0));
  const pending = rows.filter((r) => r.i.status === "pending_approval").length;
  const tabs = [["invoices", ar ? "Sales invoices" : "Bills"], ...(ar ? [["documents", "Quotes & orders"]] : []), ["new", ar ? "New invoice" : "New bill"], ["pay", ar ? "Receipts" : "Payments"], ["ageing", "Ageing"], ["parties", ar ? "Customers & credit limits" : "Vendors"], ["recon", "Party reconciliation"]].map(([id, label]) => ({ id, label }));
  let body: React.ReactNode = null;

  if (tab === "invoices") {
    const recs = await db.select().from(reminders).where(eq(reminders.companyId, ctx.company.id)).orderBy(desc(reminders.createdAt)).limit(30);
    body = (<Card title={ar ? "Sales invoices" : "Purchase bills"} subtitle="Approval posts the voucher and GST. Linked items update inventory; sales approvals require sufficient stock." pad={false} action={<ExportMenu report={ar ? "gst-sales" : "gst-purchase"} />}>
      <div className="overflow-auto"><table className="tbl"><thead><tr><th>Date</th><th>Number</th><th>{ar ? "Customer" : "Vendor"}</th><th>Due</th><th className="r">Total</th><th className="r">Paid</th><th>Status</th><th /></tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-muted">No {ar ? "invoices" : "bills"} yet. <Link className="text-accent" href={`${base}?tab=new`}>Create one →</Link></td></tr>}
        {rows.map(({ i, p }) => { const od = ["approved", "partially_paid"].includes(i.status) && i.dueDate < today; return (<tr key={i.id}><td className="num">{i.date}</td><td className="num font-medium">{i.number}</td><td>{p.name}</td><td className={`num ${od ? "text-down" : ""}`}>{i.dueDate}</td><td className="r num">{inr(i.total, 2)}</td><td className="r num">{inr(i.paid, 2)}</td><td><Badge tone={i.status === "paid" ? "up" : i.status === "cancelled" ? "neutral" : od ? "down" : "warn"}>{od ? "overdue" : i.status.replace("_", " ")}</Badge></td>
          <td className="flex gap-1 whitespace-nowrap">{ar && <><a className="btn btn-sm" href={`/api/invoice/${i.id}/pdf`}>PDF</a><InvoicePdfOptions invoiceId={i.id} /></>}
            {canApprove && i.status === "pending_approval" && <><InvoiceApprovalForm invoiceId={i.id} /><form action={cancelInvoiceAction.bind(null, i.id)}><button className="btn btn-sm">Cancel</button></form></>}
            {canWrite && ["approved", "partially_paid"].includes(i.status) && ar && <form action={draftReminder.bind(null, i.id)}><button className="btn btn-sm">Draft reminder</button></form>}</td></tr>); })}</tbody></table></div>
      {recs.length > 0 && <div className="border-t border-line p-4"><h3 className="mb-2 text-xs font-semibold">Drafted reminders <span className="font-normal text-muted">— FINVANTA has no email provider connected; copy or open in your mail app.</span></h3><div className="space-y-2">{recs.slice(0, 3).map((r) => <details key={r.id} className="rounded border border-line p-2 text-xs"><summary className="cursor-pointer">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {r.message.split("\n")[2]?.slice(0, 90)}…</summary><pre className="mt-2 whitespace-pre-wrap text-muted">{r.message}</pre><a className="btn btn-sm mt-2" href={`mailto:?subject=Payment reminder&body=${encodeURIComponent(r.message)}`}>Open in mail app</a></details>)}</div></div>}</Card>);
  } else if (tab === "new") {
    body = canWrite ? <Card title={ar ? "New sales invoice" : "New purchase bill"} subtitle="GST (CGST+SGST or IGST) is computed from place of supply. Goes to the approval queue."><InvoiceForm kind={kind} parties={ps.map((p) => ({ id: p.id, name: p.name, stateCode: p.stateCode, creditDays: p.creditDays }))} stateCode={ctx.company.stateCode} today={today} states={STATES} inventoryItems={inventoryOptions} /></Card> : <Notice tone="warn">Read-only role.</Notice>;
  } else if (tab === "documents" && ar) {
    body = (<Card title="Quotes, orders & challans" subtitle="These records do not post to the ledger or appear in GST returns. Convert only when ready to create an invoice pending approval." pad={false}>
      <div className="overflow-auto"><table className="tbl"><thead><tr><th>Date</th><th>Document</th><th>Number</th><th>Customer</th><th>Valid until</th><th className="r">Value</th><th>Status</th><th /></tr></thead><tbody>
        {documentRows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-muted">No sales documents yet.</td></tr>}
        {documentRows.map(({ d, p }) => <tr key={d.id}><td className="num">{d.date}</td><td>{d.type.replaceAll("_", " ")}</td><td className="num font-medium">{d.number}</td><td>{p.name}</td><td className="num">{d.validUntil ?? "—"}</td><td className="r num">{inr(d.total, 2)}</td><td><Badge tone={d.status === "converted" ? "up" : "neutral"}>{d.status}</Badge></td><td className="whitespace-nowrap">{canWrite && d.status === "draft" && <form action={convertSalesDocumentAction.bind(null, d.id)}><button className="btn btn-sm btn-primary">Convert to invoice</button></form>}{d.convertedInvoiceId && <a className="btn btn-sm" href={`/api/invoice/${d.convertedInvoiceId}/pdf`}>Invoice PDF</a>}</td></tr>)}</tbody></table></div>
      {canWrite && <div className="border-t border-line p-4"><h3 className="mb-3 text-sm font-semibold">Create a sales document</h3><InvoiceForm kind="sales" documentMode parties={ps.map((p) => ({ id: p.id, name: p.name, stateCode: p.stateCode, creditDays: p.creditDays }))} stateCode={ctx.company.stateCode} today={today} states={STATES} inventoryItems={inventoryOptions} /></div>}
    </Card>);
  } else if (tab === "pay") {
    body = (<div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2" title={ar ? "Collections" : "Payments"} subtitle="Each entry posts a bank voucher and updates the invoice balance." pad={false}><div className="p-3"><DataTable title="open-items" columns={[{ key: "number", label: "Invoice" }, { key: "party", label: "Party" }, { key: "due", label: "Due" }, { key: "total", label: "Total", kind: "money" }, { key: "out", label: "Outstanding", kind: "money" }]} rows={open.map(({ i, p }) => ({ number: i.number, party: p.name, due: i.dueDate, total: i.total, out: D(i.total).minus(i.paid).toFixed(2) }))} empty="Nothing outstanding." /></div></Card>
      {canWrite && <Card title={ar ? "Record receipt" : "Record payment"}><ActionForm submit="Post" action={recordPaymentAction} fields={[{ name: "invoiceId", label: "Invoice", type: "select", span: 2, options: open.map(({ i, p }) => [i.id, `${i.number} · ${p.name} · due ${inr(D(i.total).minus(i.paid).toFixed(2), 2)}`] as [string, string]) }, { name: "amount", label: "Amount", type: "number", step: "0.01", required: true }, { name: "date", label: "Date", type: "date", defaultValue: today, required: true }, { name: "mode", label: "Mode", type: "select", options: [["bank", "Bank / UPI / NEFT"], ["cash", "Cash"]] }, { name: "reference", label: "Reference / UTR" }]} /></Card>}</div>);
  } else if (tab === "ageing") {
    const r = await buildReport(ctx, ar ? "ageing-receivables" : "ageing-payables");
    body = (<Card title={r?.title} subtitle={r?.subtitle} action={<ExportMenu report={ar ? "ageing-receivables" : "ageing-payables"} />} pad={false}><div className="p-3">{r && <DataTable title="ageing" columns={r.columns} rows={r.rows} searchable={false} />}</div></Card>);
  } else if (tab === "parties") {
    const ag = await ageing(ctx, kind, today); const exp = new Map(ag.map((a) => [a.party, a.total]));
    body = (<div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2" title={ar ? "Customers" : "Vendors"} pad={false}><div className="p-3"><DataTable title="parties" columns={[{ key: "name", label: "Name" }, { key: "gstin", label: "GSTIN" }, { key: "pan", label: "PAN" }, { key: "days", label: "Credit days", kind: "num" }, ...(ar ? [{ key: "limit", label: "Credit limit", kind: "money" as const }, { key: "exposure", label: "Outstanding", kind: "money" as const }, { key: "util", label: "Limit status", kind: "tone" as const }] : [])]}
      rows={ps.map((p) => { const e = exp.get(p.name) ?? 0; const lim = Number(p.creditLimit); return { name: p.name, gstin: p.gstin ?? "Unregistered", pan: p.pan, days: p.creditDays, limit: p.creditLimit, exposure: e.toFixed(2), util: lim > 0 && e > lim ? `Over limit by ${inr(e - lim)}` : lim > 0 ? `${Math.round((e / lim) * 100)}% used` : "No limit set" }; })} /></div></Card>
      {canWrite && <Card title={`Add ${ar ? "customer" : "vendor"}`}><ActionForm submit="Add" action={createParty} fields={[{ name: "kind", label: "", type: "select", options: [[ar ? "customer" : "vendor", ar ? "Customer" : "Vendor"]], span: 2 }, { name: "name", label: "Legal name", required: true, span: 2 }, { name: "gstin", label: "GSTIN" }, { name: "pan", label: "PAN" }, { name: "email", label: "Email" }, { name: "phone", label: "Phone" }, { name: "stateCode", label: "State", type: "select", options: STATES.map(([c, n]) => [c, `${c} · ${n}`] as [string, string]), defaultValue: ctx.company.stateCode }, { name: "creditDays", label: "Credit days", type: "number", defaultValue: 30 }, ...(ar ? [{ name: "creditLimit", label: "Credit limit", type: "number" as const, defaultValue: 0 }] : [{ name: "deducteeType", label: "TDS deductee type", type: "select" as const, options: [["company", "Company/firm"], ["individual", "Individual/HUF"]] as [string, string][] }])]} /></Card>}</div>);
  } else {
    const byParty = new Map<string, { name: string; billed: ReturnType<typeof D>; paid: ReturnType<typeof D> }>();
    rows.filter((r) => ["approved", "partially_paid", "paid"].includes(r.i.status)).forEach(({ i, p }) => { const e = byParty.get(p.id) ?? { name: p.name, billed: D(0), paid: D(0) }; e.billed = e.billed.plus(i.total); e.paid = e.paid.plus(i.paid); byParty.set(p.id, e); });
    body = (<Card title="Party reconciliation statement" subtitle="Sub-ledger totals per party; send to the counterparty for confirmation. Differences reported by the party must be investigated against invoices & receipts." action={<ExportMenu report={ar ? "ageing-receivables" : "ageing-payables"} formats={["pdf", "xlsx"]} />} pad={false}><div className="p-3"><DataTable title="party-reconciliation" columns={[{ key: "name", label: "Party" }, { key: "billed", label: "Billed (approved)", kind: "money" }, { key: "paid", label: ar ? "Received" : "Paid", kind: "money" }, { key: "bal", label: "Balance per books", kind: "money" }]} rows={[...byParty.values()].map((e) => ({ name: e.name, billed: e.billed.toFixed(2), paid: e.paid.toFixed(2), bal: e.billed.minus(e.paid).toFixed(2) }))} /></div></Card>);
  }
  return (<><PageHeader title={ar ? "Accounts Receivable" : "Accounts Payable"} desc={ar ? "Customer invoices, receipts, ageing, credit limits and collections." : "Vendor bills, payments, ageing and reconciliation."} crumbs={[{ label: "Accounting & Compliance" }, { label: ar ? "Receivables" : "Payables" }]} />
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Outstanding" value={compact(outstanding.toNumber())} sub={`${open.length} open ${ar ? "invoices" : "bills"}`} /><Stat label="Overdue" value={compact(overdue.toNumber())} tone={overdue.gt(0) ? "down" : undefined} /><Stat label="Awaiting approval" value={String(pending)} tone={pending ? "warn" : undefined} /><Stat label={ar ? "Customers" : "Vendors"} value={String(ps.length)} /></div>
    <Tabs tabs={tabs} active={tab} base={base} />{body}</>);
}
