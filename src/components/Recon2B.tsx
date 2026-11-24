"use client";
import { useState } from "react";
import { reconcile2B, type GstRegisterRow } from "@/engines/tax";
import DataTable from "@/components/DataTable";

const SAMPLE = "gstin,invoice_no,date,taxable,cgst,sgst,igst\n";
export default function Recon2B({ books }: { books: GstRegisterRow[] }) {
  const [text, setText] = useState(SAMPLE); const [rows, setRows] = useState<ReturnType<typeof reconcile2B> | null>(null); const [err, setErr] = useState("");
  const run = () => {
    setErr("");
    const lines = text.trim().split(/\r?\n/).slice(1).filter(Boolean);
    if (!lines.length) { setErr("Paste GSTR-2B rows (CSV from the portal export, columns: gstin, invoice_no, date, taxable, cgst, sgst, igst)."); return; }
    const parsed: GstRegisterRow[] = [];
    for (const [i, l] of lines.entries()) {
      const c = l.split(",").map((x) => x.trim());
      if (c.length < 7 || [3, 4, 5, 6].some((k) => c[k] === "" || isNaN(Number(c[k])))) { setErr(`Row ${i + 2} is malformed: expected 7 comma-separated columns with numeric amounts.`); return; }
      parsed.push({ gstin: c[0], invoiceNo: c[1], date: c[2], taxable: c[3], cgst: c[4], sgst: c[5], igst: c[6] });
    }
    setRows(reconcile2B(books, parsed));
  };
  const sum = (s: string) => rows?.filter((r) => r.status === s).length ?? 0;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Compares your approved purchase register ({books.length} invoices) with supplier-reported GSTR-2B rows. Matching key: supplier GSTIN + invoice number; tax difference tolerance ₹1. Runs entirely in your browser; nothing is submitted.</p>
      <textarea className="inp num min-h-32" aria-label="GSTR-2B CSV" value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div role="alert" className="text-xs text-down">{err}</div>}
      <button className="btn btn-primary" onClick={run}>Reconcile</button>
      {rows && (<><div className="flex gap-4 text-xs"><span className="text-up">Matched {sum("matched")}</span><span className="text-warn">Mismatch {sum("mismatch")}</span><span className="text-down">Missing in 2B {sum("missing_in_2b")} (ITC at risk)</span><span className="text-down">Missing in books {sum("missing_in_books")}</span></div>
        <DataTable title="gstr2b-reconciliation" columns={[{ key: "status", label: "Status", kind: "tone" }, { key: "gstin", label: "GSTIN" }, { key: "invoiceNo", label: "Invoice" }, { key: "booksTax", label: "Books tax", kind: "money" }, { key: "portalTax", label: "2B tax", kind: "money" }, { key: "diff", label: "Difference", kind: "money" }]} rows={rows} /></>)}
    </div>
  );
}
