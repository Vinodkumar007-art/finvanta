"use client";
import { useMemo, useState } from "react";
import { advanceTaxSchedule, capitalGain, capitalGainsTax, computeTds, gstLateFeeAndInterest, gstSplit, incomeTax, TAX_RULES, type CgAssetType } from "@/engines/tax";
import { calcRecord, type CalcRecord } from "@/engines/core";
import { saveCalcLog } from "@/actions/tax";
import { BarsChart } from "@/components/Charts";

const n = (s: string) => (s === "" || isNaN(Number(s)) ? 0 : Number(s));
const inr = (v: { toFixed(d: number): string } | number, dp = 0) => Number(typeof v === "number" ? v : v.toFixed(2)).toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });
function F({ l, v, set, t = "text" }: { l: string; v: string; set: (x: string) => void; t?: string }) { return <label className="block text-xs"><span className="mb-1 block text-muted">{l}</span><input className="inp num" type={t} value={v} onChange={(e) => set(e.target.value)} /></label>; }
function Audit({ rec }: { rec: CalcRecord }) {
  return (<details className="mt-3 rounded-lg border border-line p-2 text-[11px] text-muted"><summary className="cursor-pointer font-semibold text-fg">Calculation audit — inputs, formula, assumptions, source</summary>
    <div className="mt-1 space-y-0.5"><div>Formula: {rec.formula}</div><div>Inputs: <code>{JSON.stringify(rec.inputs)}</code></div><div>Assumptions: {rec.assumptions.join(" ")}</div><div>Source: {rec.source} · {rec.timestamp}</div>
      <button className="btn btn-sm mt-1" onClick={() => void saveCalcLog(rec)}>Save to calculation log</button></div></details>);
}

export function GstCalc({ stateCode }: { stateCode: string }) {
  const [taxable, setT] = useState("100000"); const [rate, setR] = useState("18"); const [inter, setI] = useState(false);
  const g = useMemo(() => gstSplit(taxable || "0", n(rate), stateCode, inter ? "99" : stateCode), [taxable, rate, inter, stateCode]);
  const rec = calcRecord("GST", "CGST=SGST=taxable×rate/200 (intra); IGST=taxable×rate/100 (inter)", { taxable, rate, interstate: inter }, { cgst: g.cgst.toFixed(2), sgst: g.sgst.toFixed(2), igst: g.igst.toFixed(2), total: g.total.toFixed(2) }, ["Rate chosen by user; confirm HSN/SAC rate on the current schedule."], "FINVANTA tax engine");
  return (<div className="space-y-3"><div className="grid grid-cols-3 gap-3"><F l="Taxable value" v={taxable} set={setT} /><label className="text-xs"><span className="mb-1 block text-muted">GST rate %</span><select className="inp" value={rate} onChange={(e) => setR(e.target.value)}>{TAX_RULES.gstSlabs.map((s) => <option key={s}>{s}</option>)}</select></label><label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={inter} onChange={(e) => setI(e.target.checked)} />Inter-state supply</label></div>
    <table className="tbl"><tbody>{[["CGST", g.cgst], ["SGST/UTGST", g.sgst], ["IGST", g.igst]].map(([k, v]) => <tr key={String(k)}><td>{String(k)}</td><td className="r num">{inr(v as never, 2)}</td></tr>)}<tr className="font-semibold"><td>Invoice total</td><td className="r num">{inr(n(taxable) + Number(g.total.toFixed(2)), 2)}</td></tr></tbody></table><Audit rec={rec} /></div>);
}

export function LateFeeCalc() {
  const [days, setD] = useState("15"); const [nil, setN] = useState(false); const [tax, setTax] = useState("50000");
  const rec = useMemo(() => gstLateFeeAndInterest({ daysLate: n(days), nil, netCashTax: tax || "0" }), [days, nil, tax]);
  const r = rec.result as { lateFee: string; interest: string; total: string };
  return (<div className="space-y-3"><div className="grid grid-cols-3 gap-3"><F l="Days late" v={days} set={setD} /><F l="Net cash tax payable" v={tax} set={setTax} /><label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={nil} onChange={(e) => setN(e.target.checked)} />Nil return</label></div>
    <table className="tbl"><tbody><tr><td>Late fee</td><td className="r num">{inr(Number(r.lateFee), 2)}</td></tr><tr><td>Interest @18% p.a.</td><td className="r num">{inr(Number(r.interest), 2)}</td></tr><tr className="font-semibold"><td>Estimated total</td><td className="r num">{inr(Number(r.total), 2)}</td></tr></tbody></table><Audit rec={rec} /></div>);
}

