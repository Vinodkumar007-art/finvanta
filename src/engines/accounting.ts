import { D, Decimal, r2, sum } from "./core";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export const VOUCHER_TYPES = ["journal", "payment", "receipt", "contra", "sales", "purchase", "debit_note", "credit_note"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];
export const VOUCHER_PREFIX: Record<string, string> = {
  journal: "JV", payment: "PV", receipt: "RV", contra: "CV", sales: "SV", purchase: "PU", debit_note: "DN", credit_note: "CN",
};

export type DefaultAccount = { code: string; name: string; type: AccountType; role: string; groupName: string };
export const DEFAULT_COA: DefaultAccount[] = [
  { code: "1001", name: "Cash in Hand", type: "asset", role: "cash", groupName: "Current Assets" },
  { code: "1002", name: "Bank Account", type: "asset", role: "bank", groupName: "Current Assets" },
  { code: "1100", name: "Accounts Receivable", type: "asset", role: "ar", groupName: "Current Assets" },
  { code: "1200", name: "Inventory", type: "asset", role: "inventory", groupName: "Current Assets" },
  { code: "1300", name: "Advances & Prepaid", type: "asset", role: "other_ca", groupName: "Current Assets" },
  { code: "1310", name: "TDS Receivable", type: "asset", role: "other_ca", groupName: "Current Assets" },
  { code: "1321", name: "Input CGST", type: "asset", role: "input_cgst", groupName: "Current Assets" },
  { code: "1322", name: "Input SGST", type: "asset", role: "input_sgst", groupName: "Current Assets" },
  { code: "1323", name: "Input IGST", type: "asset", role: "input_igst", groupName: "Current Assets" },
  { code: "1500", name: "Fixed Assets (Gross Block)", type: "asset", role: "fixed_asset", groupName: "Fixed Assets" },
  { code: "1510", name: "Accumulated Depreciation", type: "asset", role: "accum_dep", groupName: "Fixed Assets" },
  { code: "2001", name: "Accounts Payable", type: "liability", role: "ap", groupName: "Current Liabilities" },
  { code: "2100", name: "Other Payables", type: "liability", role: "other_cl", groupName: "Current Liabilities" },
  { code: "2121", name: "Output CGST", type: "liability", role: "output_cgst", groupName: "Current Liabilities" },
  { code: "2122", name: "Output SGST", type: "liability", role: "output_sgst", groupName: "Current Liabilities" },
  { code: "2123", name: "Output IGST", type: "liability", role: "output_igst", groupName: "Current Liabilities" },
  { code: "2200", name: "TDS Payable", type: "liability", role: "tds_payable", groupName: "Current Liabilities" },
  { code: "2300", name: "Short-term Borrowings", type: "liability", role: "st_loan", groupName: "Current Liabilities" },
  { code: "2500", name: "Long-term Loans", type: "liability", role: "loan", groupName: "Non-current Liabilities" },
  { code: "3001", name: "Share Capital", type: "equity", role: "capital", groupName: "Equity" },
  { code: "3100", name: "Reserves & Surplus", type: "equity", role: "reserves", groupName: "Equity" },
  { code: "4001", name: "Sales Revenue", type: "income", role: "sales", groupName: "Revenue" },
  { code: "4100", name: "Other Income", type: "income", role: "other_income", groupName: "Other Income" },
  { code: "5001", name: "Cost of Goods Sold / Purchases", type: "expense", role: "cogs", groupName: "Direct Costs" },
  { code: "5100", name: "Salaries & Wages", type: "expense", role: "opex", groupName: "Operating Expenses" },
  { code: "5110", name: "Rent", type: "expense", role: "opex", groupName: "Operating Expenses" },
  { code: "5120", name: "Utilities & Office", type: "expense", role: "opex", groupName: "Operating Expenses" },
  { code: "5130", name: "Marketing", type: "expense", role: "opex", groupName: "Operating Expenses" },
  { code: "5140", name: "Professional Fees", type: "expense", role: "opex", groupName: "Operating Expenses" },
  { code: "5900", name: "Depreciation", type: "expense", role: "depreciation", groupName: "Depreciation" },
  { code: "5950", name: "Interest Expense", type: "expense", role: "interest", groupName: "Finance Costs" },
  { code: "5990", name: "Income Tax Expense", type: "expense", role: "tax", groupName: "Tax" },
];

