"use client";
import { useMemo, useState } from "react";
import DataTable from "@/components/DataTable";

function parse(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((l) => { const out: string[] = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(c); c = ""; } else c += ch; } out.push(c); return out; });
}
export default function DataCleaner() {
  const [text, setText] = useState("Name,Amount,Date\n Acme Ltd ,\"1,200.50\",01/04/2025\nacme ltd,1200.5,2025-04-01\nBeta Corp,,03/04/2025\nGamma,abc,05/04/2025");
  const [ops, setOps] = useState({ trim: true, dedupe: true, dropEmpty: true, numeric: true, titleCase: false, isoDates: true });
  const { rows, log, cols } = useMemo(() => {
    const raw = parse(text); const head = raw[0] ?? []; let body = raw.slice(1); const l: string[] = [`Loaded ${body.length} rows × ${head.length} columns`];
    if (ops.trim) { body = body.map((r) => r.map((c) => c.trim().replace(/\s+/g, " "))); l.push("Trimmed whitespace"); }
    if (ops.titleCase) { body = body.map((r) => r.map((c) => (/^[A-Za-z .&-]+$/.test(c) ? c.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : c))); l.push("Title-cased text cells"); }
    if (ops.isoDates) { let n = 0; body = body.map((r) => r.map((c) => { const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(c); if (m) { n++; return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; } return c; })); l.push(`Converted ${n} dd/mm/yyyy dates to ISO (assumes day-first)`); }
    if (ops.numeric) { let n = 0, bad = 0; body = body.map((r) => r.map((c, i) => { if (/amount|value|total|qty|price|debit|credit/i.test(head[i] ?? "")) { const v = c.replace(/[,₹\s]/g, ""); if (v === "") return c; if (!isNaN(Number(v))) { if (v !== c) n++; return String(Number(v)); } bad++; return c; } return c; })); l.push(`Normalised ${n} numeric cells; ${bad} non-numeric values left for review`); }
    if (ops.dropEmpty) { const b = body.length; body = body.filter((r) => r.every((c) => c !== "")); l.push(`Dropped ${b - body.length} rows with empty cells`); }
    if (ops.dedupe) { const seen = new Set<string>(); const b = body.length; body = body.filter((r) => { const k = r.map((c) => c.toLowerCase()).join("|"); if (seen.has(k)) return false; seen.add(k); return true; }); l.push(`Removed ${b - body.length} duplicate rows (case-insensitive)`); }
    return { rows: body.map((r) => Object.fromEntries(head.map((h, i) => [h || `col${i}`, r[i] ?? ""]))), log: l, cols: head.map((h, i) => ({ key: h || `col${i}`, label: h || `col${i}` })) };
  }, [text, ops]);
  const dl = () => { const csv = [cols.map((c) => c.label).join(","), ...rows.map((r) => cols.map((c) => `"${String((r as Record<string, string>)[c.key]).replace(/"/g, '""')}"`).join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "cleaned.csv"; a.click(); };
  return (<div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2"><label className="text-xs text-muted">Paste CSV</label><textarea className="inp num min-h-48" value={text} onChange={(e) => setText(e.target.value)} />
    <div className="flex flex-wrap gap-3 text-xs">{(Object.keys(ops) as (keyof typeof ops)[]).map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={ops[k]} onChange={(e) => setOps({ ...ops, [k]: e.target.checked })} />{{ trim: "Trim", dedupe: "De-duplicate", dropEmpty: "Drop incomplete rows", numeric: "Normalise numbers", titleCase: "Title case", isoDates: "ISO dates" }[k]}</label>)}</div>
    <ul className="list-disc pl-5 text-[11px] text-muted">{log.map((x) => <li key={x}>{x}</li>)}</ul></div>
    <div><div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted">Result ({rows.length} rows) — runs in your browser</span><button className="btn btn-sm" onClick={dl}>Download CSV</button></div><DataTable title="cleaned" columns={cols} rows={rows as never} searchable={false} /></div></div>);
}
