import { safeDiv } from "./core";

export type Stmt = Record<string, number>;
export const STMT_FIELDS: { key: string; label: string; group: "Income statement" | "Balance sheet" | "Cash flow & market" }[] = [
  { key: "revenue", label: "Revenue", group: "Income statement" },
  { key: "cogs", label: "Cost of goods sold", group: "Income statement" },
  { key: "opex", label: "Operating expenses (excl. depreciation)", group: "Income statement" },
  { key: "depreciation", label: "Depreciation & amortisation", group: "Income statement" },
  { key: "otherIncome", label: "Other income", group: "Income statement" },
  { key: "interest", label: "Interest expense", group: "Income statement" },
  { key: "tax", label: "Income tax expense", group: "Income statement" },
  { key: "cash", label: "Cash & equivalents", group: "Balance sheet" },
  { key: "receivables", label: "Trade receivables", group: "Balance sheet" },
  { key: "inventory", label: "Inventory", group: "Balance sheet" },
  { key: "otherCA", label: "Other current assets", group: "Balance sheet" },
  { key: "fixedAssets", label: "Net fixed assets", group: "Balance sheet" },
  { key: "otherNCA", label: "Other non-current assets", group: "Balance sheet" },
  { key: "payables", label: "Trade payables", group: "Balance sheet" },
  { key: "otherCL", label: "Other current liabilities", group: "Balance sheet" },
  { key: "shortDebt", label: "Short-term debt", group: "Balance sheet" },
  { key: "longDebt", label: "Long-term debt", group: "Balance sheet" },
  { key: "otherNCL", label: "Other non-current liabilities", group: "Balance sheet" },
  { key: "equity", label: "Total equity", group: "Balance sheet" },
  { key: "retained", label: "Retained earnings (for Altman)", group: "Balance sheet" },
  { key: "cfo", label: "Cash flow from operations", group: "Cash flow & market" },
  { key: "capex", label: "Capital expenditure", group: "Cash flow & market" },
  { key: "dividends", label: "Dividends paid", group: "Cash flow & market" },
  { key: "shares", label: "Shares outstanding", group: "Cash flow & market" },
  { key: "price", label: "Share price", group: "Cash flow & market" },
];

const g = (s: Stmt, k: string) => s[k] ?? 0;
export function derive(s: Stmt) {
  const grossProfit = g(s, "revenue") - g(s, "cogs");
  const ebitda = grossProfit - g(s, "opex");
  const ebit = ebitda - g(s, "depreciation");
  const pbt = ebit + g(s, "otherIncome") - g(s, "interest");
  const pat = pbt - g(s, "tax");
  const currentAssets = g(s, "cash") + g(s, "receivables") + g(s, "inventory") + g(s, "otherCA");
  const totalAssets = currentAssets + g(s, "fixedAssets") + g(s, "otherNCA");
  const currentLiab = g(s, "payables") + g(s, "otherCL") + g(s, "shortDebt");
  const debt = g(s, "shortDebt") + g(s, "longDebt");
  const totalLiab = currentLiab + g(s, "longDebt") + g(s, "otherNCL");
  return { grossProfit, ebitda, ebit, pbt, pat, currentAssets, totalAssets, currentLiab, debt, totalLiab };
}

export type Ratio = { key: string; category: string; name: string; value: number | null; unit: "%" | "x" | "days" | "₹"; formula: string; inputs: string; benchmark?: string };
const avg = (cur: number, prev: Stmt | undefined, k: string) => (prev ? (cur + (prev[k] ?? 0)) / 2 : cur);