/* ---------- Double-entry validation ---------- */
export type LineIn = { accountId: string; debit: Decimal.Value; credit: Decimal.Value };
export function validateVoucher(lines: LineIn[]) {
  const errors: string[] = [];
  if (lines.length < 2) errors.push("A voucher needs at least two lines.");
  lines.forEach((l, i) => {
    const d = D(l.debit), c = D(l.credit);
    if (!l.accountId) errors.push(`Line ${i + 1}: select a ledger account.`);
    if (d.isNeg() || c.isNeg()) errors.push(`Line ${i + 1}: amounts cannot be negative.`);
    if (d.gt(0) && c.gt(0)) errors.push(`Line ${i + 1}: a line cannot carry both debit and credit.`);
    if (d.isZero() && c.isZero()) errors.push(`Line ${i + 1}: enter a debit or a credit amount.`);
    if (d.decimalPlaces() > 2 || c.decimalPlaces() > 2) errors.push(`Line ${i + 1}: maximum 2 decimal places.`);
  });
  const totalDebit = sum(lines.map((l) => l.debit));
  const totalCredit = sum(lines.map((l) => l.credit));
  if (!totalDebit.eq(totalCredit)) errors.push(`Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)}).`);
  return { ok: errors.length === 0, errors, totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2) };
}

export function reversalLines<T extends { accountId: string; debit: Decimal.Value; credit: Decimal.Value }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, debit: D(l.credit).toFixed(2), credit: D(l.debit).toFixed(2) }));
}

