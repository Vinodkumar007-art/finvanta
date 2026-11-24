import { describe, it, expect } from "vitest";
import { validateVoucher, trialBalance, profitAndLoss, balanceSheet, cashFlow, depreciationForYear, weightedAverageInventory, ageingBucket, reversalLines, nextVoucherNumber, fyBounds, type AccBal } from "@/engines/accounting";
import { gstSplit, invoiceTotals, validateGstin, gstSetOff, gstLateFeeAndInterest, computeTds, incomeTax, advanceTaxSchedule, capitalGain, capitalGainsTax, reconcile2B } from "@/engines/tax";
import { computeRatios, altmanZ, piotroski, commonSize } from "@/engines/ratios";
import { dcf, wacc, ddm, lbo, threeStatement, breakEven, validateModel } from "@/engines/valuation";
import { positions, xirr, cagr, riskMetrics, twr, rebalance } from "@/engines/portfolio";
import { sma, ema, rsi, macd, bollinger, heikinAshi, customIndicator, demoCandles, aggregate, adx, stochastic, atr, ichimoku } from "@/engines/technical";
import { emi, amortisation, assessCredit } from "@/engines/credit";
import { evalFormula, survival, detectAnomalies, benford, healthScore } from "@/engines/insights";

const acct = (id: string, type: AccBal["type"], role: string, prior: string, dr: string, cr: string): AccBal => ({ id, code: id, name: id, type, role, groupName: "", prior, dr, cr });

describe("double entry", () => {
  it("accepts balanced vouchers and rejects unbalanced ones", () => {
    expect(validateVoucher([{ accountId: "a", debit: "100.10", credit: 0 }, { accountId: "b", debit: 0, credit: "100.10" }]).ok).toBe(true);
    const bad = validateVoucher([{ accountId: "a", debit: "100", credit: 0 }, { accountId: "b", debit: 0, credit: "99.99" }]);
    expect(bad.ok).toBe(false);
  });
  it("uses decimal-safe arithmetic (0.1 + 0.2)", () => {
    expect(validateVoucher([{ accountId: "a", debit: "0.1", credit: 0 }, { accountId: "a", debit: "0.2", credit: 0 }, { accountId: "b", debit: 0, credit: "0.3" }]).ok).toBe(true);
  });
  it("rejects lines with both sides, negatives, 3dp", () => {
    expect(validateVoucher([{ accountId: "a", debit: 1, credit: 1 }, { accountId: "b", debit: 0, credit: 0 }]).ok).toBe(false);
    expect(validateVoucher([{ accountId: "a", debit: "1.005", credit: 0 }, { accountId: "b", debit: 0, credit: "1.005" }]).ok).toBe(false);
  });
  it("reversal swaps sides", () => {
    const r = reversalLines([{ accountId: "a", debit: "10", credit: "0" }]);
    expect(r[0].credit).toBe("10.00");
  });
  it("numbers vouchers sequentially", () => {
    expect(nextVoucherNumber("sales", ["SV-00001", "SV-00009"])).toBe("SV-00010");
    expect(nextVoucherNumber("journal", [])).toBe("JV-00001");
  });
});

// Fixture: opening: cash 100k, capital 100k. Period: sales 50k cash, purchase 20k on credit, rent 10k cash, dep 5k, capex 30k cash.
const bals: AccBal[] = [
  acct("cash", "asset", "cash", "100000", "50000", "10000"),
  acct("ar", "asset", "ar", "0", "0", "0"),
  acct("fa", "asset", "fixed_asset", "0", "30000", "0"),
  acct("ad", "asset", "accum_dep", "0", "0", "5000"),
  acct("ap", "liability", "ap", "0", "0", "20000"),
  acct("cap", "equity", "capital", "-100000", "0", "0"),
  acct("sales", "income", "sales", "0", "0", "50000"),
  acct("cogs", "expense", "cogs", "0", "20000", "0"),
  acct("rent", "expense", "opex", "0", "10000", "0"),
  acct("dep", "expense", "depreciation", "0", "5000", "0"),
];
// cash: 100000+50000-10000 = 140000 ... capex 30000 cash must also be credited
bals[0].cr = "40000";

