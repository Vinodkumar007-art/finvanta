import { D, Decimal, r0, r2, sum, calcRecord } from "./core";

/**
 * CONFIGURABLE statutory parameters. Values reflect the Indian rules as understood for FY 2025-26 (AY 2026-27)
 * and MUST be verified against the official sources (incometax.gov.in, cbic-gst.gov.in, tin-nsdl.com) before relying on them.
 * Outputs are CALCULATIONS / DRAFT data — never statutory submissions.
 */
export const TAX_RULES = {
  fy: "2025-26",
  sources: ["https://incometax.gov.in", "https://www.cbic.gov.in", "https://tin.tin.nsdl.com"],
  gstSlabs: [0, 0.25, 3, 5, 12, 18, 28, 40],
  gstr3bLateFeePerDay: 50, // CGST 25 + SGST 25
  gstr3bNilLateFeePerDay: 20,
  gstr3bLateFeeCap: 10000,
  gstr3bNilLateFeeCap: 500,
  gstInterestRate: 18, // % p.a. on net cash liability
  newRegime: {
    slabs: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]] as [number, number][],
    standardDeduction: 75000, rebateLimit: 1200000, rebateMax: 60000, maxSurcharge: 25,
  },
  oldRegime: {
    slabs: [[250000, 0], [500000, 5], [1000000, 20], [Infinity, 30]] as [number, number][],
    standardDeduction: 50000, rebateLimit: 500000, rebateMax: 12500, maxSurcharge: 37,
    caps: { s80C: 150000, s80CCD1B: 50000, s24b: 200000 },
  },
  surcharge: [[5000000, 0], [10000000, 10], [20000000, 15], [50000000, 25], [Infinity, 37]] as [number, number][],
  cess: 4,
  capGains: { stcgEquity: 20, ltcgEquity: 12.5, ltcgOther: 12.5, ltcgEquityExemption: 125000, equityLtMonths: 12, otherLtMonths: 24 },
  advanceTax: [[ "15 Jun", 15 ], ["15 Sep", 45 ], ["15 Dec", 75 ], ["15 Mar", 100 ]] as [string, number][],
};

export const DEFAULT_TDS_SECTIONS = [
  { section: "192", description: "Salaries (slab rates — computed on estimated income)", rateIndividual: "0", rateOther: "0", singleThreshold: "0", annualThreshold: "0" },
  { section: "194A", description: "Interest other than interest on securities", rateIndividual: "10", rateOther: "10", singleThreshold: "0", annualThreshold: "50000" },
  { section: "194C", description: "Payments to contractors", rateIndividual: "1", rateOther: "2", singleThreshold: "30000", annualThreshold: "100000" },
  { section: "194H", description: "Commission or brokerage", rateIndividual: "2", rateOther: "2", singleThreshold: "0", annualThreshold: "20000" },
  { section: "194I(a)", description: "Rent — plant & machinery", rateIndividual: "2", rateOther: "2", singleThreshold: "0", annualThreshold: "600000" },
  { section: "194I(b)", description: "Rent — land, building, furniture", rateIndividual: "10", rateOther: "10", singleThreshold: "0", annualThreshold: "600000" },
  { section: "194J(a)", description: "Fees for technical services / call centre", rateIndividual: "2", rateOther: "2", singleThreshold: "0", annualThreshold: "50000" },
  { section: "194J(b)", description: "Professional fees / royalty / director fees", rateIndividual: "10", rateOther: "10", singleThreshold: "0", annualThreshold: "50000" },
  { section: "194Q", description: "Purchase of goods (above ₹50 lakh)", rateIndividual: "0.1", rateOther: "0.1", singleThreshold: "0", annualThreshold: "5000000" },
  { section: "194O", description: "E-commerce participants", rateIndividual: "0.1", rateOther: "0.1", singleThreshold: "0", annualThreshold: "500000" },
];

/* ---------- GST ---------- */
export function gstSplit(taxable: Decimal.Value, ratePct: number, supplierState: string, placeOfSupply: string) {
  const t = D(taxable);
  const intra = supplierState === placeOfSupply;
  if (intra) {
    const half = r2(t.mul(ratePct).div(200));
    return { cgst: half, sgst: half, igst: D(0), total: half.mul(2), intra };
  }
  const igst = r2(t.mul(ratePct).div(100));
  return { cgst: D(0), sgst: D(0), igst, total: igst, intra };
}