export function computeRatios(s: Stmt, prev?: Stmt): Ratio[] {
  const d = derive(s);
  const pd = prev ? derive(prev) : undefined;
  const rev = g(s, "revenue");
  const avgAssets = pd ? (d.totalAssets + pd.totalAssets) / 2 : d.totalAssets;
  const avgEquity = avg(g(s, "equity"), prev, "equity");
  const avgInv = avg(g(s, "inventory"), prev, "inventory");
  const avgRec = avg(g(s, "receivables"), prev, "receivables");
  const avgPay = avg(g(s, "payables"), prev, "payables");
  const taxRate = d.pbt > 0 ? g(s, "tax") / d.pbt : 0;
  const nopat = d.ebit * (1 - taxRate);
  const investedCapital = d.debt + g(s, "equity") - g(s, "cash");
  const capEmployed = d.totalAssets - d.currentLiab;
  const mcap = g(s, "price") * g(s, "shares");
  const ev = mcap + d.debt - g(s, "cash");
  const eps = safeDiv(d.pat, g(s, "shares"));
  const dio = safeDiv(avgInv * 365, g(s, "cogs"));
  const dso = safeDiv(avgRec * 365, rev);
  const dpo = safeDiv(avgPay * 365, g(s, "cogs"));
  const fcf = g(s, "cfo") - g(s, "capex");
  const R = (key: string, category: string, name: string, value: number | null, unit: Ratio["unit"], formula: string, inputs: string, benchmark?: string): Ratio => ({ key, category, name, value, unit, formula, inputs, benchmark });
  const n = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return [
    R("gpm", "Profitability", "Gross Profit Margin", safeDiv(d.grossProfit, rev), "%", "(Revenue − COGS) ÷ Revenue", `(${n(rev)} − ${n(g(s, "cogs"))}) ÷ ${n(rev)}`, "Industry-specific; >30% typical for product cos."),
    R("opm", "Profitability", "Operating Profit Margin", safeDiv(d.ebit, rev), "%", "EBIT ÷ Revenue", `${n(d.ebit)} ÷ ${n(rev)}`, ">10% healthy"),
    R("ebitdam", "Profitability", "EBITDA Margin", safeDiv(d.ebitda, rev), "%", "EBITDA ÷ Revenue", `${n(d.ebitda)} ÷ ${n(rev)}`, ">15% typical"),
    R("npm", "Profitability", "Net Profit Margin", safeDiv(d.pat, rev), "%", "Net profit ÷ Revenue", `${n(d.pat)} ÷ ${n(rev)}`, ">5% typical"),
    R("roa", "Profitability", "Return on Assets", safeDiv(d.pat, avgAssets), "%", "Net profit ÷ Average total assets", `${n(d.pat)} ÷ ${n(avgAssets)}`, ">5%"),
    R("roe", "Profitability", "Return on Equity", safeDiv(d.pat, avgEquity), "%", "Net profit ÷ Average equity", `${n(d.pat)} ÷ ${n(avgEquity)}`, ">12–15%"),
    R("roce", "Profitability", "ROCE", safeDiv(d.ebit, capEmployed), "%", "EBIT ÷ (Total assets − Current liabilities)", `${n(d.ebit)} ÷ ${n(capEmployed)}`, ">12%"),
    R("roic", "Profitability", "ROIC", safeDiv(nopat, investedCapital), "%", "NOPAT ÷ (Debt + Equity − Cash); NOPAT = EBIT × (1 − tax rate)", `${n(nopat)} ÷ ${n(investedCapital)}`, "> cost of capital"),
    R("cr", "Liquidity", "Current Ratio", safeDiv(d.currentAssets, d.currentLiab), "x", "Current assets ÷ Current liabilities", `${n(d.currentAssets)} ÷ ${n(d.currentLiab)}`, "1.2–2.0"),
    R("qr", "Liquidity", "Quick Ratio", safeDiv(d.currentAssets - g(s, "inventory"), d.currentLiab), "x", "(Current assets − Inventory) ÷ Current liabilities", `(${n(d.currentAssets)} − ${n(g(s, "inventory"))}) ÷ ${n(d.currentLiab)}`, ">1.0"),
    R("cashr", "Liquidity", "Cash Ratio", safeDiv(g(s, "cash"), d.currentLiab), "x", "Cash ÷ Current liabilities", `${n(g(s, "cash"))} ÷ ${n(d.currentLiab)}`, ">0.2"),
    R("wcr", "Liquidity", "Working Capital Ratio (WC ÷ Revenue)", safeDiv(d.currentAssets - d.currentLiab, rev), "x", "(CA − CL) ÷ Revenue", `${n(d.currentAssets - d.currentLiab)} ÷ ${n(rev)}`),
    R("de", "Solvency", "Debt-to-Equity", safeDiv(d.debt, g(s, "equity")), "x", "Total debt ÷ Equity", `${n(d.debt)} ÷ ${n(g(s, "equity"))}`, "<1.5"),
    R("da", "Solvency", "Debt-to-Assets", safeDiv(d.debt, d.totalAssets), "x", "Total debt ÷ Total assets", `${n(d.debt)} ÷ ${n(d.totalAssets)}`, "<0.5"),
    R("icr", "Solvency", "Interest Coverage", safeDiv(d.ebit, g(s, "interest")), "x", "EBIT ÷ Interest expense", `${n(d.ebit)} ÷ ${n(g(s, "interest"))}`, ">3"),
    R("dscr", "Solvency", "Debt Service Coverage (DSCR)", safeDiv(d.ebitda - g(s, "tax"), g(s, "interest") + g(s, "shortDebt")), "x", "(EBITDA − Tax) ÷ (Interest + Short-term debt due)", `${n(d.ebitda - g(s, "tax"))} ÷ ${n(g(s, "interest") + g(s, "shortDebt"))}`, ">1.25"),
    R("invt", "Efficiency", "Inventory Turnover", safeDiv(g(s, "cogs"), avgInv), "x", "COGS ÷ Average inventory", `${n(g(s, "cogs"))} ÷ ${n(avgInv)}`),
    R("rect", "Efficiency", "Receivables Turnover", safeDiv(rev, avgRec), "x", "Revenue ÷ Average receivables", `${n(rev)} ÷ ${n(avgRec)}`),
    R("payt", "Efficiency", "Payables Turnover", safeDiv(g(s, "cogs"), avgPay), "x", "COGS ÷ Average payables", `${n(g(s, "cogs"))} ÷ ${n(avgPay)}`),
    R("at", "Efficiency", "Asset Turnover", safeDiv(rev, avgAssets), "x", "Revenue ÷ Average total assets", `${n(rev)} ÷ ${n(avgAssets)}`),
    R("ccc", "Efficiency", "Cash Conversion Cycle", dio !== null && dso !== null && dpo !== null ? dio + dso - dpo : null, "days", "DIO + DSO − DPO", `${dio?.toFixed(1)} + ${dso?.toFixed(1)} − ${dpo?.toFixed(1)}`, "Lower is better"),
    R("eps", "Valuation", "EPS", eps, "₹", "Net profit ÷ Shares outstanding", `${n(d.pat)} ÷ ${n(g(s, "shares"))}`),
    R("pe", "Valuation", "P/E", eps ? safeDiv(g(s, "price"), eps) : null, "x", "Price ÷ EPS", `${n(g(s, "price"))} ÷ ${eps?.toFixed(2)}`),
    R("pb", "Valuation", "P/B", safeDiv(mcap, g(s, "equity")), "x", "Market cap ÷ Book equity", `${n(mcap)} ÷ ${n(g(s, "equity"))}`),
    R("evebitda", "Valuation", "EV/EBITDA", safeDiv(ev, d.ebitda), "x", "(Market cap + Debt − Cash) ÷ EBITDA", `${n(ev)} ÷ ${n(d.ebitda)}`),
    R("evs", "Valuation", "EV/Sales", safeDiv(ev, rev), "x", "EV ÷ Revenue", `${n(ev)} ÷ ${n(rev)}`),
    R("dy", "Valuation", "Dividend Yield", safeDiv(g(s, "dividends"), mcap), "%", "Dividends ÷ Market cap", `${n(g(s, "dividends"))} ÷ ${n(mcap)}`),
    R("fcfy", "Valuation", "Free Cash Flow Yield", safeDiv(fcf, mcap), "%", "(CFO − Capex) ÷ Market cap", `${n(fcf)} ÷ ${n(mcap)}`),
  ];
}

