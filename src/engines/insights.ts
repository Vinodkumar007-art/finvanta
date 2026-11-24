import { computeRatios, derive, growth, type Stmt } from "./ratios";

export function linearForecast(ys: number[], ahead: number) {
  const n = ys.length; if (n < 2) return Array(ahead).fill(ys[0] ?? 0) as number[];
  const xm = (n - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; ys.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; });
  const slope = den ? num / den : 0, icpt = ym - slope * xm;
  return Array.from({ length: ahead }, (_, k) => icpt + slope * (n + k));
}
export function movingAverageForecast(ys: number[], ahead: number, window = 3) {
  const h = [...ys]; const out: number[] = [];
  for (let i = 0; i < ahead; i++) { const w = h.slice(-window); const v = w.reduce((a, b) => a + b, 0) / (w.length || 1); out.push(v); h.push(v); }
  return out;
}

/** Cash runway / business survival calculator. */
export function survival(p: { cash: number; monthlyRevenue: number; monthlyFixedCosts: number; variableCostPct: number; revenueGrowth: number; fundingMonth?: number; funding?: number; horizon?: number }) {
  const horizon = p.horizon ?? 36; let cash = p.cash; const path: { month: number; revenue: number; netCash: number; cash: number }[] = [];
  let rev = p.monthlyRevenue; let zero: number | null = null;
  for (let m = 1; m <= horizon; m++) {
    rev *= 1 + p.revenueGrowth;
    const net = rev * (1 - p.variableCostPct) - p.monthlyFixedCosts;
    cash += net + (p.fundingMonth === m ? p.funding ?? 0 : 0);
    path.push({ month: m, revenue: rev, netCash: net, cash });
    if (cash < 0 && zero === null) zero = m;
  }
  return { path, runwayMonths: zero === null ? null : zero - 1, survivesHorizon: zero === null, endingCash: cash };
}

/** Cash-flow stress test: shocks applied to a base 13-week-style monthly profile. */
export function stressTest(base: { cash: number; monthlyRevenue: number; monthlyCosts: number; receivables: number }, shocks: { revenueDropPct: number; collectionDelayMonths: number; costIncreasePct: number }, months = 12) {
  const path: { month: number; cash: number }[] = []; let cash = base.cash; let min = cash;
  for (let m = 1; m <= months; m++) {
    const rev = base.monthlyRevenue * (1 - shocks.revenueDropPct / 100);
    const collections = m <= shocks.collectionDelayMonths ? 0 : rev;
    const cost = base.monthlyCosts * (1 + shocks.costIncreasePct / 100);
    cash += collections - cost; min = Math.min(min, cash); path.push({ month: m, cash });
  }
  return { path, minCash: min, breached: min < 0 };
}