export function invoiceTotals(items: { qty: number; rate: Decimal.Value; gstRate: number }[], supplierState: string, pos: string) {
  let taxable = D(0), cgst = D(0), sgst = D(0), igst = D(0);
  for (const it of items) {
    const line = r2(D(it.rate).mul(it.qty));
    const g = gstSplit(line, it.gstRate, supplierState, pos);
    taxable = taxable.plus(line); cgst = cgst.plus(g.cgst); sgst = sgst.plus(g.sgst); igst = igst.plus(g.igst);
  }
  return { taxable, cgst, sgst, igst, total: taxable.plus(cgst).plus(sgst).plus(igst) };
}

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function validateGstin(g: string) {
  const v = g.trim().toUpperCase();
  if (!GSTIN_RE.test(v)) return false;
  let sumv = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(v[i]) * (i % 2 === 0 ? 1 : 2);
    sumv += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sumv % 36)) % 36] === v[14];
}
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export type GstHeads = { igst: Decimal.Value; cgst: Decimal.Value; sgst: Decimal.Value };
/** Statutory ITC utilisation order: IGST ITC → IGST, CGST, SGST; CGST ITC → CGST, IGST; SGST ITC → SGST, IGST. */
export function gstSetOff(out: GstHeads, itc: GstHeads) {
  let oi = D(out.igst), oc = D(out.cgst), os = D(out.sgst);
  let ii = D(itc.igst), ic = D(itc.cgst), is = D(itc.sgst);
  const applyCredit = (a: Decimal, b: Decimal) => { const u = Decimal.min(a, b); return [a.minus(u), b.minus(u), u] as const; };
  [oi, ii] = applyCredit(oi, ii).slice(0, 2) as [Decimal, Decimal];
  [oc, ii] = applyCredit(oc, ii).slice(0, 2) as [Decimal, Decimal];
  [os, ii] = applyCredit(os, ii).slice(0, 2) as [Decimal, Decimal];
  [oc, ic] = applyCredit(oc, ic).slice(0, 2) as [Decimal, Decimal];
  [oi, ic] = applyCredit(oi, ic).slice(0, 2) as [Decimal, Decimal];
  [os, is] = applyCredit(os, is).slice(0, 2) as [Decimal, Decimal];
  [oi, is] = applyCredit(oi, is).slice(0, 2) as [Decimal, Decimal];
  return { cashIgst: oi, cashCgst: oc, cashSgst: os, carryIgst: ii, carryCgst: ic, carrySgst: is, cashTotal: oi.plus(oc).plus(os) };
}

export function gstLateFeeAndInterest(opts: { daysLate: number; nil: boolean; netCashTax: Decimal.Value }) {
  const days = Math.max(0, opts.daysLate);
  const rate = opts.nil ? TAX_RULES.gstr3bNilLateFeePerDay : TAX_RULES.gstr3bLateFeePerDay;
  const cap = opts.nil ? TAX_RULES.gstr3bNilLateFeeCap : TAX_RULES.gstr3bLateFeeCap;
  const lateFee = D(Math.min(days * rate, cap));
  const interest = r2(D(opts.netCashTax).mul(TAX_RULES.gstInterestRate).div(100).mul(days).div(365));
  return calcRecord("GST late fee & interest estimate",
    "Late fee = min(days × ₹/day, cap); Interest = net cash tax × 18% × days / 365",
    opts, { lateFee: lateFee.toFixed(2), interest: interest.toFixed(2), total: lateFee.plus(interest).toFixed(2) },
    ["Estimate only; actual fee/interest is computed by the GST portal and may differ (notifications, waivers, reduced caps by turnover)."],
    "CGST Act s.47 & s.50 (verify current notifications)");
}

