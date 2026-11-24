import type { Stmt } from "./ratios";
import { derive } from "./ratios";

export function capm(rf: number, beta: number, erp: number) { return rf + beta * erp; }
export function wacc(p: { equityValue: number; debtValue: number; costEquity: number; costDebt: number; taxRate: number }) {
  const v = p.equityValue + p.debtValue;
  if (v <= 0) return null;
  return (p.equityValue / v) * p.costEquity + (p.debtValue / v) * p.costDebt * (1 - p.taxRate);
}

export type DcfInput = {
  baseRevenue: number; growth: number[]; ebitdaMargin: number; daPct: number; capexPct: number; nwcPct: number; taxRate: number;
  wacc: number; terminalGrowth: number; exitMultiple?: number; terminalMethod: "gordon" | "multiple";
  netDebt: number; shares: number; midYear?: boolean;
};
export function dcf(i: DcfInput) {
  const rows: { year: number; revenue: number; ebitda: number; da: number; ebit: number; nopat: number; capex: number; dNwc: number; fcf: number; df: number; pv: number }[] = [];
  let prevRev = i.baseRevenue;
  const errors: string[] = [];
  if (i.wacc <= i.terminalGrowth && i.terminalMethod === "gordon") errors.push("WACC must exceed terminal growth for the Gordon growth method.");
  if (i.terminalGrowth > 0.05) errors.push("Terminal growth above 5% is rarely defensible long-term.");
  i.growth.forEach((g, idx) => {
    const revenue = prevRev * (1 + g);
    const ebitda = revenue * i.ebitdaMargin; const da = revenue * i.daPct; const ebit = ebitda - da;
    const nopat = ebit * (1 - i.taxRate); const capex = revenue * i.capexPct; const dNwc = (revenue - prevRev) * i.nwcPct;
    const fcf = nopat + da - capex - dNwc;
    const t = idx + 1 - (i.midYear ? 0.5 : 0);
    const df = 1 / Math.pow(1 + i.wacc, t);
    rows.push({ year: idx + 1, revenue, ebitda, da, ebit, nopat, capex, dNwc, fcf, df, pv: fcf * df });
    prevRev = revenue;
  });
  const last = rows[rows.length - 1];
  const n = rows.length;
  let tv = 0;
  if (last) tv = i.terminalMethod === "gordon" ? (last.fcf * (1 + i.terminalGrowth)) / (i.wacc - i.terminalGrowth) : last.ebitda * (i.exitMultiple ?? 0);
  const pvTv = tv / Math.pow(1 + i.wacc, n);
  const pvFcf = rows.reduce((s, r) => s + r.pv, 0);
  const ev = pvFcf + pvTv;
  const equity = ev - i.netDebt;
  const perShare = i.shares > 0 ? equity / i.shares : null;
  const tvShare = ev !== 0 ? pvTv / ev : null;
  if (tvShare !== null && tvShare > 0.75) errors.push(`Terminal value is ${(tvShare * 100).toFixed(0)}% of EV — valuation is highly sensitive to terminal assumptions.`);
  return { rows, tv, pvTv, pvFcf, ev, equity, perShare, tvShare, errors, impliedExitMultiple: last && last.ebitda ? tv / last.ebitda : null };
}

export function dcfSensitivity(i: DcfInput, waccs: number[], gs: number[]) {
  return waccs.map((w) => gs.map((g) => dcf({ ...i, wacc: w, terminalGrowth: g }).perShare));
}

export function scenarios(i: DcfInput) {
  const shift = (d: number, m: number, w: number): DcfInput => ({ ...i, growth: i.growth.map((g) => g + d), ebitdaMargin: i.ebitdaMargin + m, wacc: i.wacc + w });
  return {
    bear: dcf(shift(-0.03, -0.02, 0.01)),
    base: dcf(i),
    bull: dcf(shift(0.03, 0.02, -0.005)),
  };
}

export function ddm(p: { dividend0: number; highGrowth: number; highYears: number; stableGrowth: number; costEquity: number }) {
  if (p.costEquity <= p.stableGrowth) return { value: null, error: "Cost of equity must exceed stable growth." };
  let pv = 0, d = p.dividend0;
  for (let t = 1; t <= p.highYears; t++) { d *= 1 + p.highGrowth; pv += d / Math.pow(1 + p.costEquity, t); }
  const tv = (d * (1 + p.stableGrowth)) / (p.costEquity - p.stableGrowth);
  pv += tv / Math.pow(1 + p.costEquity, p.highYears);
  return { value: pv, error: null as string | null };
}

export function lbo(p: { ebitda: number; entryMultiple: number; leverage: number; interestRate: number; growth: number; capexPct: number; taxRate: number; years: number; exitMultiple: number; revenueMargin: number; fees?: number }) {
  const ev = p.ebitda * p.entryMultiple; const debt0 = p.ebitda * p.leverage; const fees = p.fees ?? ev * 0.02;
  const equity = ev + fees - debt0;
  let debt = debt0, e = p.ebitda; const rows: { year: number; ebitda: number; interest: number; fcf: number; debt: number }[] = [];
  for (let y = 1; y <= p.years; y++) {
    e *= 1 + p.growth; const interest = debt * p.interestRate;
    const rev = e / p.revenueMargin; const capex = rev * p.capexPct;
    const taxable = Math.max(0, e - interest - capex * 0.5); const tax = taxable * p.taxRate;
    const fcf = e - interest - tax - capex;
    debt = Math.max(0, debt - fcf); // 100% cash sweep
    rows.push({ year: y, ebitda: e, interest, fcf, debt });
  }
  const exitEv = e * p.exitMultiple; const exitEquity = exitEv - debt;
  const moic = equity > 0 ? exitEquity / equity : null;
  const irr = moic !== null && moic > 0 ? Math.pow(moic, 1 / p.years) - 1 : null;
  return { ev, debt0, equity, fees, rows, exitEv, exitDebt: debt, exitEquity, moic, irr, valid: equity > 0 };
}

