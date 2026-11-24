import Link from "next/link";
import { and, asc, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankTransactions, documents, invoices, vouchers, voucherLines } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Badge, Card, Empty, Notice, PageHeader, inr } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { confirmFields, deleteDocument, postDocument } from "@/actions/documents";
import { D } from "@/engines/core";

export const metadata = { title: "Document Intelligence" };
const TYPES = ["invoice", "receipt", "bank_statement", "gst_return", "financial_statement", "annual_report", "tax_document", "purchase_order", "credit_note", "debit_note", "audit_report", "unclassified"];

export default async function Docs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const canWrite = can(ctx.role, "write"), canApprove = can(ctx.role, "approve");
  const q = sp.q?.replace(/[%_]/g, "");
  const docs = await db.select({ id: documents.id, name: documents.name, docType: documents.docType, status: documents.status, size: documents.size, createdAt: documents.createdAt, sha: documents.sha256 }).from(documents)
    .where(and(eq(documents.companyId, ctx.company.id), isNull(documents.deletedAt), q ? or(ilike(documents.name, `%${q}%`), ilike(documents.extractedText, `%${q}%`)) : undefined)).orderBy(desc(documents.createdAt)).limit(200);
  const sel = sp.id ? (await db.select().from(documents).where(and(eq(documents.id, sp.id), eq(documents.companyId, ctx.company.id), isNull(documents.deletedAt))))[0] : undefined;
  const accs = await db.select().from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt))).orderBy(asc(accounts.code));
  let suggestions: string[] = []; const fields = (sel?.extracted as { fields?: Record<string, string>; issues?: string[]; confidence?: string; note?: string } | undefined);
  if (sel && fields?.fields?.total && Number(fields.fields.total) > 0) {
    const t = D(fields.fields.total).toFixed(2);
    const vs = await db.select({ n: vouchers.number, d: vouchers.date }).from(voucherLines).innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId)).where(and(eq(vouchers.companyId, ctx.company.id), or(eq(voucherLines.debit, t), eq(voucherLines.credit, t)))).limit(3);
    const bt = await db.select().from(bankTransactions).where(and(eq(bankTransactions.companyId, ctx.company.id), or(eq(bankTransactions.debit, t), eq(bankTransactions.credit, t)), ne(bankTransactions.status, "duplicate"))).limit(3);
    const iv = fields.fields.invoiceNumber ? await db.select().from(invoices).where(and(eq(invoices.companyId, ctx.company.id), eq(invoices.number, fields.fields.invoiceNumber))).limit(2) : [];
    suggestions = [...vs.map((v) => `Voucher ${v.n} (${v.d}) already has a line of ${t} — possible duplicate booking`), ...bt.map((b) => `Bank line ${b.date} “${b.description.slice(0, 30)}” = ${t} — likely the payment (reconcile in Banking)`), ...iv.map((i) => `Invoice ${i.number} already exists in ${i.kind} register`)];
  }
  const dups = sel ? docs.filter((d) => d.sha === sel.sha256 && d.id !== sel.id) : [];

  return (<><PageHeader title="Document Intelligence" desc="Upload, classify and extract. Rule-based extraction produces suggestions — nothing is posted until a human confirms and approves." crumbs={[{ label: "Accounting & Compliance" }, { label: "Documents" }]} />
    <Notice tone="info" title="Capabilities & limits">Existing extracted documents can be reviewed and verified here. <b>OCR for scanned PDFs/images is not configured.</b> New uploads are disabled until secure storage and antivirus scanning are configured.</Notice>
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1"><Card title="Upload document"><Notice tone="warn" title="Temporarily unavailable">Secure object storage and antivirus scanning are not configured. Uploads are disabled; existing documents remain available for review.</Notice></Card>
        <Card title="Library" pad={false}><form className="border-b border-line p-3"><input name="q" defaultValue={sp.q} className="inp" placeholder="Search names & content…" /></form>
          <ul className="max-h-[480px] overflow-auto text-xs">{docs.length === 0 && <li className="p-6"><Empty title="No documents">Upload an invoice or statement to begin.</Empty></li>}{docs.map((d) => <li key={d.id}><Link href={`?id=${d.id}`} className={`flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2 hover:bg-panel2 ${d.id === sel?.id ? "bg-accent/10" : ""}`}><span className="truncate">{d.name}</span><span className="flex shrink-0 gap-1"><Badge>{d.docType.replace("_", " ")}</Badge><Badge tone={d.status === "posted" ? "up" : d.status === "confirmed" ? "accent" : d.status === "needs_ocr" ? "warn" : "neutral"}>{d.status.replace("_", " ")}</Badge></span></Link></li>)}</ul></Card></div>
      <div className="space-y-4 lg:col-span-2">{!sel ? <Empty title="Select a document">Choose a file from the library to review extracted fields, validation results and reconciliation suggestions.</Empty> : (<>
        <Card title={sel.name} subtitle={`${(sel.size / 1024).toFixed(0)} KB · uploaded ${sel.createdAt.toISOString().slice(0, 10)} · sha256 ${sel.sha256.slice(0, 12)}…`} action={<span className="flex gap-1"><a className="btn btn-sm" href={`/api/documents/${sel.id}`}>Download</a>{canApprove && <form action={deleteDocument.bind(null, sel.id)}><button className="btn btn-sm btn-danger">Delete</button></form>}</span>}>
          {dups.length > 0 && <div className="mb-3"><Notice tone="warn">Duplicate content: {dups.map((d) => d.name).join(", ")}</Notice></div>}
          {fields?.note && <div className="mb-3"><Notice tone="warn">{fields.note}</Notice></div>}
          {!!fields?.issues?.length && <div className="mb-3"><Notice tone="warn" title="Validation findings"><ul className="list-disc pl-4">{fields.issues.map((i) => <li key={i}>{i}</li>)}</ul></Notice></div>}
          {canWrite && sel.status !== "posted" && <ActionForm cols={3} resetOnOk={false} submit="Confirm fields" action={confirmFields} fields={[{ name: "id", label: "", defaultValue: sel.id, type: "hidden" }, { name: "docType", label: "Document type", type: "select", options: TYPES.map((t) => [t, t.replace("_", " ")] as [string, string]), defaultValue: sel.docType }, { name: "invoiceNumber", label: "Invoice / doc no.", defaultValue: fields?.fields?.invoiceNumber ?? "" }, { name: "date", label: "Date (YYYY-MM-DD)", defaultValue: fields?.fields?.date ?? "" }, { name: "gstin", label: "GSTIN", defaultValue: fields?.fields?.gstin ?? "" }, { name: "pan", label: "PAN", defaultValue: fields?.fields?.pan ?? "" }, { name: "taxable", label: "Taxable value", defaultValue: fields?.fields?.taxable ?? "" }, { name: "cgst", label: "CGST", defaultValue: fields?.fields?.cgst ?? "" }, { name: "sgst", label: "SGST", defaultValue: fields?.fields?.sgst ?? "" }, { name: "igst", label: "IGST", defaultValue: fields?.fields?.igst ?? "" }, { name: "total", label: "Total", defaultValue: fields?.fields?.total ?? "" }]} />}
          {suggestions.length > 0 && <div className="mt-3"><Notice tone="info" title="Reconciliation suggestions"><ul className="list-disc pl-4">{suggestions.map((s) => <li key={s}>{s}</li>)}</ul></Notice></div>}</Card>
        {canApprove && sel.status === "confirmed" && <Card title="Post to books" subtitle="Creates a purchase voucher: Dr expense (+ input GST) / Cr payable-or-bank. Requires explicit human verification."><ActionForm submit="Post voucher" action={postDocument} resetOnOk={false} fields={[{ name: "id", label: "", defaultValue: sel.id, type: "hidden" }, { name: "expenseId", label: "Debit ledger (expense/asset)", type: "select", options: accs.filter((a) => ["expense", "asset"].includes(a.type)).map((a) => [a.id, `${a.code} ${a.name}`] as [string, string]) }, { name: "creditId", label: "Credit ledger (payable/bank)", type: "select", options: accs.filter((a) => ["ap", "bank", "cash", "other_cl"].includes(a.role)).map((a) => [a.id, `${a.code} ${a.name}`] as [string, string]) }, { name: "date", label: "Voucher date if none extracted", type: "date" }, { name: "verified", label: "I have verified these values against the source document", type: "checkbox", span: 2 }]} /></Card>}
        {sel.status === "posted" && <Notice tone="ok">Posted to the ledger. See the <Link className="underline" href="/accounting?tab=vouchers&type=purchase">purchase vouchers</Link>.</Notice>}
        <Card title="Extracted text preview" pad={false}><pre className="max-h-72 overflow-auto whitespace-pre-wrap p-4 text-[11px] text-muted">{(sel.extractedText ?? "(no text layer)").slice(0, 4000)}</pre></Card></>)}</div></div></>);
}
void inr;