export type GstRegisterRow = { gstin?: string | null; invoiceNo: string; date: string; taxable: Decimal.Value; cgst: Decimal.Value; sgst: Decimal.Value; igst: Decimal.Value };
export function gstr3bSummary(sales: GstRegisterRow[], purchases: GstRegisterRow[]) {
  const o = { taxable: sum(sales.map((s) => s.taxable)), cgst: sum(sales.map((s) => s.cgst)), sgst: sum(sales.map((s) => s.sgst)), igst: sum(sales.map((s) => s.igst)) };
  const i = { taxable: sum(purchases.map((s) => s.taxable)), cgst: sum(purchases.map((s) => s.cgst)), sgst: sum(purchases.map((s) => s.sgst)), igst: sum(purchases.map((s) => s.igst)) };
  const setoff = gstSetOff(o, i);
  return { outward: o, itc: i, setoff };
}

/** GSTR-2B reconciliation: match purchase register against supplier-reported rows. */
export function reconcile2B(books: GstRegisterRow[], portal: GstRegisterRow[], tolerance = 1) {
  const key = (r: GstRegisterRow) => `${(r.gstin ?? "").toUpperCase()}|${r.invoiceNo.trim().toUpperCase()}`;
  const pMap = new Map(portal.map((p) => [key(p), p]));
  const used = new Set<string>();
  const rows: { status: "matched" | "mismatch" | "missing_in_2b" | "missing_in_books"; invoiceNo: string; gstin: string; booksTax: string; portalTax: string; diff: string }[] = [];
  for (const b of books) {
    const k = key(b); const p = pMap.get(k);
    const bt = D(b.cgst).plus(b.sgst).plus(b.igst);
    if (!p) { rows.push({ status: "missing_in_2b", invoiceNo: b.invoiceNo, gstin: b.gstin ?? "", booksTax: bt.toFixed(2), portalTax: "0.00", diff: bt.toFixed(2) }); continue; }
    used.add(k);
    const pt = D(p.cgst).plus(p.sgst).plus(p.igst);
    const diff = bt.minus(pt);
    rows.push({ status: diff.abs().lte(tolerance) ? "matched" : "mismatch", invoiceNo: b.invoiceNo, gstin: b.gstin ?? "", booksTax: bt.toFixed(2), portalTax: pt.toFixed(2), diff: diff.toFixed(2) });
  }
  for (const p of portal) {
    if (used.has(key(p))) continue;
    const pt = D(p.cgst).plus(p.sgst).plus(p.igst);
    rows.push({ status: "missing_in_books", invoiceNo: p.invoiceNo, gstin: p.gstin ?? "", booksTax: "0.00", portalTax: pt.toFixed(2), diff: pt.neg().toFixed(2) });
  }
  return rows;
}

/* ---------- TDS ---------- */
export type TdsConfig = { section: string; rateIndividual: Decimal.Value; rateOther: Decimal.Value; singleThreshold: Decimal.Value; annualThreshold: Decimal.Value };
export function computeTds(cfg: TdsConfig, p: { amount: Decimal.Value; deducteeType: "individual" | "company"; panAvailable: boolean; paidYtd: Decimal.Value }) {
  const amount = D(p.amount), ytd = D(p.paidYtd);
  const single = D(cfg.singleThreshold), annual = D(cfg.annualThreshold);
  let applicable = single.isZero() && annual.isZero();
  let base = amount;
  if (single.gt(0) && amount.gt(single)) applicable = true;
  if (annual.gt(0) && ytd.plus(amount).gt(annual)) {
    applicable = true;
    if (ytd.lte(annual) && single.isZero()) base = ytd.plus(amount); // threshold crossed now: earlier payments had no TDS
  }
  const baseRate = D(p.deducteeType === "individual" ? cfg.rateIndividual : cfg.rateOther);
  const rate = p.panAvailable ? baseRate : Decimal.max(baseRate, 20); // s.206AA
  const tds = applicable ? r0(base.mul(rate).div(100)) : D(0);
  return calcRecord(`TDS u/s ${cfg.section}`,
    "TDS = round₀(taxable base × rate%); rate = max(rate, 20%) if PAN not available; threshold tests per configuration",
    { ...cfg, ...p }, { applicable, base: base.toFixed(2), rate: rate.toString(), tds: tds.toFixed(0) },
    ["Rates and thresholds are user-configurable defaults; confirm with the latest Finance Act/CBDT notifications.", "Lower-deduction certificates (s.197) not modelled.", "Rounded to nearest rupee (s.288B)."],
    "Income-tax Act, 1961 (configured rule table)");
}