describe("statements", () => {
  it("trial balance balances", () => {
    const tb = trialBalance(bals);
    expect(tb.balanced).toBe(true);
  });
  it("P&L", () => {
    const pl = profitAndLoss(bals);
    expect(pl.revenue.toString()).toBe("50000");
    expect(pl.grossProfit.toString()).toBe("30000");
    expect(pl.ebitda.toString()).toBe("20000");
    expect(pl.netProfit.toString()).toBe("15000");
  });
  it("balance sheet balances (A = L + E)", () => {
    const bs = balanceSheet(bals);
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets.toString()).toBe("135000");
    expect(bs.equity.toString()).toBe("115000");
  });
  it("cash flow reconciles to movement in cash", () => {
    const cf = cashFlow(bals);
    expect(cf.reconciled).toBe(true);
    expect(cf.netChange.toString()).toBe(cf.actualChange.toString());
    expect(cf.investing.toString()).toBe("-30000");
  });
  it("carries prior-year profit into retained earnings", () => {
    const b = [acct("cash", "asset", "cash", "150", "0", "0"), acct("cap", "equity", "capital", "-100", "0", "0"), acct("s", "income", "sales", "-50", "0", "0")];
    const bs = balanceSheet(b);
    expect(bs.balanced).toBe(true);
    expect(bs.retained.toString()).toBe("50");
    expect(trialBalance(b).balanced).toBe(true);
  });
});

describe("assets & inventory", () => {
  it("SLM and WDV depreciation with salvage cap", () => {
    expect(depreciationForYear({ cost: 100000, salvage: 10000, lifeYears: 5, method: "SLM", accumulated: 0 }).toString()).toBe("18000");
    expect(depreciationForYear({ cost: 100000, salvage: 10000, lifeYears: 5, method: "SLM", accumulated: 85000 }).toString()).toBe("5000");
    expect(depreciationForYear({ cost: 100000, salvage: 0, lifeYears: 5, method: "WDV", wdvRate: 15, accumulated: 0 }).toString()).toBe("15000");
  });
  it("weighted average inventory", () => {
    const r = weightedAverageInventory([{ date: "2025-04-01", kind: "in", qty: 10, rate: 100 }, { date: "2025-04-02", kind: "in", qty: 10, rate: 120 }, { date: "2025-04-03", kind: "out", qty: 5, rate: 0 }]);
    expect(r.qty.toString()).toBe("15"); expect(r.cogs.toString()).toBe("550"); expect(r.value.toString()).toBe("1650");
  });
  it("ageing + FY bounds", () => {
    expect(ageingBucket("2025-01-01", "2025-03-01")).toBe("31-60");
    expect(ageingBucket("2025-05-01", "2025-03-01")).toBe("Not due");
    expect(fyBounds(4, new Date("2025-02-10")).start).toBe("2024-04-01");
    expect(fyBounds(4, new Date("2025-06-10")).end).toBe("2026-03-31");
  });
});