export function TdsCalc({ sections }: { sections: { section: string; description: string; rateIndividual: string; rateOther: string; singleThreshold: string; annualThreshold: string }[] }) {
  const [sec, setSec] = useState(sections[1]?.section ?? sections[0]?.section); const [amt, setAmt] = useState("75000"); const [ytd, setYtd] = useState("0"); const [type, setType] = useState<"individual" | "company">("company"); const [pan, setPan] = useState(true);
  const cfg = sections.find((s) => s.section === sec)!;
  const rec = useMemo(() => computeTds(cfg, { amount: amt || "0", deducteeType: type, panAvailable: pan, paidYtd: ytd || "0" }), [cfg, amt, ytd, type, pan]);
  const r = rec.result as { applicable: boolean; base: string; rate: string; tds: string };
  return (<div className="space-y-3"><div className="grid grid-cols-2 gap-3 md:grid-cols-3"><label className="text-xs md:col-span-3"><span className="mb-1 block text-muted">Section</span><select className="inp" value={sec} onChange={(e) => setSec(e.target.value)}>{sections.map((s) => <option key={s.section} value={s.section}>{s.section} — {s.description}</option>)}</select></label>
    <F l="Payment amount" v={amt} set={setAmt} /><F l="Paid to deductee YTD (same section)" v={ytd} set={setYtd} /><label className="text-xs"><span className="mb-1 block text-muted">Deductee</span><select className="inp" value={type} onChange={(e) => setType(e.target.value as "individual")}><option value="company">Company / firm</option><option value="individual">Individual / HUF</option></select></label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={pan} onChange={(e) => setPan(e.target.checked)} />PAN available</label></div>
    <table className="tbl"><tbody><tr><td>TDS applicable?</td><td className="r">{r.applicable ? "Yes" : "No (below threshold)"}</td></tr><tr><td>Taxable base</td><td className="r num">{inr(Number(r.base), 2)}</td></tr><tr><td>Rate</td><td className="r num">{r.rate}%</td></tr><tr className="font-semibold"><td>TDS to deduct (rounded to ₹1)</td><td className="r num">{inr(Number(r.tds))}</td></tr></tbody></table><Audit rec={rec} /></div>);
}