export function tdsQuarter(dateISO: string) {
  const m = new Date(dateISO).getUTCMonth() + 1;
  return m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 && m <= 12 ? "Q3" : "Q4";
}
export function tdsDepositDue(dateISO: string) {
  const d = new Date(dateISO + "T00:00:00Z");
  const m = d.getUTCMonth();
  if (m === 2) return `${d.getUTCFullYear()}-04-30`;
  const due = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 7));
  return due.toISOString().slice(0, 10);
}

/* ---------- Income tax ---------- */
function slabTax(income: Decimal, slabs: [number, number][]) {
  let prev = 0, tax = D(0);
  for (const [upto, rate] of slabs) {
    if (income.gt(prev)) tax = tax.plus(Decimal.min(income, upto).minus(prev).mul(rate).div(100));
    prev = upto;
  }
  return tax;
}
export type TaxInput = {
  regime: "new" | "old"; salary: number; otherIncome: number; houseIncome: number; // house income net of s.24 (loss allowed in old)
  s80C: number; s80D: number; s80CCD1B: number; hra: number; homeLoanInterest: number; employerNps: number; otherDeductions: number;
  specialRateTax?: number; specialRateIncome?: number; tdsPaid?: number;
};
export function incomeTax(i: TaxInput) {
  const R = i.regime === "new" ? TAX_RULES.newRegime : TAX_RULES.oldRegime;
  const gross = D(i.salary).plus(i.otherIncome).plus(i.houseIncome);
  const stdDed = i.salary > 0 ? Decimal.min(R.standardDeduction, i.salary) : D(0);
  let ded = D(0);
  const breakdown: Record<string, string> = {};
  if (i.regime === "old") {
    const c = TAX_RULES.oldRegime.caps;
    const d80c = Decimal.min(i.s80C, c.s80C), d1b = Decimal.min(i.s80CCD1B, c.s80CCD1B), d24 = Decimal.min(i.homeLoanInterest, c.s24b);
    ded = d80c.plus(d1b).plus(d24).plus(i.s80D).plus(i.hra).plus(i.employerNps).plus(i.otherDeductions);
    Object.assign(breakdown, { "80C": d80c.toFixed(2), "80CCD(1B)": d1b.toFixed(2), "24(b)": d24.toFixed(2), "80D": D(i.s80D).toFixed(2), HRA: D(i.hra).toFixed(2), "Employer NPS": D(i.employerNps).toFixed(2), Other: D(i.otherDeductions).toFixed(2) });
  } else {
    ded = D(i.employerNps);
    Object.assign(breakdown, { "Employer NPS 80CCD(2)": D(i.employerNps).toFixed(2) });
  }
  const taxable = Decimal.max(gross.minus(stdDed).minus(ded), 0);
  let tax = slabTax(taxable, R.slabs);
  const special = D(i.specialRateTax ?? 0);
  const totalIncome = taxable.plus(i.specialRateIncome ?? 0);
  // Section 87A rebate (normal income)
  let rebate = D(0);
  if (taxable.lte(R.rebateLimit) && totalIncome.lte(R.rebateLimit)) rebate = Decimal.min(tax, R.rebateMax);
  else if (i.regime === "new" && taxable.gt(R.rebateLimit)) {
    // marginal relief: tax payable should not exceed income above ₹12L
    const excess = taxable.minus(R.rebateLimit);
    if (tax.gt(excess)) rebate = tax.minus(excess);
  }
  tax = tax.minus(rebate);
  const base = tax.plus(special);
  let sRate = 0;
  // surcharge slab selection: income above threshold → that rate
  const thresholds: [number, number][] = [[5000000, 10], [10000000, 15], [20000000, 25], [50000000, 37]];
  for (const [limit, rate] of thresholds) if (totalIncome.gt(limit)) sRate = rate;
  sRate = Math.min(sRate, R.maxSurcharge);
  const surcharge = base.mul(sRate).div(100);
  const cess = base.plus(surcharge).mul(TAX_RULES.cess).div(100);
  const totalTax = r0(base.plus(surcharge).plus(cess));
  const net = totalTax.minus(i.tdsPaid ?? 0);
  return {
    regime: i.regime, gross, standardDeduction: stdDed, deductions: ded, deductionBreakdown: breakdown, taxable, slabTax: slabTax(taxable, R.slabs), rebate,
    specialRateTax: special, surchargeRate: sRate, surcharge, cess, totalTax, tdsPaid: D(i.tdsPaid ?? 0), netPayable: net,
    effectiveRate: totalIncome.isZero() ? 0 : totalTax.div(totalIncome).toNumber(),
  };
}