describe("GST", () => {
  it("intra-state splits CGST/SGST, inter-state IGST", () => {
    const a = gstSplit("1000", 18, "27", "27");
    expect(a.cgst.toString()).toBe("90"); expect(a.sgst.toString()).toBe("90"); expect(a.igst.toString()).toBe("0");
    const b = gstSplit("1000", 18, "27", "29");
    expect(b.igst.toString()).toBe("180");
  });
  it("invoice totals", () => {
    const t = invoiceTotals([{ qty: 2, rate: "500.50", gstRate: 18 }, { qty: 1, rate: "100", gstRate: 5 }], "27", "27");
    expect(t.taxable.toString()).toBe("1101"); expect(t.total.toString()).toBe("1286.18");
  });
  it("GSTIN checksum validation", () => {
    expect(validateGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(validateGstin("27AAPFU0939F1ZX")).toBe(false);
    expect(validateGstin("bad")).toBe(false);
  });
  it("ITC set-off order", () => {
    const r = gstSetOff({ igst: 100, cgst: 50, sgst: 50 }, { igst: 120, cgst: 10, sgst: 0 });
    expect(r.cashIgst.toString()).toBe("0"); expect(r.cashCgst.toString()).toBe("20"); expect(r.cashSgst.toString()).toBe("50");
    expect(r.cashTotal.toString()).toBe("70");
  });
  it("late fee caps and interest", () => {
    const r = gstLateFeeAndInterest({ daysLate: 400, nil: false, netCashTax: 10000 });
    expect((r.result as { lateFee: string }).lateFee).toBe("10000.00");
    const i = gstLateFeeAndInterest({ daysLate: 30, nil: true, netCashTax: 0 });
    expect((i.result as { lateFee: string }).lateFee).toBe("500.00");
    expect(i.formula.length).toBeGreaterThan(5);
  });
  it("2B reconciliation", () => {
    const rows = reconcile2B(
      [{ gstin: "A", invoiceNo: "1", date: "", taxable: 100, cgst: 9, sgst: 9, igst: 0 }, { gstin: "A", invoiceNo: "2", date: "", taxable: 100, cgst: 9, sgst: 9, igst: 0 }],
      [{ gstin: "A", invoiceNo: "1", date: "", taxable: 100, cgst: 9, sgst: 9, igst: 0 }, { gstin: "B", invoiceNo: "9", date: "", taxable: 100, cgst: 0, sgst: 0, igst: 18 }],
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["matched", "missing_in_2b", "missing_in_books"]);
  });
});

describe("TDS", () => {
  const c194C = { section: "194C", rateIndividual: 1, rateOther: 2, singleThreshold: 30000, annualThreshold: 100000 };
  const c194J = { section: "194J(b)", rateIndividual: 10, rateOther: 10, singleThreshold: 0, annualThreshold: 50000 };
  it("194C thresholds and rates", () => {
    expect((computeTds(c194C, { amount: 20000, deducteeType: "company", panAvailable: true, paidYtd: 0 }).result as { tds: string }).tds).toBe("0");
    expect((computeTds(c194C, { amount: 50000, deducteeType: "company", panAvailable: true, paidYtd: 0 }).result as { tds: string }).tds).toBe("1000");
    expect((computeTds(c194C, { amount: 50000, deducteeType: "individual", panAvailable: true, paidYtd: 0 }).result as { tds: string }).tds).toBe("500");
  });
  it("20% when PAN is missing", () => {
    expect((computeTds(c194C, { amount: 50000, deducteeType: "individual", panAvailable: false, paidYtd: 0 }).result as { tds: string }).tds).toBe("10000");
  });
  it("catch-up on threshold crossing (194J)", () => {
    const r = computeTds(c194J, { amount: 30000, deducteeType: "company", panAvailable: true, paidYtd: 30000 }).result as { tds: string; base: string };
    expect(r.base).toBe("60000.00"); expect(r.tds).toBe("6000");
  });
});

describe("income tax", () => {
  const base = { salary: 0, otherIncome: 0, houseIncome: 0, s80C: 0, s80D: 0, s80CCD1B: 0, hra: 0, homeLoanInterest: 0, employerNps: 0, otherDeductions: 0 };
  it("new regime: rebate makes ₹12.75L salary nil, ₹15L salary taxed", () => {
    expect(incomeTax({ ...base, regime: "new", salary: 1275000 }).totalTax.toString()).toBe("0");
    // 15L - 75k = 14.25L: slab = 0+20k+40k+(1.425M-1.2M)*15% = 93,750 → +4% cess = 97,500
    expect(incomeTax({ ...base, regime: "new", salary: 1500000 }).totalTax.toString()).toBe("97500");
  });
  it("old regime with deductions", () => {
    // 10L - 50k - 1.5L(80C) = 8L → 12.5k + 3L*20% = 72,500 → +4% = 75,400
    expect(incomeTax({ ...base, regime: "old", salary: 1000000, s80C: 150000 }).totalTax.toString()).toBe("75400");
  });
  it("advance tax schedule", () => {
    const a = advanceTaxSchedule(100000);
    expect(a.rows[3].cumulative).toBe("100000"); expect(a.rows[0].instalment).toBe("15000");
    expect(advanceTaxSchedule(9000).applicable).toBe(false);
  });
  it("capital gains", () => {
    const lt = capitalGain({ type: "listed_equity", buy: 100000, sell: 300000, months: 18 });
    const st = capitalGain({ type: "listed_equity", buy: 100000, sell: 150000, months: 6 });
    expect(lt.kind).toBe("LTCG"); expect(st.kind).toBe("STCG");
    const t = capitalGainsTax([lt, st]);
    // LTCG 200k - 125k = 75k × 12.5% = 9375 ; STCG 50k × 20% = 10000
    expect(t.tax.toString()).toBe("19375");
  });
});

const stmt = { revenue: 1000, cogs: 600, opex: 150, depreciation: 50, otherIncome: 0, interest: 40, tax: 40, cash: 100, receivables: 150, inventory: 120, otherCA: 30, fixedAssets: 400, otherNCA: 0, payables: 90, otherCL: 60, shortDebt: 50, longDebt: 250, otherNCL: 0, equity: 350, cfo: 120, capex: 60, dividends: 20, shares: 10, price: 50, retained: 200 };
describe("ratios", () => {
  const r = Object.fromEntries(computeRatios(stmt).map((x) => [x.key, x.value as number]));
  it("profitability", () => {
    expect(r.gpm).toBeCloseTo(0.4); expect(r.ebitdam).toBeCloseTo(0.25); expect(r.opm).toBeCloseTo(0.2); expect(r.npm).toBeCloseTo(0.12);
  });
  it("liquidity & solvency", () => {
    expect(r.cr).toBeCloseTo(400 / 200); expect(r.qr).toBeCloseTo(280 / 200); expect(r.de).toBeCloseTo(300 / 350); expect(r.icr).toBeCloseTo(200 / 40);
  });
  it("valuation", () => {
    expect(r.eps).toBeCloseTo(12); expect(r.pe).toBeCloseTo(50 / 12); expect(r.evebitda).toBeCloseTo((500 + 300 - 100) / 250);
  });
  it("cash conversion cycle", () => { expect(r.ccc).toBeCloseTo(150 / 1000 * 365 + 120 / 600 * 365 - 90 / 600 * 365, 4); });
  it("common size", () => { expect(commonSize(stmt).income[2].pct).toBeCloseTo(0.4); });
  it("Altman & Piotroski", () => {
    const z = altmanZ(stmt, "manufacturing"); expect(z?.z).toBeGreaterThan(0);
    const p = piotroski(stmt, { ...stmt, revenue: 900, equity: 300, longDebt: 280 }); expect(p.score).toBeGreaterThanOrEqual(0); expect(p.signals).toHaveLength(9);
  });
  it("health score within 0..100", () => { const h = healthScore(stmt); expect(h.score).toBeGreaterThan(0); expect(h.score).toBeLessThanOrEqual(100); });
});

describe("valuation", () => {
  const input = { baseRevenue: 1000, growth: [0.1, 0.1, 0.1, 0.1, 0.1], ebitdaMargin: 0.25, daPct: 0.05, capexPct: 0.06, nwcPct: 0.1, taxRate: 0.25, wacc: 0.11, terminalGrowth: 0.04, terminalMethod: "gordon" as const, netDebt: 200, shares: 10 };
  it("DCF equals manual present value", () => {
    const r = dcf(input);
    const manual = r.rows.reduce((s, x) => s + x.fcf / 1.11 ** x.year, 0) + (r.rows[4].fcf * 1.04) / 0.07 / 1.11 ** 5;
    expect(r.ev).toBeCloseTo(manual, 6);
    expect(r.equity).toBeCloseTo(r.ev - 200, 6); expect(r.perShare).toBeCloseTo(r.equity / 10, 6);
  });
  it("flags invalid terminal assumptions", () => {
    expect(validateModel({ ...input, terminalGrowth: 0.12 }).some((i) => i.level === "error")).toBe(true);
  });
  it("WACC & DDM & LBO & break-even", () => {
    expect(wacc({ equityValue: 600, debtValue: 400, costEquity: 0.12, costDebt: 0.08, taxRate: 0.25 })).toBeCloseTo(0.6 * 0.12 + 0.4 * 0.08 * 0.75);
    expect(ddm({ dividend0: 2, highGrowth: 0.1, highYears: 3, stableGrowth: 0.03, costEquity: 0.1 }).value).toBeGreaterThan(0);
    const l = lbo({ ebitda: 100, entryMultiple: 8, leverage: 4, interestRate: 0.1, growth: 0.08, capexPct: 0.04, taxRate: 0.25, years: 5, exitMultiple: 8, revenueMargin: 0.2 });
    expect(l.moic).toBeGreaterThan(1);
    expect(breakEven({ fixedCosts: 100000, price: 50, variableCost: 30 }).units).toBe(5000);
  });
  it("three-statement projection balances", () => {
    const base = { ...stmt, equity: 400 + 0 };
    const adj = { ...base, equity: 100 + 150 + 120 + 30 + 400 - 90 - 60 - 50 - 250 };
    const p = threeStatement(adj, { growth: 0.1, cogsPct: 0.6, opexPct: 0.15, depPct: 0.1, interestRate: 0.1, taxRate: 0.25, dso: 55, dio: 70, dpo: 55, capexPct: 0.06, debtRepay: 25, payout: 0.2 }, 4);
    p.forEach((y) => { expect(Math.abs(y.checks.balance)).toBeLessThan(1e-6); expect(Math.abs(y.checks.cashRecon)).toBeLessThan(1e-6); });
  });
});

describe("portfolio", () => {
  const txs = [
    { symbol: "X", assetClass: "equity", kind: "buy" as const, date: "2024-01-01", qty: 10, price: 100, fees: 0 },
    { symbol: "X", assetClass: "equity", kind: "buy" as const, date: "2024-06-01", qty: 10, price: 120, fees: 0 },
    { symbol: "X", assetClass: "equity", kind: "sell" as const, date: "2025-03-01", qty: 15, price: 150, fees: 0 },
  ];
  it("FIFO realised P&L and remaining cost basis", () => {
    const p = positions(txs, { X: 160 });
    expect(p.totals.realisedPnl).toBeCloseTo(10 * 50 + 5 * 30);
    expect(p.holdings[0].qty).toBe(5); expect(p.holdings[0].avgCost).toBe(120); expect(p.holdings[0].unrealised).toBeCloseTo(200);
    expect(p.realised[0].term).toBe("long");
  });
  it("XIRR / CAGR", () => {
    expect(xirr([{ date: "2024-01-01", amount: -1000 }, { date: "2025-01-01", amount: 1100 }])).toBeCloseTo(0.1, 2);
    expect(cagr(100, 200, 5)).toBeCloseTo(Math.pow(2, 0.2) - 1);
  });
  it("risk metrics", () => {
    const rets = [0.01, -0.02, 0.03, 0.015, -0.01, 0.02, 0.005, -0.015, 0.025, 0.01];
    const m = riskMetrics(rets, { periodsPerYear: 12, riskFree: 0.05, benchmark: rets.map((r) => r * 0.8) })!;
    expect(m.vol).toBeGreaterThan(0); expect(m.maxDrawdown).toBeLessThan(0); expect(m.beta).toBeCloseTo(1.25, 6);
  });
  it("TWR & rebalance", () => {
    expect(twr([{ value: 100, flow: 0 }, { value: 210, flow: 100 }])).toBeCloseTo(0.1);
    const rb = rebalance({ A: 70, B: 30 }, { A: 50, B: 50 });
    expect(rb.find((r) => r.key === "A")!.trade).toBeCloseTo(-20);
  });
});

describe("technical", () => {
  const c = demoCandles("TEST", 200); const cl = c.map((x) => x.c);
  it("SMA/EMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5], 3)[2]).toBe(2);
  });
  it("RSI bounds, MACD, Bollinger ordering", () => {
    rsi(cl).forEach((v) => { if (v !== null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); } });
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14)[15]).toBe(100);
    expect(macd(cl).hist.length).toBe(200);
    const b = bollinger(cl); const i = 100; expect((b.upper[i] as number) > (b.mid[i] as number)).toBe(true);
  });
  it("others produce series", () => {
    expect(atr(c).filter((x) => x !== null).length).toBeGreaterThan(100);
    expect(adx(c).adx.filter((x) => x !== null).length).toBeGreaterThan(50);
    expect(stochastic(c).k[150]).not.toBeNull(); expect(ichimoku(c).spanA.length).toBe(200);
    expect(heikinAshi(c)[5].c).toBeCloseTo((c[5].o + c[5].h + c[5].l + c[5].c) / 4);
    expect(aggregate(c, "W").length).toBeLessThan(c.length / 4);
  });
  it("custom indicator evaluator is safe", () => {
    const r = customIndicator("sma(close,5) - sma(close,10)", c); expect(r.error).toBeUndefined(); expect(r.series[50]).not.toBeNull();
    expect(customIndicator("process.exit()", c).error).toBeDefined();
    expect(customIndicator("constructor", c).error).toBeDefined();
  });
});