export function IncomeTaxCalc() {
  const [v, setV] = useState({ salary: "1800000", other: "50000", house: "0", c80: "150000", d80: "25000", nps: "50000", hra: "120000", hl: "0", enps: "0", tds: "0" });
  const s = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const base = { salary: n(v.salary), otherIncome: n(v.other), houseIncome: n(v.house), s80C: n(v.c80), s80D: n(v.d80), s80CCD1B: n(v.nps), hra: n(v.hra), homeLoanInterest: n(v.hl), employerNps: n(v.enps), otherDeductions: 0, tdsPaid: n(v.tds) };
  const nw = useMemo(() => incomeTax({ ...base, regime: "new" }), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const od = useMemo(() => incomeTax({ ...base, regime: "old" }), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = nw.totalTax.lte(od.totalTax) ? "new" : "old"; const saving = nw.totalTax.minus(od.totalTax).abs();
  const adv = advanceTaxSchedule(best === "new" ? nw.netPayable : od.netPayable);
  const rec = calcRecord("Income tax regime comparison", "Slab tax − s.87A rebate + surcharge + 4% cess; old regime allows deductions", { ...v, fy: TAX_RULES.fy }, { new: nw.totalTax.toFixed(0), old: od.totalTax.toFixed(0), better: best }, [`Parameters for FY ${TAX_RULES.fy}; verify at incometax.gov.in.`, "Surcharge marginal relief and special-rate incomes not modelled here; HRA exemption entered by you."], "FINVANTA tax engine");
  return (<div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-5"><F l="Salary (gross)" v={v.salary} set={s("salary")} /><F l="Other income" v={v.other} set={s("other")} /><F l="House property (net)" v={v.house} set={s("house")} /><F l="80C" v={v.c80} set={s("c80")} /><F l="80D" v={v.d80} set={s("d80")} /><F l="80CCD(1B) NPS" v={v.nps} set={s("nps")} /><F l="HRA exemption" v={v.hra} set={s("hra")} /><F l="Home-loan interest 24(b)" v={v.hl} set={s("hl")} /><F l="Employer NPS 80CCD(2)" v={v.enps} set={s("enps")} /><F l="TDS / advance tax paid" v={v.tds} set={s("tds")} /></div>
    <div className="grid gap-3 md:grid-cols-2">{[nw, od].map((r) => (<div key={r.regime} className={`rounded-xl border p-3 ${r.regime === best ? "border-accent glow" : "border-line"}`}><div className="mb-2 flex items-center justify-between text-sm font-semibold">{r.regime === "new" ? "New regime (115BAC)" : "Old regime"} {r.regime === best && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accentfg">LOWER TAX</span>}</div>
      <table className="tbl"><tbody>{[["Gross income", r.gross], ["Standard deduction", r.standardDeduction], ["Chapter VI-A / other deductions", r.deductions], ["Taxable income", r.taxable], ["Slab tax", r.slabTax], ["Rebate u/s 87A / marginal relief", r.rebate], ["Surcharge", r.surcharge], ["Cess (4%)", r.cess]].map(([k, x]) => <tr key={String(k)}><td>{String(k)}</td><td className="r num">{inr(x as never)}</td></tr>)}<tr className="font-semibold"><td>Total tax</td><td className="r num">{inr(r.totalTax)}</td></tr><tr><td>Net payable after TDS</td><td className="r num">{inr(r.netPayable)}</td></tr></tbody></table></div>))}</div>
    <p className="text-sm">{best === "new" ? "New" : "Old"} regime is lower by <b className="num">₹{inr(saving)}</b> on these inputs.</p>
    <BarsChart height={180} data={[{ k: "New regime", tax: Number(nw.totalTax.toFixed(0)) }, { k: "Old regime", tax: Number(od.totalTax.toFixed(0)) }]} x="k" series={[{ key: "tax", name: "Total tax" }]} />
    {adv.applicable && <div><h4 className="mb-1 text-xs font-semibold">Advance tax schedule (lower-tax regime, net of TDS)</h4><table className="tbl"><thead><tr><th>Due</th><th className="r">Cumulative %</th><th className="r">Cumulative</th><th className="r">Instalment</th></tr></thead><tbody>{adv.rows.map((r) => <tr key={r.due}><td>{r.due}</td><td className="r num">{r.cumulativePct}%</td><td className="r num">{inr(Number(r.cumulative))}</td><td className="r num">{inr(Number(r.instalment))}</td></tr>)}</tbody></table></div>}
    <Audit rec={rec} /></div>);
}

type CgRow = { type: CgAssetType; buy: string; sell: string; months: string; exp: string };
export function CapGainsCalc() {
  const [rows, setRows] = useState<CgRow[]>([{ type: "listed_equity", buy: "100000", sell: "300000", months: "18", exp: "0" }, { type: "listed_equity", buy: "100000", sell: "150000", months: "6", exp: "0" }]);
  const items = useMemo(() => rows.map((r) => capitalGain({ type: r.type, buy: r.buy || "0", sell: r.sell || "0", expenses: r.exp || "0", months: n(r.months) })), [rows]);
  const t = useMemo(() => capitalGainsTax(items), [items]);
  const rec = calcRecord("Capital gains tax", "Gain = sale − cost − expenses; STCG equity 20%, LTCG equity 12.5% above ₹1.25L exemption, other LTCG 12.5% (no indexation)", { rows }, { tax: t.tax.toFixed(2) }, ["Post-23-Jul-2024 rates; grandfathering (31-Jan-2018), property indexation option for pre-Jul-2024 acquisitions and loss set-off are not modelled.", "Debt mutual funds acquired after 1-Apr-2023 are taxed at slab rates (shown, not taxed here)."], "FINVANTA tax engine");
  const up = (i: number, k: keyof CgRow, val: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  return (<div className="space-y-3"><table className="tbl"><thead><tr><th>Asset</th><th>Cost</th><th>Sale</th><th>Months held</th><th>Expenses</th><th>Gain</th><th>Class</th></tr></thead><tbody>{rows.map((r, i) => (<tr key={i}>
    <td><select className="inp" value={r.type} onChange={(e) => up(i, "type", e.target.value)}><option value="listed_equity">Listed equity (STT paid)</option><option value="equity_mf">Equity mutual fund</option><option value="debt_mf">Debt mutual fund</option><option value="property">Property</option><option value="unlisted_or_other">Unlisted / other</option></select></td>
    {(["buy", "sell", "months", "exp"] as const).map((k) => <td key={k}><input className="inp num" value={r[k]} onChange={(e) => up(i, k, e.target.value)} /></td>)}<td className="num">{inr(items[i].gain, 0)}</td><td>{items[i].kind}{items[i].ratePct !== null ? ` @${items[i].ratePct}%` : ""}</td></tr>))}</tbody></table>
    <div className="flex gap-2"><button className="btn btn-sm" onClick={() => setRows([...rows, { type: "listed_equity", buy: "0", sell: "0", months: "12", exp: "0" }])}>＋ Add row</button>{rows.length > 1 && <button className="btn btn-sm" onClick={() => setRows(rows.slice(0, -1))}>Remove last</button>}</div>
    <table className="tbl"><tbody><tr><td>STCG (equity)</td><td className="r num">{inr(t.stcgEq)}</td></tr><tr><td>LTCG (equity) / exemption used</td><td className="r num">{inr(t.ltcgEq)} / {inr(t.exempt)}</td></tr><tr><td>LTCG (other)</td><td className="r num">{inr(t.ltcgOther)}</td></tr><tr><td>Slab-rate gains (add to income)</td><td className="r num">{inr(t.slabIncome)}</td></tr><tr className="font-semibold"><td>Special-rate capital gains tax (before surcharge/cess)</td><td className="r num">{inr(t.tax, 2)}</td></tr></tbody></table><Audit rec={rec} /></div>);
}
