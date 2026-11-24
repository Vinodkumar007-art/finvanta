"use client";
import { useMemo, useState } from "react";
import { riskMetrics } from "@/engines/portfolio";

export default function RiskLab() {
  const [txt, setTxt] = useState("1.2,0.8\n-0.6,-0.9\n2.1,1.5\n0.4,0.6\n-1.3,-1.1\n1.7,1.2\n0.9,0.7\n-0.4,-0.2\n1.1,0.9\n0.6,0.5\n-0.8,-0.7\n1.9,1.4");
  const [ppy, setPpy] = useState("12"); const [rf, setRf] = useState("6.5");
  const parsed = useMemo(() => { const rows = txt.trim().split(/\r?\n/).map((l) => l.split(",").map((x) => Number(x.trim()) / 100)); return { p: rows.map((r) => r[0]), b: rows.every((r) => r.length >= 2 && Number.isFinite(r[1])) ? rows.map((r) => r[1]) : undefined, ok: rows.every((r) => Number.isFinite(r[0])) }; }, [txt]);
  const m = parsed.ok ? riskMetrics(parsed.p, { periodsPerYear: Number(ppy), riskFree: Number(rf) / 100, benchmark: parsed.b }) : null;
  const pc = (v: number | null | undefined) => (v === null || v === undefined ? "—" : (v * 100).toFixed(2) + "%"); const x = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));
  return (<div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2"><label className="text-xs text-muted">Periodic returns in % — one line per period: <code>portfolio,benchmark</code> (benchmark optional). Sample values shown are illustrative, not your data.</label><textarea className="inp num min-h-48" value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Returns series" /><div className="flex gap-3 text-xs"><label>Periods / year<input className="inp num mt-1" value={ppy} onChange={(e) => setPpy(e.target.value)} /></label><label>Risk-free % p.a.<input className="inp num mt-1" value={rf} onChange={(e) => setRf(e.target.value)} /></label></div></div>
    <div className="rounded-xl border border-line bg-panel p-4">{!m ? <p className="text-sm text-muted">Enter ≥3 numeric periods.</p> : <table className="tbl"><tbody>{[["Cumulative return", pc(m.total), "Π(1+r) − 1"], ["CAGR", pc(m.cagr), "(1+total)^(1/years) − 1"], ["Volatility (ann.)", pc(m.vol), "σ × √periods"], ["Sharpe ratio", x(m.sharpe), "(mean excess return ÷ σ of excess) × √periods"], ["Sortino ratio", x(m.sortino), "mean excess ÷ downside deviation × √periods"], ["Max drawdown", pc(m.maxDrawdown), "min(value ÷ running peak − 1)"], ["Beta", x(m.beta), "cov(r, b) ÷ var(b)"], ["Alpha (Jensen, ann.)", pc(m.alpha), "r − [rf + β(b − rf)]"]].map(([k, v, f]) => <tr key={k}><td>{k}<div className="text-[10px] text-muted">{f}</div></td><td className="r num text-accent">{v}</td></tr>)}</tbody></table>}</div></div>);
}