describe("credit & insights", () => {
  it("EMI & amortisation clears to zero", () => {
    expect(emi(1000000, 9, 120).toString()).toBe("12667.58");
    const a = amortisation(500000, 10, 36); expect(a.rows[35].balance).toBe("0.00");
  });
  it("credit scorecard bounded", () => { const a = assessCredit(stmt, { amount: 100, ratePct: 10, months: 24 }); expect(a.score).toBeGreaterThanOrEqual(0); expect(a.score).toBeLessThanOrEqual(100); });
  it("formula evaluator", () => {
    expect(evalFormula("(a+b)/2", { a: 4, b: 6 }).value).toBe(5);
    expect(evalFormula("a/0", { a: 1 }).value).toBeNull();
    expect(evalFormula("alert(1)", {}).error).toBeDefined();
  });
  it("survival, anomalies, benford", () => {
    expect(survival({ cash: 100, monthlyRevenue: 100, monthlyFixedCosts: 80, variableCostPct: 0.5, revenueGrowth: 0 }).runwayMonths).toBe(3);
    const an = detectAnomalies([{ voucherId: "1", number: "JV-1", date: "2025-04-01", account: "Rent", amount: 12345 }, { voucherId: "2", number: "JV-2", date: "2025-04-01", account: "Rent", amount: 12345 }]);
    expect(an.some((x) => x.type === "Possible duplicate")).toBe(true);
    expect(benford([1, 2, 3]).suspicious).toBe(false);
  });
});