export function commonSize(s: Stmt) {
  const d = derive(s); const rev = g(s, "revenue");
  const is = [["Revenue", rev], ["COGS", g(s, "cogs")], ["Gross profit", d.grossProfit], ["Operating expenses", g(s, "opex")], ["EBITDA", d.ebitda], ["Depreciation", g(s, "depreciation")], ["EBIT", d.ebit], ["Interest", g(s, "interest")], ["PBT", d.pbt], ["Tax", g(s, "tax")], ["Net profit", d.pat]] as [string, number][];
  const bs = [["Cash", g(s, "cash")], ["Receivables", g(s, "receivables")], ["Inventory", g(s, "inventory")], ["Other current assets", g(s, "otherCA")], ["Net fixed assets", g(s, "fixedAssets")], ["Other non-current assets", g(s, "otherNCA")], ["Total assets", d.totalAssets], ["Payables", g(s, "payables")], ["Other current liabilities", g(s, "otherCL")], ["Short-term debt", g(s, "shortDebt")], ["Long-term debt", g(s, "longDebt")], ["Equity", g(s, "equity")]] as [string, number][];
  return {
    income: is.map(([label, v]) => ({ label, value: v, pct: safeDiv(v, rev) })),
    balance: bs.map(([label, v]) => ({ label, value: v, pct: safeDiv(v, d.totalAssets) })),
  };
}