export function healthScore(cur: Stmt, prev?: Stmt) {
  const r = Object.fromEntries(computeRatios(cur, prev).map((x) => [x.key, x.value]));
  const sc = (v: number | null | undefined, lo: number, hi: number) => (v === null || v === undefined ? null : Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
  const parts: { name: string; weight: number; score: number | null; detail: string }[] = [
    { name: "Profitability", weight: 25, score: sc(r.npm, 0, 0.12), detail: "Net margin 0% → 12%+" },
    { name: "Liquidity", weight: 25, score: sc(r.cr, 0.8, 2), detail: "Current ratio 0.8 → 2.0" },
    { name: "Leverage", weight: 20, score: r.de === null || r.de === undefined ? null : 1 - Math.max(0, Math.min(1, (r.de - 0.3) / 2.2)), detail: "Debt/equity 2.5 → 0.3" },
    { name: "Coverage", weight: 15, score: sc(r.icr, 1, 6), detail: "Interest cover 1× → 6×" },
    { name: "Efficiency", weight: 15, score: sc(r.at, 0.4, 1.6), detail: "Asset turnover 0.4 → 1.6" },
  ];
  const valid = parts.filter((p) => p.score !== null);
  const wsum = valid.reduce((a, p) => a + p.weight, 0);
  const score = wsum ? Math.round((valid.reduce((a, p) => a + (p.score as number) * p.weight, 0) / wsum) * 100) : null;
  return { score, parts, label: score === null ? "Insufficient data" : score >= 75 ? "Strong" : score >= 55 ? "Stable" : score >= 35 ? "Watch" : "At risk" };
}

export type Flag = { severity: "high" | "medium" | "low"; area: string; message: string; evidence: string };
export function redFlags(cur: Stmt, prev?: Stmt): Flag[] {
  const d = derive(cur); const f: Flag[] = []; const r = Object.fromEntries(computeRatios(cur, prev).map((x) => [x.key, x.value]));
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : (x * 100).toFixed(1) + "%");
  if ((cur.equity ?? 0) < 0) f.push({ severity: "high", area: "Solvency", message: "Negative shareholders' equity", evidence: `Equity = ${cur.equity}` });
  if (r.cr !== null && r.cr !== undefined && r.cr < 1) f.push({ severity: "high", area: "Liquidity", message: "Current ratio below 1.0 — short-term obligations exceed liquid resources", evidence: `Current ratio ${r.cr.toFixed(2)}` });
  if (r.icr !== null && r.icr !== undefined && r.icr < 1.5) f.push({ severity: r.icr < 1 ? "high" : "medium", area: "Solvency", message: "Thin interest coverage", evidence: `EBIT/Interest ${r.icr.toFixed(2)}x` });
  if (r.de !== null && r.de !== undefined && r.de > 2) f.push({ severity: "medium", area: "Leverage", message: "High leverage", evidence: `Debt/Equity ${r.de.toFixed(2)}x` });
  if (d.pat < 0) f.push({ severity: "high", area: "Profitability", message: "Net loss for the period", evidence: `Net profit ${d.pat.toFixed(0)}` });
  if ((cur.cfo ?? 0) < 0 && d.pat > 0) f.push({ severity: "high", area: "Earnings quality", message: "Profitable on paper but negative operating cash flow", evidence: `PAT ${d.pat.toFixed(0)} vs CFO ${cur.cfo}` });
  else if (cur.cfo !== undefined && d.pat > 0 && cur.cfo < d.pat * 0.7) f.push({ severity: "medium", area: "Earnings quality", message: "Operating cash flow below 70% of net profit", evidence: `CFO/PAT ${(cur.cfo / d.pat).toFixed(2)}` });
  if (prev) {
    const pd = derive(prev);
    const gRev = growth(cur.revenue, prev.revenue), gRec = growth(cur.receivables ?? 0, prev.receivables ?? 0), gInv = growth(cur.inventory ?? 0, prev.inventory ?? 0);
    if (gRev !== null && gRec !== null && gRec > Math.max(gRev, 0) + 0.2) f.push({ severity: "medium", area: "Working capital", message: "Receivables growing materially faster than revenue (collection risk / aggressive recognition)", evidence: `Receivables ${pct(gRec)} vs revenue ${pct(gRev)}` });
    if (gRev !== null && gInv !== null && gInv > Math.max(gRev, 0) + 0.25) f.push({ severity: "low", area: "Working capital", message: "Inventory building faster than sales", evidence: `Inventory ${pct(gInv)} vs revenue ${pct(gRev)}` });
    const gm = d.grossProfit / (cur.revenue || 1), pgm = pd.grossProfit / (prev.revenue || 1);
    if (pgm - gm > 0.03) f.push({ severity: "medium", area: "Margins", message: "Gross margin compressed by more than 3 percentage points", evidence: `${pct(pgm)} → ${pct(gm)}` });
  }
  return f;
}

export function earningsQuality(cur: Stmt, prev?: Stmt) {
  const d = derive(cur); const avgTA = prev ? (d.totalAssets + derive(prev).totalAssets) / 2 : d.totalAssets;
  const cfoPat = d.pat !== 0 ? (cur.cfo ?? 0) / d.pat : null;
  const accrual = avgTA ? (d.pat - (cur.cfo ?? 0)) / avgTA : null;
  const fcfConv = d.ebitda ? ((cur.cfo ?? 0) - (cur.capex ?? 0)) / d.ebitda : null;
  const verdict = cfoPat === null ? "n/a" : cfoPat >= 1 ? "High — cash earnings support reported profit" : cfoPat >= 0.7 ? "Moderate" : "Low — profit not backed by cash";
  return { cfoPat, accrual, fcfConv, verdict };
}

export function workingCapitalIntel(cur: Stmt, prev?: Stmt) {
  const r = Object.fromEntries(computeRatios(cur, prev).map((x) => [x.key, x.value]));
  const rev = cur.revenue || 1, cogs = cur.cogs || 1;
  const dso = ((cur.receivables ?? 0) / rev) * 365, dio = ((cur.inventory ?? 0) / cogs) * 365, dpo = ((cur.payables ?? 0) / cogs) * 365;
  const ccc = dso + dio - dpo;
  const cashFreed = (days: number) => (rev / 365) * days;
  return { dso, dio, dpo, ccc, r, levers: [
    { lever: "Reduce DSO by 5 days", cashRelease: cashFreed(5) },
    { lever: "Extend DPO by 5 days", cashRelease: (cogs / 365) * 5 },
    { lever: "Reduce DIO by 5 days", cashRelease: (cogs / 365) * 5 },
  ] };
}

