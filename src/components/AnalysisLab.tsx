"use client";
import { useMemo, useState, useTransition } from "react";
import { altmanZ, commonSize, computeRatios, derive, growth, piotroski, type Stmt } from "@/engines/ratios";
import { BarsChart, LinesChart } from "@/components/Charts";
import StatementEditor from "@/components/StatementEditor";
import { saveStatement } from "@/actions/analytics";

type P = { id: string; label: string; periodEnd: string; kind: string; source: string; data: Stmt };
const BENCH_NOTE = "Benchmarks are generic rules of thumb, not industry statistics — compare with sector peers.";
const fmt = (v: number | null, unit: string) => (v === null ? "n/a" : unit === "%" ? `${(v * 100).toFixed(2)}%` : unit === "days" ? `${v.toFixed(0)} d` : unit === "₹" ? v.toFixed(2) : `${v.toFixed(2)}x`);
const n0 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function AnalysisLab({ periods, canWrite }: { periods: P[]; canWrite: boolean }) {
  const [tab, setTab] = useState<"ratios" | "common" | "trend" | "scores" | "input">("ratios");
  const [idx, setIdx] = useState(periods.length ? periods.length - 1 : 0);
  const [draft, setDraft] = useState<Stmt>({}); const [label, setLabel] = useState(""); const [end, setEnd] = useState(""); const [kind, setKind] = useState("annual");
  const [pending, start] = useTransition(); const [msg, setMsg] = useState("");
  const cur = periods[idx]; const prev = idx > 0 ? periods[idx - 1] : undefined;
  const ratios = useMemo(() => (cur ? computeRatios(cur.data, prev?.data) : []), [cur, prev]);
  const cs = useMemo(() => (cur ? commonSize(cur.data) : null), [cur]);
  const cats = [...new Set(ratios.map((r) => r.category))];
  const series = periods.map((p) => { const d = derive(p.data); return { label: p.label.replace(/ \[DEMO\]| \(ledger snapshot\)/g, ""), Revenue: p.data.revenue ?? 0, EBITDA: d.ebitda, "Net profit": d.pat, "Gross margin %": +(((d.grossProfit / (p.data.revenue || 1)) * 100)).toFixed(1), "Net margin %": +((d.pat / (p.data.revenue || 1)) * 100).toFixed(1) }; });
  const z = cur ? altmanZ(cur.data, "manufacturing") : null; const z2 = cur ? altmanZ(cur.data, "non-manufacturing") : null; const pf = cur && prev ? piotroski(cur.data, prev.data) : null;
  const T = (id: typeof tab, l: string) => <button key={id} className={`btn btn-sm ${tab === id ? "btn-primary" : ""}`} onClick={() => setTab(id)}>{l}</button>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {T("ratios", "Ratios")}{T("common", "Common-size & horizontal")}{T("trend", "Trends & growth")}{T("scores", "Altman · Piotroski")}{canWrite && T("input", "Enter / import statements")}
        {periods.length > 0 && <label className="ml-auto flex items-center gap-2 text-xs text-muted">Period <select className="inp !w-auto" value={idx} onChange={(e) => setIdx(Number(e.target.value))}>{periods.map((p, i) => <option key={p.id} value={i}>{p.label}{p.source === "demo" ? "" : ""}</option>)}</select></label>}
      </div>
      {periods.length === 0 && tab !== "input" && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">No statements yet. Take a ledger snapshot or enter/import statements.</div>}
      {cur && tab === "ratios" && (<div className="space-y-4">
        <p className="text-xs text-muted">{cur.label} · source: <b>{cur.source}</b>{cur.source === "demo" && " — illustrative demo data"}. Averages use the prior period when available ({prev ? prev.label : "none: closing balances used"}). {BENCH_NOTE}</p>
        {cats.map((c) => (<div key={c} className="overflow-hidden rounded-xl border border-line"><div className="border-b border-line bg-panel2 px-3 py-1.5 text-xs font-semibold">{c}</div>
          <table className="tbl"><thead><tr><th>Ratio</th><th className="r">Value</th><th>Formula</th><th>With your inputs</th><th>Reference</th></tr></thead><tbody>{ratios.filter((r) => r.category === c).map((r) => <tr key={r.key}><td className="font-medium">{r.name}</td><td className="r num text-accent">{fmt(r.value, r.unit)}</td><td className="text-muted">{r.formula}</td><td className="num text-muted">{r.inputs}</td><td className="text-muted">{r.benchmark ?? ""}</td></tr>)}</tbody></table></div>))}
        {(cur.data.shares ?? 0) === 0 && <p className="text-xs text-warn">Valuation ratios need shares outstanding and price — add them under “Enter / import statements”.</p>}</div>)}
      {cur && cs && tab === "common" && (<div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line"><div className="border-b border-line px-3 py-2 text-sm font-semibold">Common-size income statement (% of revenue) — vertical analysis</div><table className="tbl"><tbody>{cs.income.map((r) => <tr key={r.label}><td>{r.label}</td><td className="r num">{n0(r.value)}</td><td className="r num text-accent">{r.pct === null ? "—" : (r.pct * 100).toFixed(1) + "%"}</td></tr>)}</tbody></table></div>
        <div className="rounded-xl border border-line"><div className="border-b border-line px-3 py-2 text-sm font-semibold">Common-size balance sheet (% of total assets)</div><table className="tbl"><tbody>{cs.balance.map((r) => <tr key={r.label}><td>{r.label}</td><td className="r num">{n0(r.value)}</td><td className="r num text-accent">{r.pct === null ? "—" : (r.pct * 100).toFixed(1) + "%"}</td></tr>)}</tbody></table></div>
        <div className="rounded-xl border border-line lg:col-span-2"><div className="border-b border-line px-3 py-2 text-sm font-semibold">Horizontal analysis — change vs first period ({periods[0].label})</div><div className="overflow-auto"><table className="tbl"><thead><tr><th>Line</th>{periods.map((p) => <th key={p.id} className="r">{p.label.slice(0, 18)}</th>)}</tr></thead><tbody>{[["Revenue", (s: Stmt) => s.revenue ?? 0], ["Gross profit", (s: Stmt) => derive(s).grossProfit], ["EBITDA", (s: Stmt) => derive(s).ebitda], ["Net profit", (s: Stmt) => derive(s).pat], ["Total assets", (s: Stmt) => derive(s).totalAssets], ["Equity", (s: Stmt) => s.equity ?? 0]].map(([l, f]) => { const fn = f as (s: Stmt) => number; const b = fn(periods[0].data); return <tr key={String(l)}><td>{String(l)}</td>{periods.map((p) => { const g = growth(fn(p.data), b); return <td key={p.id} className="r num">{n0(fn(p.data))} <span className="text-muted">{g === null ? "" : `(${g >= 0 ? "+" : ""}${(g * 100).toFixed(0)}%)`}</span></td>; })}</tr>; })}</tbody></table></div></div></div>)}
      {tab === "trend" && periods.length > 0 && (<div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line p-3"><h3 className="mb-2 text-sm font-semibold">Revenue, EBITDA & net profit</h3><BarsChart data={series} x="label" series={[{ key: "Revenue" }, { key: "EBITDA", color: "#14b8a6" }, { key: "Net profit", color: "#94a3b8" }]} /></div>
        <div className="rounded-xl border border-line p-3"><h3 className="mb-2 text-sm font-semibold">Margin trend</h3><LinesChart data={series} x="label" series={[{ key: "Gross margin %" }, { key: "Net margin %", color: "#fbbf24" }]} /></div>
        <div className="rounded-xl border border-line lg:col-span-2"><div className="border-b border-line px-3 py-2 text-sm font-semibold">Period-on-period growth (YoY for annual, QoQ for quarterly series)</div><table className="tbl"><thead><tr><th>Period</th><th>Type</th><th className="r">Revenue growth</th><th className="r">Profit growth</th><th className="r">Asset growth</th></tr></thead><tbody>{periods.map((p, i) => { const q = i ? periods[i - 1] : null; const g = (a: number, b: number) => { const x = growth(a, b); return x === null ? "—" : `${(x * 100).toFixed(1)}%`; }; return <tr key={p.id}><td>{p.label}</td><td>{p.kind === "quarterly" ? "QoQ" : "YoY"}</td><td className="r num">{q ? g(p.data.revenue ?? 0, q.data.revenue ?? 0) : "—"}</td><td className="r num">{q ? g(derive(p.data).pat, derive(q.data).pat) : "—"}</td><td className="r num">{q ? g(derive(p.data).totalAssets, derive(q.data).totalAssets) : "—"}</td></tr>; })}</tbody></table></div>
        <p className="text-xs text-muted lg:col-span-2">Segment analysis requires segment-level data, which the ledger does not carry; tag voucher lines with cost centres and use the MIS pivot studio for departmental views.</p></div>)}
      {cur && tab === "scores" && (<div className="grid gap-4 lg:grid-cols-2">
        {[{ t: "Altman Z-score (manufacturing, public)", r: z }, { t: "Altman Z″-score (non-manufacturing / emerging markets)", r: z2 }].map(({ t, r }) => (<div key={t} className="rounded-xl border border-line p-4"><h3 className="text-sm font-semibold">{t}</h3>{r ? (<><div className="num my-2 text-3xl font-bold text-accent">{r.z.toFixed(2)} <span className={`text-sm ${r.zone === "Safe" ? "text-up" : r.zone === "Distress" ? "text-down" : "text-warn"}`}>{r.zone}</span></div><p className="text-xs text-muted">{r.formula}<br />{r.cutoffs}<br />Components: {Object.entries(r.components).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(", ")}</p></>) : <p className="text-xs text-muted">Insufficient data.</p>}<p className="mt-2 text-[11px] text-muted">Retained earnings falls back to total equity if not entered. Statistical model: a screening aid, not a prediction of default.</p></div>))}
        <div className="rounded-xl border border-line p-4 lg:col-span-2"><h3 className="text-sm font-semibold">Piotroski F-score</h3>{pf ? (<><div className="num my-2 text-3xl font-bold text-accent">{pf.score} / 9 <span className="text-sm text-muted">{pf.band}</span></div><ul className="grid gap-1 text-xs md:grid-cols-2">{pf.signals.map((s) => <li key={s.name}>{s.pass ? "✅" : "❌"} {s.name}</li>)}</ul></>) : <p className="text-xs text-muted">Needs two consecutive periods — choose a period that has a prior one.</p>}</div></div>)}
      {tab === "input" && canWrite && (<div className="space-y-3">
        <div className="grid grid-cols-3 gap-3"><label className="text-xs"><span className="mb-1 block text-muted">Label</span><input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="FY 2024-25 / Q2 FY26" /></label><label className="text-xs"><span className="mb-1 block text-muted">Period end</span><input type="date" className="inp" value={end} onChange={(e) => setEnd(e.target.value)} /></label><label className="text-xs"><span className="mb-1 block text-muted">Type</span><select className="inp" value={kind} onChange={(e) => setKind(e.target.value)}><option value="annual">Annual</option><option value="quarterly">Quarterly</option></select></label></div>
        <StatementEditor value={draft} onChange={setDraft} />
        <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => { try { await saveStatement(label, end, kind, draft); setMsg("Saved — select it from the period list."); setDraft({}); } catch (e) { setMsg((e as Error).message); } })}>Save period</button>{msg && <span className="ml-3 text-xs text-muted" role="status">{msg}</span>}</div>)}
    </div>
  );
}