export const growth = (cur: number, prev: number) => (prev === 0 ? null : (cur - prev) / Math.abs(prev));

export function altmanZ(s: Stmt, variant: "manufacturing" | "non-manufacturing") {
  const d = derive(s);
  const ta = d.totalAssets;
  const wc = d.currentAssets - d.currentLiab;
  const re = s.retained ?? s.equity ?? 0;
  const X1 = safeDiv(wc, ta), X2 = safeDiv(re, ta), X3 = safeDiv(d.ebit, ta);
  const tl = d.totalLiab;
  if (X1 === null || X2 === null || X3 === null || tl === 0) return null;
  if (variant === "manufacturing") {
    const X4 = (g(s, "price") * g(s, "shares")) / tl; const X5 = g(s, "revenue") / ta;
    const z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 1.0 * X5;
    return { z, zone: z > 2.99 ? "Safe" : z >= 1.81 ? "Grey" : "Distress", formula: "Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5 (X4 uses market cap)", components: { X1, X2, X3, X4, X5 }, cutoffs: "Safe > 2.99, Grey 1.81–2.99, Distress < 1.81" };
  }
  const X4 = g(s, "equity") / tl;
  const z = 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;
  return { z, zone: z > 2.6 ? "Safe" : z >= 1.1 ? "Grey" : "Distress", formula: "Z'' = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4 (X4 uses book equity)", components: { X1, X2, X3, X4 }, cutoffs: "Safe > 2.6, Grey 1.1–2.6, Distress < 1.1" };
}

export function piotroski(cur: Stmt, prev: Stmt) {
  const c = derive(cur), p = derive(prev);
  const roa = (x: ReturnType<typeof derive>) => x.pat / (x.totalAssets || 1);
  const sh = cur.shares ?? 0, psh = prev.shares ?? 0;
  const signals: [string, boolean][] = [
    ["Positive ROA", roa(c) > 0],
    ["Positive operating cash flow", g(cur, "cfo") > 0],
    ["ROA improved vs prior year", roa(c) > roa(p)],
    ["CFO > Net profit (accrual quality)", g(cur, "cfo") > c.pat],
    ["Long-term leverage fell", g(cur, "longDebt") / (c.totalAssets || 1) < g(prev, "longDebt") / (p.totalAssets || 1)],
    ["Current ratio improved", c.currentAssets / (c.currentLiab || 1) > p.currentAssets / (p.currentLiab || 1)],
    ["No new shares issued", psh === 0 || sh <= psh],
    ["Gross margin improved", c.grossProfit / (g(cur, "revenue") || 1) > p.grossProfit / (g(prev, "revenue") || 1)],
    ["Asset turnover improved", g(cur, "revenue") / (c.totalAssets || 1) > g(prev, "revenue") / (p.totalAssets || 1)],
  ];
  const score = signals.filter(([, ok]) => ok).length;
  return { score, signals: signals.map(([name, pass]) => ({ name, pass })), band: score >= 8 ? "Strong" : score >= 5 ? "Average" : "Weak" };
}