/** Fraud / anomaly screens on posted lines. */
export type AnomalyLine = { voucherId: string; number: string; date: string; account: string; amount: number; narration?: string };
export function detectAnomalies(lines: AnomalyLine[]) {
  const out: { type: string; severity: "high" | "medium" | "low"; number: string; detail: string }[] = [];
  const seen = new Map<string, AnomalyLine>();
  lines.forEach((l) => {
    const k = `${l.account}|${l.date}|${l.amount}`;
    const p = seen.get(k);
    if (p && p.voucherId !== l.voucherId) out.push({ type: "Possible duplicate", severity: "medium", number: l.number, detail: `Same account, date & amount (${l.amount}) as ${p.number}` });
    else seen.set(k, l);
    const wd = new Date(l.date + "T00:00:00Z").getUTCDay();
    if ((wd === 0) && l.amount >= 100000) out.push({ type: "Weekend posting", severity: "low", number: l.number, detail: `${l.amount} posted on a Sunday (${l.date})` });
    if (l.amount >= 50000 && l.amount % 10000 === 0) out.push({ type: "Round-sum entry", severity: "low", number: l.number, detail: `${l.account}: ${l.amount} is an exact multiple of 10,000` });
  });
  const amts = lines.map((l) => l.amount); const m = amts.reduce((a, b) => a + b, 0) / (amts.length || 1);
  const sd = Math.sqrt(amts.reduce((s, x) => s + (x - m) ** 2, 0) / (amts.length || 1));
  if (sd > 0) lines.forEach((l) => { const z = (l.amount - m) / sd; if (z > 3) out.push({ type: "Statistical outlier", severity: "high", number: l.number, detail: `${l.account}: ${l.amount} is ${z.toFixed(1)}σ above the mean line amount` }); });
  return out;
}

export function benford(amounts: number[]) {
  const counts = Array(9).fill(0); let n = 0;
  amounts.forEach((a) => { const s = Math.abs(a).toString().replace(/^0+\.?0*/, ""); const dgt = parseInt(s[0] ?? "0", 10); if (dgt >= 1) { counts[dgt - 1]++; n++; } });
  const expected = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));
  const chi = n ? counts.reduce((s, c, i) => s + (c - n * expected[i]) ** 2 / (n * expected[i]), 0) : 0;
  return { n, counts, expected, chi, suspicious: n >= 100 && chi > 15.51, note: n < 100 ? "Fewer than 100 amounts: Benford test not reliable." : chi > 15.51 ? "Chi-square exceeds 5% critical value (15.51, 8 d.f.) — review." : "Within expected variation." };
}

/** Evaluate a KPI formula over named numeric variables. Safe parser, no eval(). */
export function evalFormula(expr: string, vars: Record<string, number>): { value: number | null; error?: string } {
  const tokens = expr.match(/[A-Za-z_][A-Za-z_0-9]*|\d+\.?\d*|[()+\-*/]/g);
  if (!tokens || tokens.join("").length < expr.replace(/\s/g, "").length) return { value: null, error: "Unsupported characters" };
  let p = 0;
  const e = (): number => { let l = t(); while (tokens[p] === "+" || tokens[p] === "-") { const o = tokens[p++]; const r = t(); l = o === "+" ? l + r : l - r; } return l; };
  const t = (): number => { let l = f(); while (tokens[p] === "*" || tokens[p] === "/") { const o = tokens[p++]; const r = f(); l = o === "*" ? l * r : l / r; } return l; };
  const f = (): number => {
    const k = tokens[p++]; if (k === undefined) throw new Error("Unexpected end");
    if (k === "(") { const v = e(); if (tokens[p++] !== ")") throw new Error("Missing )"); return v; }
    if (k === "-") return -f();
    if (/^\d/.test(k)) return parseFloat(k);
    if (k in vars) return vars[k]; throw new Error(`Unknown variable '${k}'`);
  };
  try { const v = e(); if (p < tokens.length) throw new Error("Unexpected token"); return { value: Number.isFinite(v) ? v : null, error: Number.isFinite(v) ? undefined : "Division by zero" }; }
  catch (err) { return { value: null, error: (err as Error).message }; }
}