export function advanceTaxSchedule(netTaxLiability: Decimal.Value) {
  const n = D(netTaxLiability);
  if (n.lt(10000)) return { applicable: false, rows: [] as { due: string; cumulativePct: number; cumulative: string; instalment: string }[] };
  let prev = D(0);
  const rows = TAX_RULES.advanceTax.map(([due, pct]) => {
    const cum = r0(n.mul(pct).div(100));
    const row = { due, cumulativePct: pct, cumulative: cum.toFixed(0), instalment: cum.minus(prev).toFixed(0) };
    prev = cum; return row;
  });
  return { applicable: true, rows };
}

export type CgAssetType = "listed_equity" | "equity_mf" | "debt_mf" | "property" | "unlisted_or_other";
export function capitalGain(a: { type: CgAssetType; buy: Decimal.Value; sell: Decimal.Value; expenses?: Decimal.Value; months: number }) {
  const gain = D(a.sell).minus(a.buy).minus(a.expenses ?? 0);
  const equityLike = a.type === "listed_equity" || a.type === "equity_mf";
  const long = a.months > (equityLike ? TAX_RULES.capGains.equityLtMonths : TAX_RULES.capGains.otherLtMonths);
  let kind: "STCG" | "LTCG" | "SLAB"; let rate = 0;
  if (a.type === "debt_mf") { kind = "SLAB"; }
  else if (long) { kind = "LTCG"; rate = equityLike ? TAX_RULES.capGains.ltcgEquity : TAX_RULES.capGains.ltcgOther; }
  else { kind = "STCG"; rate = equityLike ? TAX_RULES.capGains.stcgEquity : -1; }
  const slab = kind === "SLAB" || rate === -1;
  return { gain, kind: slab ? "STCG (slab rate)" : kind, ratePct: slab ? null : rate, equityLike, long };
}
export function capitalGainsTax(items: ReturnType<typeof capitalGain>[]) {
  let stcgEq = D(0), ltcgEq = D(0), ltcgOther = D(0), slabIncome = D(0);
  items.forEach((x) => {
    if (x.kind === "STCG" && x.equityLike) stcgEq = stcgEq.plus(x.gain);
    else if (x.kind === "LTCG" && x.equityLike) ltcgEq = ltcgEq.plus(x.gain);
    else if (x.kind === "LTCG") ltcgOther = ltcgOther.plus(x.gain);
    else slabIncome = slabIncome.plus(x.gain);
  });
  const exempt = Decimal.min(Decimal.max(ltcgEq, 0), TAX_RULES.capGains.ltcgEquityExemption);
  const cg = TAX_RULES.capGains;
  const stTax = Decimal.max(stcgEq, 0).mul(cg.stcgEquity).div(100);
  const ltEqTax = Decimal.max(ltcgEq.minus(exempt), 0).mul(cg.ltcgEquity).div(100);
  const ltOtherTax = Decimal.max(ltcgOther, 0).mul(cg.ltcgOther).div(100);
  return { stcgEq, ltcgEq, ltcgOther, slabIncome, exempt, tax: r2(stTax.plus(ltEqTax).plus(ltOtherTax)), taxableSpecial: Decimal.max(stcgEq, 0).plus(Decimal.max(ltcgEq.minus(exempt), 0)).plus(Decimal.max(ltcgOther, 0)) };
}
