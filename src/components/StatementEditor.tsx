"use client";
import { useState } from "react";
import { STMT_FIELDS, type Stmt } from "@/engines/ratios";

const ALIAS: [string, RegExp][] = [["revenue", /^(total )?(revenue|sales|turnover|net sales)/i], ["cogs", /cost of (goods|sales|materials)|cogs|purchases/i], ["opex", /operating expenses|employee|admin|selling/i], ["depreciation", /depreciation|amortis/i], ["otherIncome", /other income/i], ["interest", /interest|finance cost/i], ["tax", /tax expense|income tax|provision for tax/i], ["cash", /cash|bank balance/i], ["receivables", /receivable|debtors/i], ["inventory", /inventor|stock/i], ["payables", /payable|creditors/i], ["shortDebt", /short.?term (debt|borrow)/i], ["longDebt", /long.?term (debt|borrow|loan)/i], ["equity", /total equity|shareholders|net worth/i], ["fixedAssets", /fixed assets|property, plant|ppe/i], ["cfo", /operating activities|cash from operations|cfo/i], ["capex", /capital expenditure|capex|purchase of fixed/i], ["dividends", /dividend/i], ["shares", /shares outstanding|no\. of shares/i], ["price", /share price|market price/i]];

export function parsePaste(text: string): Stmt {
  const out: Stmt = {};
  text.split(/\r?\n/).forEach((line) => {
    const parts = line.split(/\t|,(?=\s*[-\d(])/); if (parts.length < 2) return;
    const label = parts[0].trim(); const v = Number(parts[1].replace(/[,₹\s]/g, "").replace(/^\((.*)\)$/, "-$1")); if (!Number.isFinite(v)) return;
    const hit = ALIAS.find(([, re]) => re.test(label)); if (hit && out[hit[0]] === undefined) out[hit[0]] = v;
  });
  return out;
}

export default function StatementEditor({ value, onChange }: { value: Stmt; onChange: (s: Stmt) => void }) {
  const [paste, setPaste] = useState(""); const [msg, setMsg] = useState("");
  const groups = ["Income statement", "Balance sheet", "Cash flow & market"] as const;
  return (
    <div className="space-y-3">
      <details className="rounded-lg border border-line p-2 text-xs"><summary className="cursor-pointer font-semibold">Paste from a spreadsheet (label, value per line)</summary>
        <textarea className="inp mt-2 num min-h-24" placeholder={"Revenue, 12500000\nCost of goods sold, 7800000\nTrade receivables, 1800000"} value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn btn-sm mt-2" onClick={() => { const p = parsePaste(paste); setMsg(`Mapped ${Object.keys(p).length} fields by label matching — verify below.`); onChange({ ...value, ...p }); }}>Map & fill</button>{msg && <span className="ml-2 text-muted">{msg}</span>}</details>
      {groups.map((g) => (<div key={g}><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</h4><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{STMT_FIELDS.filter((f) => f.group === g).map((f) => (
        <label key={f.key} className="text-[11px]"><span className="mb-0.5 block text-muted">{f.label}</span><input className="inp num" inputMode="decimal" value={value[f.key] ?? ""} onChange={(e) => { const n = { ...value }; if (e.target.value === "") delete n[f.key]; else n[f.key] = Number(e.target.value); onChange(n); }} /></label>))}</div></div>))}
    </div>
  );
}