export function breakEven(p: { fixedCosts: number; price: number; variableCost: number; targetProfit?: number }) {
  const cm = p.price - p.variableCost;
  if (cm <= 0) return { units: null, revenue: null, cm, cmRatio: null, error: "Contribution margin must be positive." };
  const units = (p.fixedCosts + (p.targetProfit ?? 0)) / cm;
  return { units, revenue: units * p.price, cm, cmRatio: cm / p.price, error: null as string | null };
}

export function comps(peers: { name: string; evEbitda?: number; pe?: number; evSales?: number }[], target: { ebitda: number; netIncome: number; revenue: number; netDebt: number; shares: number }) {
  const med = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mEv = med(peers.map((p) => p.evEbitda ?? NaN)), mPe = med(peers.map((p) => p.pe ?? NaN)), mEs = med(peers.map((p) => p.evSales ?? NaN));
  const perShare = (eq: number) => (target.shares > 0 ? eq / target.shares : null);
  return {
    medians: { evEbitda: mEv, pe: mPe, evSales: mEs },
    implied: {
      evEbitda: mEv !== null ? perShare(mEv * target.ebitda - target.netDebt) : null,
      pe: mPe !== null ? perShare(mPe * target.netIncome) : null,
      evSales: mEs !== null ? perShare(mEs * target.revenue - target.netDebt) : null,
    },
  };
}

export type Drivers = { growth: number; cogsPct: number; opexPct: number; depPct: number; interestRate: number; taxRate: number; dso: number; dio: number; dpo: number; capexPct: number; debtRepay: number; payout: number };
/** Integrated three-statement projection with balance and cash-reconciliation checks. */
export function threeStatement(base: Stmt, d: Drivers, years: number) {
  const out: { year: number; s: Stmt; checks: { balance: number; cashRecon: number } }[] = [];
  let prev = { ...base };
  for (let y = 1; y <= years; y++) {
    const revenue = (prev.revenue ?? 0) * (1 + d.growth);
    const cogs = revenue * d.cogsPct, opex = revenue * d.opexPct;
    const dep = (prev.fixedAssets ?? 0) * d.depPct;
    const interest = ((prev.shortDebt ?? 0) + (prev.longDebt ?? 0)) * d.interestRate;
    const pbt = revenue - cogs - opex - dep + (prev.otherIncome ?? 0) - interest;
    const tax = Math.max(0, pbt) * d.taxRate; const pat = pbt - tax;
    const receivables = (revenue * d.dso) / 365, inventory = (cogs * d.dio) / 365, payables = (cogs * d.dpo) / 365;
    const capex = revenue * d.capexPct;
    const fixedAssets = (prev.fixedAssets ?? 0) + capex - dep;
    const repay = Math.min(d.debtRepay, prev.longDebt ?? 0);
    const longDebt = (prev.longDebt ?? 0) - repay;
    const dividends = Math.max(0, pat) * d.payout;
    const equity = (prev.equity ?? 0) + pat - dividends;
    const dNwc = receivables + inventory - payables - ((prev.receivables ?? 0) + (prev.inventory ?? 0) - (prev.payables ?? 0));
    const cfo = pat + dep - dNwc;
    const cash = (prev.cash ?? 0) + cfo - capex - repay - dividends;
    const s: Stmt = {
      ...prev, revenue, cogs, opex, depreciation: dep, interest, tax, receivables, inventory, payables, fixedAssets, longDebt, equity, cash,
      cfo, capex, dividends, retained: (prev.retained ?? 0) + pat - dividends,
    };
    const dv = derive(s);
    const liabEq = (s.payables ?? 0) + (s.otherCL ?? 0) + (s.shortDebt ?? 0) + (s.longDebt ?? 0) + (s.otherNCL ?? 0) + (s.equity ?? 0);
    out.push({ year: y, s, checks: { balance: dv.totalAssets - liabEq, cashRecon: (cash - (prev.cash ?? 0)) - (cfo - capex - repay - dividends) } });
    prev = s;
  }
  return out;
}

/** Evaluate a simple model-validation checklist. */
export function validateModel(i: DcfInput) {
  const issues: { level: "error" | "warning"; msg: string }[] = [];
  if (i.wacc <= 0) issues.push({ level: "error", msg: "WACC must be positive." });
  if (i.terminalMethod === "gordon" && i.wacc <= i.terminalGrowth) issues.push({ level: "error", msg: "WACC ≤ terminal growth: Gordon growth value is undefined." });
  if (i.terminalGrowth > 0.05) issues.push({ level: "warning", msg: "Terminal growth > 5% exceeds plausible long-run nominal GDP growth." });
  if (i.ebitdaMargin > 0.6) issues.push({ level: "warning", msg: "EBITDA margin above 60% is unusual." });
  if (i.growth.some((g) => g > 0.5)) issues.push({ level: "warning", msg: "A forecast growth rate above 50% — confirm it is supportable." });
  if (i.capexPct < i.daPct * 0.5) issues.push({ level: "warning", msg: "Capex far below D&A — asset base shrinks; check sustainability." });
  if (i.shares <= 0) issues.push({ level: "error", msg: "Shares outstanding must be positive to compute value per share." });
  if (i.taxRate < 0 || i.taxRate > 0.5) issues.push({ level: "warning", msg: "Tax rate outside 0–50%." });
  return issues;
}