export function nextVoucherNumber(type: string, existing: string[]): string {
  const prefix = VOUCHER_PREFIX[type] ?? "VC";
  const max = existing.reduce((m, n) => {
    const x = /(\d+)$/.exec(n);
    return x ? Math.max(m, parseInt(x[1], 10)) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(5, "0")}`;
}

/* ---------- Statements ---------- */
export type AccBal = {
  id: string; code: string; name: string; type: AccountType; role: string; groupName: string;
  prior: string; // signed net (debit +) of opening balance + all postings before FY start
  dr: string; cr: string; // postings inside FY
};

const isPL = (t: AccountType) => t === "income" || t === "expense";
const CASH_ROLES = ["cash", "bank"];
const CA_ROLES = ["cash", "bank", "ar", "inventory", "other_ca", "input_cgst", "input_sgst", "input_igst"];
const CL_ROLES = ["ap", "other_cl", "output_cgst", "output_sgst", "output_igst", "tds_payable", "st_loan"];

export type TBRow = { id: string; code: string; name: string; type: string; opening: Decimal; dr: Decimal; cr: Decimal; closingDr: Decimal; closingCr: Decimal; closingNet: Decimal };

export function trialBalance(bals: AccBal[]) {
  const retainedPrior = bals.filter((b) => isPL(b.type)).reduce((s, b) => s.plus(D(b.prior)), D(0)); // signed net (debit+)
  const rows: TBRow[] = bals.map((b) => {
    const opening = isPL(b.type) ? D(0) : D(b.prior);
    const closingNet = opening.plus(b.dr).minus(b.cr);
    return {
      id: b.id, code: b.code, name: b.name, type: b.type, opening, dr: D(b.dr), cr: D(b.cr), closingNet,
      closingDr: closingNet.gt(0) ? closingNet : D(0), closingCr: closingNet.lt(0) ? closingNet.neg() : D(0),
    };
  });
  if (!retainedPrior.isZero()) {
    const net = retainedPrior;
    rows.push({
      id: "retained", code: "—", name: "Retained earnings b/f (prior-year P&L, derived)", type: "equity", opening: net, dr: D(0), cr: D(0), closingNet: net,
      closingDr: net.gt(0) ? net : D(0), closingCr: net.lt(0) ? net.neg() : D(0),
    });
  }
  const totalDr = sum(rows.map((r) => r.closingDr));
  const totalCr = sum(rows.map((r) => r.closingCr));
  return { rows, totalDr, totalCr, balanced: totalDr.eq(totalCr), difference: totalDr.minus(totalCr) };
}

export type PL = ReturnType<typeof profitAndLoss>;
export function profitAndLoss(bals: AccBal[]) {
  const net = (f: (b: AccBal) => boolean) => sum(bals.filter(f).map((b) => D(b.dr).minus(b.cr)));
  const inc = (b: AccBal) => b.type === "income";
  const exp = (b: AccBal) => b.type === "expense";
  const revenue = net((b) => inc(b) && b.role === "sales").neg();
  const otherIncome = net((b) => inc(b) && b.role !== "sales").neg();
  const cogs = net((b) => exp(b) && b.role === "cogs");
  const depreciation = net((b) => exp(b) && b.role === "depreciation");
  const interest = net((b) => exp(b) && b.role === "interest");
  const tax = net((b) => exp(b) && b.role === "tax");
  const opex = net((b) => exp(b) && !["cogs", "depreciation", "interest", "tax"].includes(b.role));
  const grossProfit = revenue.minus(cogs);
  const ebitda = grossProfit.minus(opex);
  const ebit = ebitda.minus(depreciation);
  const pbt = ebit.plus(otherIncome).minus(interest);
  const netProfit = pbt.minus(tax);
  return { revenue, otherIncome, cogs, grossProfit, opex, ebitda, depreciation, ebit, interest, pbt, tax, netProfit };
}

export type BS = ReturnType<typeof balanceSheet>;
/** Balance sheet at the FY end. P&L accounts roll into reserves (prior years + current profit). */
export function balanceSheet(bals: AccBal[], asOf: "closing" | "opening" = "closing") {
  const bsAccts = bals.filter((b) => !isPL(b.type));
  const netOf = (b: AccBal) => (asOf === "closing" ? D(b.prior).plus(b.dr).minus(b.cr) : D(b.prior));
  const byRole = (roles: string[]) => sum(bsAccts.filter((b) => roles.includes(b.role)).map(netOf));
  const plAccts = bals.filter((b) => isPL(b.type));
  const priorPL = sum(plAccts.map((b) => D(b.prior))).neg(); // credit positive
  const currentPL = asOf === "closing" ? sum(plAccts.map((b) => D(b.dr).minus(b.cr))).neg() : D(0);
  const known = new Set([...CA_ROLES, "fixed_asset", "accum_dep", ...CL_ROLES, "loan", "capital", "reserves"]);
  const otherAssets = sum(bsAccts.filter((b) => b.type === "asset" && !known.has(b.role)).map(netOf));
  const otherLiab = sum(bsAccts.filter((b) => b.type === "liability" && !known.has(b.role)).map(netOf)).neg();
  const otherEquity = sum(bsAccts.filter((b) => b.type === "equity" && !known.has(b.role)).map(netOf)).neg();

  const cash = byRole(CASH_ROLES);
  const receivables = byRole(["ar"]);
  const inventory = byRole(["inventory"]);
  const otherCA = byRole(["other_ca"]);
  const gstInput = byRole(["input_cgst", "input_sgst", "input_igst"]);
  const currentAssets = cash.plus(receivables).plus(inventory).plus(otherCA).plus(gstInput);
  const grossBlock = byRole(["fixed_asset"]);
  const accumDep = byRole(["accum_dep"]).neg(); // positive number
  const netFixed = grossBlock.minus(accumDep);
  const totalAssets = currentAssets.plus(netFixed).plus(otherAssets);

  const payables = byRole(["ap"]).neg();
  const gstOutput = byRole(["output_cgst", "output_sgst", "output_igst"]).neg();
  const tdsPayable = byRole(["tds_payable"]).neg();
  const otherCL = byRole(["other_cl"]).neg().plus(otherLiab);
  const shortDebt = byRole(["st_loan"]).neg();
  const currentLiabilities = payables.plus(gstOutput).plus(tdsPayable).plus(otherCL).plus(shortDebt);
  const longDebt = byRole(["loan"]).neg();
  const capital = byRole(["capital"]).neg();
  const reservesAcct = byRole(["reserves"]).neg().plus(otherEquity);
  const retained = priorPL;
  const equity = capital.plus(reservesAcct).plus(retained).plus(currentPL);
  const totalLiabEq = currentLiabilities.plus(longDebt).plus(equity);
  const difference = totalAssets.minus(totalLiabEq); // unreconciled opening-balance difference, if any
  return {
    cash, receivables, inventory, otherCA, gstInput, currentAssets, grossBlock, accumDep, netFixed, otherAssets, totalAssets,
    payables, gstOutput, tdsPayable, otherCL, shortDebt, currentLiabilities, longDebt, capital, reservesAcct, retained, currentPL, equity,
    totalLiabEq, difference, balanced: difference.abs().lt(0.005), debt: shortDebt.plus(longDebt),
    totalLiabilities: currentLiabilities.plus(longDebt),
  };
}

/** Indirect cash-flow statement; reconciles to movement in cash & bank by construction (see tests). */
export function cashFlow(bals: AccBal[]) {
  const o = balanceSheet(bals, "opening");
  const c = balanceSheet(bals, "closing");
  const pl = profitAndLoss(bals);
  const dRec = c.receivables.minus(o.receivables);
  const dInv = c.inventory.minus(o.inventory);
  const dOCA = c.otherCA.plus(c.gstInput).plus(c.otherAssets).minus(o.otherCA.plus(o.gstInput).plus(o.otherAssets));
  const dPay = c.payables.minus(o.payables);
  const dOCL = c.gstOutput.plus(c.tdsPayable).plus(c.otherCL).minus(o.gstOutput.plus(o.tdsPayable).plus(o.otherCL));
  const operating = pl.netProfit.plus(pl.depreciation).minus(dRec).minus(dInv).minus(dOCA).plus(dPay).plus(dOCL);
  const dGross = c.grossBlock.minus(o.grossBlock);
  const dAcc = c.accumDep.minus(o.accumDep);
  const investing = dGross.neg().plus(dAcc.minus(pl.depreciation));
  const financing = c.debt.minus(o.debt).plus(c.capital.minus(o.capital)).plus(c.reservesAcct.minus(o.reservesAcct));
  const unreconciled = c.difference.minus(o.difference).neg();
  const net = operating.plus(investing).plus(financing).plus(unreconciled);
  const actual = c.cash.minus(o.cash);
  return {
    netProfit: pl.netProfit, depreciation: pl.depreciation, dRec, dInv, dOCA, dPay, dOCL, operating, investing, financing, unreconciled,
    netChange: net, actualChange: actual, openingCash: o.cash, closingCash: c.cash, reconciled: net.minus(actual).abs().lt(0.005),
  };
}

/* ---------- Fixed assets, inventory, ageing, variance ---------- */
export function depreciationForYear(a: { cost: Decimal.Value; salvage: Decimal.Value; lifeYears: number; method: "SLM" | "WDV"; wdvRate?: Decimal.Value; accumulated: Decimal.Value }) {
  const cost = D(a.cost), salvage = D(a.salvage), acc = D(a.accumulated);
  const maxDep = Decimal.max(cost.minus(salvage).minus(acc), 0);
  const raw = a.method === "SLM"
    ? cost.minus(salvage).div(Math.max(1, a.lifeYears))
    : cost.minus(acc).mul(D(a.wdvRate ?? 15).div(100));
  return r2(Decimal.min(raw, maxDep));
}

export function weightedAverageInventory(moves: { date: string; kind: "in" | "out"; qty: Decimal.Value; rate: Decimal.Value }[]) {
  let qty = D(0), value = D(0), cogs = D(0);
  const errors: string[] = [];
  [...moves].sort((a, b) => a.date.localeCompare(b.date)).forEach((m) => {
    const q = D(m.qty);
    if (m.kind === "in") { qty = qty.plus(q); value = value.plus(q.mul(m.rate)); }
    else {
      if (q.gt(qty)) { errors.push(`Issue of ${q} on ${m.date} exceeds stock ${qty}`); return; }
      const avg = qty.isZero() ? D(0) : value.div(qty);
      const out = q.mul(avg);
      qty = qty.minus(q); value = value.minus(out); cogs = cogs.plus(out);
    }
  });
  return { qty, value: r2(value), avgCost: qty.isZero() ? D(0) : value.div(qty), cogs: r2(cogs), errors };
}

export const AGEING_BUCKETS = ["Not due", "1-30", "31-60", "61-90", "90+"] as const;
export function ageingBucket(dueDate: string, asOf: string): (typeof AGEING_BUCKETS)[number] {
  const days = Math.floor((Date.parse(asOf) - Date.parse(dueDate)) / 86400000);
  if (days <= 0) return "Not due";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function variance(type: "income" | "expense", budget: Decimal.Value, actual: Decimal.Value) {
  const b = D(budget), a = D(actual);
  const diff = a.minus(b);
  const favourable = type === "income" ? diff.gte(0) : diff.lte(0);
  return { diff, pct: b.isZero() ? null : diff.div(b).toNumber(), favourable };
}

export function fyBounds(startMonth: number, ref: Date) {
  const y = ref.getMonth() + 1 >= startMonth ? ref.getFullYear() : ref.getFullYear() - 1;
  const start = new Date(Date.UTC(y, startMonth - 1, 1));
  const end = new Date(Date.UTC(y + 1, startMonth - 1, 0));
  const label = startMonth === 1 ? `${y}` : `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label };
}
