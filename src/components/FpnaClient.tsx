"use client";
import { useState, useTransition } from "react";
import { createBudget, saveModel } from "@/actions/analytics";
import { BarsChart } from "@/components/Charts";

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
export function BudgetBuilder({ accounts, monthLabels }: { accounts: { id: string; label: string }[]; monthLabels: string[] }) {
  const [name, setName] = useState(""); const [kind, setKind] = useState("annual"); const [dept, setDept] = useState("");
  const [lines, setLines] = useState<{ accountId: string; amounts: string[] }[]>([{ accountId: accounts[0]?.id ?? "", amounts: Array(12).fill("") }]);
  const [pending, start] = useTransition(); const [msg, setMsg] = useState("");
  const labels = monthLabels.length === 12 ? monthLabels : MONTHS;
  const totals = labels.map((_, i) => lines.reduce((s, l) => s + Number(l.amounts[i] || 0), 0));
  return (<div className="space-y-3">
    <div className="grid grid-cols-3 gap-3"><label className="text-xs"><span className="mb-1 block text-muted">Budget name</span><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="text-xs"><span className="mb-1 block text-muted">Type</span><select className="inp" value={kind} onChange={(e) => setKind(e.target.value)}><option value="annual">Annual</option><option value="department">Department</option><option value="project">Project</option></select></label><label className="text-xs"><span className="mb-1 block text-muted">Department / project</span><input className="inp" value={dept} onChange={(e) => setDept(e.target.value)} /></label></div>
    <div className="overflow-auto"><table className="tbl"><thead><tr><th>Ledger</th>{labels.map((m) => <th key={m} className="r">{m}</th>)}<th /></tr></thead><tbody>{lines.map((l, i) => (<tr key={i}><td className="min-w-48"><select className="inp" value={l.accountId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
      {l.amounts.map((a, m) => <td key={m}><input className="inp num w-20 text-right" aria-label={`${labels[m]} amount`} value={a} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amounts: x.amounts.map((y, k) => (k === m ? e.target.value : y)) } : x)))} /></td>)}
      <td className="whitespace-nowrap"><button className="btn btn-sm" title="Fill all months with the first month's value" onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, amounts: Array(12).fill(x.amounts[0] || "0") } : x)))}>Fill year</button>{lines.length > 1 && <button className="btn btn-sm ml-1" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</td></tr>))}</tbody>
      <tfoot><tr className="font-semibold"><td>Total</td>{totals.map((t, i) => <td key={i} className="r num">{t.toLocaleString("en-IN")}</td>)}<td /></tr></tfoot></table></div>
    <div className="flex items-center gap-2"><button className="btn btn-sm" onClick={() => setLines([...lines, { accountId: accounts[0]?.id ?? "", amounts: Array(12).fill("") }])}>＋ Add line</button>
      <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { try { await createBudget(name, kind, dept, lines.map((l) => ({ ...l, amounts: l.amounts.map((a) => a || "0") }))); setMsg("Budget saved as draft. Submit it for approval below."); setName(""); } catch (e) { setMsg((e as Error).message); } })}>Save draft budget</button><span className="text-xs text-muted" role="status">{msg}</span></div></div>);
}

export function Headcount({ canWrite }: { canWrite: boolean }) {
  const [rows, setRows] = useState([{ role: "Accountant", count: "2", cost: "55000", start: "1" }, { role: "Analyst", count: "1", cost: "70000", start: "4" }]);
  const [inc, setInc] = useState("8"); const [pending, start] = useTransition(); const [msg, setMsg] = useState("");
  const monthly = MONTHS.map((m, i) => ({ m, cost: Math.round(rows.reduce((s, r) => s + (i + 1 >= Number(r.start) ? Number(r.count) * Number(r.cost) : 0), 0)), heads: rows.reduce((s, r) => s + (i + 1 >= Number(r.start) ? Number(r.count) : 0), 0) }));
  const annual = monthly.reduce((s, x) => s + x.cost, 0);
  return (<div className="space-y-3"><table className="tbl"><thead><tr><th>Role</th><th className="r">Headcount</th><th className="r">Monthly cost / head</th><th className="r">Start month (1=first)</th><th /></tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{(["role", "count", "cost", "start"] as const).map((k) => <td key={k}><input className={`inp ${k === "role" ? "" : "num text-right"}`} value={r[k]} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>)}<td><button className="btn btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table>
    <div className="flex items-center gap-3"><button className="btn btn-sm" onClick={() => setRows([...rows, { role: "", count: "1", cost: "0", start: "1" }])}>＋ Add role</button><label className="flex items-center gap-2 text-xs text-muted">Annual increment %<input className="inp num !w-16" value={inc} onChange={(e) => setInc(e.target.value)} /></label><span className="num text-sm">Year cost: <b>₹{annual.toLocaleString("en-IN")}</b> · next year @ {inc}%: ₹{Math.round(annual * (1 + Number(inc) / 100)).toLocaleString("en-IN")}</span>
      {canWrite && <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { try { await saveModel("headcount", "Headcount plan", { rows, inc }, { annual }); setMsg("Saved."); } catch (e) { setMsg((e as Error).message); } })}>Save plan</button>}<span className="text-xs text-muted">{msg}</span></div>
    <BarsChart height={200} data={monthly.map((x) => ({ m: x.m, "Payroll cost": x.cost }))} x="m" series={[{ key: "Payroll cost" }]} /></div>);
}

export function ScenarioPlanner({ revenue, expenses, months }: { revenue: number; expenses: number; months: number }) {
  const [s, setS] = useState({ rev: "10", cost: "5" });
  const ann = (v: number) => (months > 0 ? (v / months) * 12 : 0);
  const rows = [["Downside", -1], ["Base", 0], ["Upside", 1]].map(([l, k]) => { const r = ann(revenue) * (1 + (Number(s.rev) / 100) * (k as number)); const c = ann(expenses) * (1 + (Number(s.cost) / 100) * (k as number) * (k === -1 ? -1 : 1)); return { l: l as string, r, c, p: r - c }; });
  return (<div className="space-y-3"><div className="flex gap-3 text-xs"><label>Revenue swing ± %<input className="inp num mt-1" value={s.rev} onChange={(e) => setS({ ...s, rev: e.target.value })} /></label><label>Cost swing ± %<input className="inp num mt-1" value={s.cost} onChange={(e) => setS({ ...s, cost: e.target.value })} /></label></div>
    <table className="tbl"><thead><tr><th>Scenario</th><th className="r">Annualised revenue</th><th className="r">Annualised costs</th><th className="r">Operating result</th></tr></thead><tbody>{rows.map((x) => <tr key={x.l}><td>{x.l}</td><td className="r num">{Math.round(x.r).toLocaleString("en-IN")}</td><td className="r num">{Math.round(x.c).toLocaleString("en-IN")}</td><td className={`r num ${x.p < 0 ? "text-down" : ""}`}>{Math.round(x.p).toLocaleString("en-IN")}</td></tr>)}</tbody></table>
    <p className="text-[11px] text-muted">Annualises year-to-date actuals over {months} active month(s); downside = lower revenue and higher costs. A what-if aid — not a forecast.</p></div>);
}
