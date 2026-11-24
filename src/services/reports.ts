import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, bankTransactions, bankAccounts, budgetLines, budgets, fixedAssets, tdsEntries, parties, vouchers, voucherLines, accounts, financialYears } from "@/db/schema";
import { balanceSheet, cashFlow, profitAndLoss, trialBalance, variance, type AccBal } from "@/engines/accounting";
import { computeRatios } from "@/engines/ratios";
import { D } from "@/engines/core";
import { getInventoryCatalog } from "./inventory";
import { ageing, getBalances, invoiceRows, ledgerStatement, loadStatements, stmtFromLedger } from "./finance";
import type { Col } from "@/components/DataTable";
import type { CompanyCtx } from "@/lib/ctx";

export type Report = { key: string; title: string; subtitle: string; columns: Col[]; rows: Record<string, string | number | null>[] };
const n = (d: { toFixed(x: number): string }) => d.toFixed(2);
const sub = (c: CompanyCtx) => `${c.company.name} · ${c.fy.label} (${c.fy.startDate} to ${c.fy.endDate}) · ${c.company.baseCurrency}`;

async function prevBalances(ctx: CompanyCtx): Promise<AccBal[] | null> {
  const [p] = await db.select().from(financialYears).where(and(eq(financialYears.companyId, ctx.company.id), lte(financialYears.endDate, ctx.fy.startDate))).orderBy(desc(financialYears.endDate)).limit(1);
  if (!p || p.id === ctx.fy.id) return null;
  return getBalances({ company: ctx.company, fy: p });
}

export const REPORTS: { key: string; label: string }[] = [
  { key: "trial-balance", label: "Trial Balance" }, { key: "profit-loss", label: "Profit & Loss" }, { key: "balance-sheet", label: "Balance Sheet" }, { key: "cash-flow", label: "Cash Flow Statement" },
  { key: "day-book", label: "Day Book / Vouchers" }, { key: "cash-book", label: "Cash Book" }, { key: "bank-book", label: "Bank Book" }, { key: "ratios", label: "Financial Ratios" },
  { key: "gst-sales", label: "GST Sales Register" }, { key: "gst-purchase", label: "GST Purchase Register" }, { key: "tds-register", label: "TDS Register" },
  { key: "ageing-receivables", label: "Receivables Ageing" }, { key: "ageing-payables", label: "Payables Ageing" },
  { key: "fixed-assets", label: "Fixed Assets Register" }, { key: "inventory", label: "Inventory Valuation" }, { key: "budget-vs-actual", label: "Budget vs Actual" },
  { key: "audit-trail", label: "Audit Trail" }, { key: "bank-transactions", label: "Bank Transactions" },
  { key: "bi-voucher-lines", label: "BI: Voucher lines (flat)" }, { key: "bi-accounts", label: "BI: Chart of accounts" },
];

export async function buildReport(ctx: CompanyCtx, key: string, params: Record<string, string> = {}): Promise<Report | null> {
  const M: Col["kind"] = "money";
  switch (key) {
    case "trial-balance": {
      const { tb } = await loadStatements(ctx);
      const rows = tb.rows.map((r) => ({ code: r.code, account: r.name, type: r.type, opening: n(r.opening), debit: n(r.dr), credit: n(r.cr), closingDr: n(r.closingDr), closingCr: n(r.closingCr) }));
      rows.push({ code: "", account: tb.balanced ? "TOTAL (balanced ✓)" : `TOTAL — OUT OF BALANCE by ${n(tb.difference)}`, type: "", opening: "", debit: n(tb.rows.reduce((s, r) => s.plus(r.dr), D(0))), credit: n(tb.rows.reduce((s, r) => s.plus(r.cr), D(0))), closingDr: n(tb.totalDr), closingCr: n(tb.totalCr) });
      return { key, title: "Trial Balance", subtitle: sub(ctx), rows, columns: [{ key: "code", label: "Code" }, { key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "opening", label: "Opening (Dr+/Cr−)", kind: M }, { key: "debit", label: "Debit", kind: M }, { key: "credit", label: "Credit", kind: M }, { key: "closingDr", label: "Closing Dr", kind: M }, { key: "closingCr", label: "Closing Cr", kind: M }] };
    }
    case "profit-loss": {
      const bals = await getBalances(ctx); const pl = profitAndLoss(bals); const pb = await prevBalances(ctx); const pp = pb ? profitAndLoss(pb) : null;
      const line = (label: string, k: keyof typeof pl) => ({ label, current: n(pl[k]), previous: pp ? n(pp[k]) : "", change: pp && !pp[k].isZero() ? pl[k].minus(pp[k]).div(pp[k].abs()).toNumber() : null });
      return { key, title: "Profit & Loss Account", subtitle: sub(ctx), columns: [{ key: "label", label: "Particulars" }, { key: "current", label: ctx.fy.label, kind: M }, { key: "previous", label: "Previous FY", kind: M }, { key: "change", label: "Change", kind: "pct" }],
        rows: [line("Revenue from operations", "revenue"), line("Less: Cost of goods sold", "cogs"), line("Gross profit", "grossProfit"), line("Less: Operating expenses", "opex"), line("EBITDA", "ebitda"), line("Less: Depreciation", "depreciation"), line("Operating profit (EBIT)", "ebit"), line("Add: Other income", "otherIncome"), line("Less: Finance costs", "interest"), line("Profit before tax", "pbt"), line("Less: Tax", "tax"), line("Net profit", "netProfit")] };
    }
    case "balance-sheet": {
      const bals = await getBalances(ctx); const b = balanceSheet(bals); const pb = await prevBalances(ctx); const p = pb ? balanceSheet(pb) : null;
      const l = (label: string, k: keyof typeof b) => ({ label, current: n(b[k] as never), previous: p ? n(p[k] as never) : "" });
      const rows = [l("Cash & bank", "cash"), l("Trade receivables", "receivables"), l("Inventory", "inventory"), l("Other current assets", "otherCA"), l("GST input credit", "gstInput"), l("Total current assets", "currentAssets"), l("Net fixed assets", "netFixed"), l("TOTAL ASSETS", "totalAssets"),
        l("Trade payables", "payables"), l("GST output payable", "gstOutput"), l("TDS payable", "tdsPayable"), l("Other current liabilities", "otherCL"), l("Short-term borrowings", "shortDebt"), l("Total current liabilities", "currentLiabilities"), l("Long-term loans", "longDebt"),
        l("Share capital", "capital"), l("Reserves", "reservesAcct"), l("Retained earnings (prior years)", "retained"), l("Current-year profit", "currentPL"), l("Total equity", "equity"), l("TOTAL LIABILITIES & EQUITY", "totalLiabEq")];
      if (!b.balanced) rows.push({ label: "⚠ Unreconciled opening-balance difference", current: n(b.difference), previous: "" });
      return { key, title: "Balance Sheet", subtitle: sub(ctx), rows, columns: [{ key: "label", label: "Particulars" }, { key: "current", label: ctx.fy.label, kind: M }, { key: "previous", label: "Previous FY", kind: M }] };
    }
    case "cash-flow": {
      const c = cashFlow(await getBalances(ctx));
      const r = (label: string, v: { toFixed(x: number): string }) => ({ label, amount: n(v) });
      return { key, title: "Cash Flow Statement (indirect method)", subtitle: sub(ctx), columns: [{ key: "label", label: "Particulars" }, { key: "amount", label: "Amount", kind: M }],
        rows: [r("Net profit", c.netProfit), r("Add: Depreciation", c.depreciation), r("(Increase)/decrease in receivables", c.dRec.neg()), r("(Increase)/decrease in inventory", c.dInv.neg()), r("(Increase)/decrease in other current assets", c.dOCA.neg()), r("Increase/(decrease) in payables", c.dPay), r("Increase/(decrease) in other current liabilities", c.dOCL), r("Cash from operating activities", c.operating), r("Cash from investing activities", c.investing), r("Cash from financing activities", c.financing), r("Net change in cash", c.netChange), r("Opening cash & bank", c.openingCash), r("Closing cash & bank", c.closingCash), { label: c.reconciled ? "✓ Reconciled to ledger cash & bank" : "⚠ Does not reconcile to ledger cash", amount: n(c.netChange.minus(c.actualChange)) }] };
    }
    case "day-book": case "cash-book": case "bank-book": {
      const role = key === "cash-book" ? ["cash"] : key === "bank-book" ? ["bank"] : null;
      const q = db.select({ date: vouchers.date, number: vouchers.number, type: vouchers.type, narration: vouchers.narration, status: vouchers.status, account: accounts.name, role: accounts.role, debit: voucherLines.debit, credit: voucherLines.credit })
        .from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt))).innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
        .where(and(eq(vouchers.companyId, ctx.company.id), gte(vouchers.date, ctx.fy.startDate), lte(vouchers.date, ctx.fy.endDate))).orderBy(asc(vouchers.date), asc(vouchers.number));
      let rows = await q; if (role) rows = rows.filter((r) => role.includes(r.role));
      if (params.q) rows = rows.filter((r) => `${r.number} ${r.narration} ${r.account}`.toLowerCase().includes(params.q.toLowerCase()));
      return { key, title: { "day-book": "Day Book", "cash-book": "Cash Book", "bank-book": "Bank Book" }[key]!, subtitle: sub(ctx), columns: [{ key: "date", label: "Date" }, { key: "number", label: "Voucher" }, { key: "type", label: "Type" }, { key: "account", label: "Ledger" }, { key: "narration", label: "Narration" }, { key: "status", label: "Status", kind: "tone" }, { key: "debit", label: "Debit", kind: M }, { key: "credit", label: "Credit", kind: M }], rows };
    }
    case "ledger": {
      const l = await ledgerStatement(ctx, params.account ?? ""); if (!l) return null;
      const rows: Report["rows"] = [{ date: ctx.fy.startDate, number: "", narration: "Opening balance", debit: "", credit: "", balance: n(l.opening) }, ...l.rows.map((r) => ({ date: r.date, number: r.number, narration: r.narration, debit: r.debit, credit: r.credit, balance: n(r.balance) })), { date: ctx.fy.endDate, number: "", narration: "Closing balance (Dr+/Cr−)", debit: "", credit: "", balance: n(l.closing) }];
      return { key, title: `Ledger — ${l.account.code} ${l.account.name}`, subtitle: sub(ctx), columns: [{ key: "date", label: "Date" }, { key: "number", label: "Voucher" }, { key: "narration", label: "Narration" }, { key: "debit", label: "Debit", kind: M }, { key: "credit", label: "Credit", kind: M }, { key: "balance", label: "Balance", kind: M }], rows };
    }
    case "ratios": {
      const st = stmtFromLedger(await loadStatements(ctx));
      return { key, title: "Financial Ratios (ledger-derived)", subtitle: sub(ctx), columns: [{ key: "category", label: "Category" }, { key: "name", label: "Ratio" }, { key: "value", label: "Value" }, { key: "formula", label: "Formula" }, { key: "inputs", label: "Inputs" }],
        rows: computeRatios(st).filter((r) => r.category !== "Valuation").map((r) => ({ category: r.category, name: r.name, value: r.value === null ? "n/a" : r.unit === "%" ? `${(r.value * 100).toFixed(2)}%` : `${r.value.toFixed(2)} ${r.unit}`, formula: r.formula, inputs: r.inputs })) };
    }
    case "gst-sales": case "gst-purchase": {
      const rows = await invoiceRows(ctx, key === "gst-sales" ? "sales" : "purchase");
      return { key, title: key === "gst-sales" ? "GST Sales Register" : "GST Purchase Register", subtitle: sub(ctx), columns: [{ key: "date", label: "Date" }, { key: "number", label: "Invoice" }, { key: "party", label: "Party" }, { key: "gstin", label: "GSTIN" }, { key: "pos", label: "POS" }, { key: "taxable", label: "Taxable", kind: M }, { key: "cgst", label: "CGST", kind: M }, { key: "sgst", label: "SGST", kind: M }, { key: "igst", label: "IGST", kind: M }, { key: "total", label: "Total", kind: M }, { key: "status", label: "Status", kind: "tone" }],
        rows: rows.map(({ inv, party }) => ({ date: inv.date, number: inv.number, party: party.name, gstin: party.gstin ?? "Unregistered", pos: inv.placeOfSupply, taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, total: inv.total, status: inv.status })) };
    }
    case "tds-register": {
      const rows = await db.select({ e: tdsEntries, p: parties }).from(tdsEntries).innerJoin(parties, eq(parties.id, tdsEntries.deducteeId)).where(and(eq(tdsEntries.companyId, ctx.company.id), gte(tdsEntries.date, ctx.fy.startDate), lte(tdsEntries.date, ctx.fy.endDate))).orderBy(asc(tdsEntries.date));
      return { key, title: "TDS Register", subtitle: sub(ctx), columns: [{ key: "date", label: "Date" }, { key: "deductee", label: "Deductee" }, { key: "pan", label: "PAN" }, { key: "section", label: "Section" }, { key: "gross", label: "Gross", kind: M }, { key: "rate", label: "Rate %" }, { key: "tds", label: "TDS", kind: M }, { key: "challan", label: "Challan" }], rows: rows.map(({ e, p }) => ({ date: e.date, deductee: p.name, pan: p.pan ?? "NOT AVAILABLE", section: e.section, gross: e.gross, rate: e.rate, tds: e.tds, challan: e.challanId ? "Linked" : "Pending" })) };
    }
    case "ageing-receivables": case "ageing-payables": {
      const rows = await ageing(ctx, key === "ageing-receivables" ? "sales" : "purchase", new Date().toISOString().slice(0, 10));
      return { key, title: key === "ageing-receivables" ? "Receivables Ageing" : "Payables Ageing", subtitle: `${ctx.company.name} · as of ${new Date().toISOString().slice(0, 10)} (days past due date)`, columns: [{ key: "party", label: "Party" }, { key: "nd", label: "Not due", kind: M }, { key: "b1", label: "1-30", kind: M }, { key: "b2", label: "31-60", kind: M }, { key: "b3", label: "61-90", kind: M }, { key: "b4", label: "90+", kind: M }, { key: "total", label: "Total", kind: M }],
        rows: rows.map((r) => ({ party: r.party, nd: r.buckets["Not due"], b1: r.buckets["1-30"], b2: r.buckets["31-60"], b3: r.buckets["61-90"], b4: r.buckets["90+"], total: r.total })) };
    }
    case "fixed-assets": {
      const rows = await db.select().from(fixedAssets).where(and(eq(fixedAssets.companyId, ctx.company.id), isNull(fixedAssets.deletedAt)));
      return { key, title: "Fixed Assets Register", subtitle: sub(ctx), columns: [{ key: "name", label: "Asset" }, { key: "category", label: "Category" }, { key: "date", label: "Purchased" }, { key: "method", label: "Method" }, { key: "cost", label: "Cost", kind: M }, { key: "acc", label: "Accumulated dep.", kind: M }, { key: "nbv", label: "Net book value", kind: M }], rows: rows.map((a) => ({ name: a.name, category: a.category, date: a.purchaseDate, method: `${a.method}${a.method === "WDV" ? ` @${a.wdvRate}%` : ` / ${a.lifeYears}y`}`, cost: a.cost, acc: a.accumulated, nbv: n(D(a.cost).minus(a.accumulated)) })) };
    }
    case "inventory": {
      const items = await getInventoryCatalog(ctx.company.id);
      const out: Report["rows"] = items.map((item) => ({
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        qty: item.onHand,
        avg: item.averageCost,
        value: n(D(item.value)),
        reorder: item.reorderLevel,
        status: item.hasHistoryError ? "Check stock history" : item.belowReorder ? "Below reorder level" : "OK",
      }));
      return { key, title: "Inventory Valuation (weighted average)", subtitle: sub(ctx), columns: [{ key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "unit", label: "Unit" }, { key: "qty", label: "Qty", kind: "num" }, { key: "avg", label: "Avg cost", kind: "num", dp: 4 }, { key: "value", label: "Value", kind: M }, { key: "reorder", label: "Reorder lvl", kind: "num" }, { key: "status", label: "Status", kind: "tone" }], rows: out };
    }
    case "budget-vs-actual": {
      const bals = await getBalances(ctx); const bm = new Map(bals.map((b) => [b.id, b]));
      const [bud] = params.budget ? await db.select().from(budgets).where(and(eq(budgets.id, params.budget), eq(budgets.companyId, ctx.company.id))) : await db.select().from(budgets).where(and(eq(budgets.companyId, ctx.company.id), eq(budgets.fyId, ctx.fy.id), isNull(budgets.deletedAt))).orderBy(desc(budgets.createdAt)).limit(1);
      if (!bud) return { key, title: "Budget vs Actual", subtitle: sub(ctx), columns: [], rows: [] };
      const lines = await db.select().from(budgetLines).where(eq(budgetLines.budgetId, bud.id));
      const rows = lines.map((l) => { const a = bm.get(l.accountId); const bud12 = l.amounts.reduce((s, x) => s.plus(x), D(0)); const act = a ? (a.type === "income" ? D(a.cr).minus(a.dr) : D(a.dr).minus(a.cr)) : D(0); const v = variance(a?.type === "income" ? "income" : "expense", bud12, act); return { account: a ? `${a.code} ${a.name}` : "?", budget: n(bud12), actual: n(act), variance: n(v.diff), pct: v.pct, status: v.favourable ? "Favourable" : "Adverse" }; });
      return { key, title: `Budget vs Actual — ${bud.name}`, subtitle: sub(ctx), columns: [{ key: "account", label: "Account" }, { key: "budget", label: "Budget (FY)", kind: M }, { key: "actual", label: "Actual (YTD)", kind: M }, { key: "variance", label: "Variance", kind: M }, { key: "pct", label: "Var %", kind: "pct" }, { key: "status", label: "Status", kind: "tone" }], rows };
    }
    case "audit-trail": {
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.orgId, ctx.org.id)).orderBy(desc(auditLogs.at)).limit(500);
      return { key, title: "Audit Trail", subtitle: `${ctx.org.name} · latest 500 events`, columns: [{ key: "at", label: "Timestamp (UTC)" }, { key: "action", label: "Action" }, { key: "entity", label: "Entity" }, { key: "ref", label: "Reference" }, { key: "detail", label: "Detail" }], rows: rows.map((r) => ({ at: r.at.toISOString().replace("T", " ").slice(0, 19), action: r.action, entity: r.entity, ref: r.entityId?.slice(0, 8) ?? "", detail: JSON.stringify(r.detail) })) };
    }
    case "bank-transactions": {
      const rows = await db.select({ t: bankTransactions, a: bankAccounts }).from(bankTransactions).innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId)).where(eq(bankTransactions.companyId, ctx.company.id)).orderBy(desc(bankTransactions.date)).limit(2000);
      return { key, title: "Bank Transactions", subtitle: sub(ctx), columns: [{ key: "date", label: "Date" }, { key: "account", label: "Account" }, { key: "description", label: "Description" }, { key: "category", label: "Category" }, { key: "debit", label: "Debit", kind: M }, { key: "credit", label: "Credit", kind: M }, { key: "status", label: "Status", kind: "tone" }], rows: rows.map(({ t, a }) => ({ date: t.date, account: a.name, description: t.description, category: t.category, debit: t.debit, credit: t.credit, status: t.status })) };
    }
    case "bi-voucher-lines": {
      const rows = await db.select({ date: vouchers.date, number: vouchers.number, type: vouchers.type, code: accounts.code, account: accounts.name, accType: accounts.type, role: accounts.role, debit: voucherLines.debit, credit: voucherLines.credit, narration: vouchers.narration })
        .from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt))).innerJoin(accounts, eq(accounts.id, voucherLines.accountId)).where(eq(vouchers.companyId, ctx.company.id)).orderBy(asc(vouchers.date));
      return { key, title: "BI export — voucher lines", subtitle: sub(ctx), columns: Object.keys(rows[0] ?? { date: 1, number: 1, type: 1, code: 1, account: 1, accType: 1, role: 1, debit: 1, credit: 1, narration: 1 }).map((k) => ({ key: k, label: k })), rows };
    }
    case "bi-accounts": {
      const rows = await db.select({ code: accounts.code, name: accounts.name, type: accounts.type, role: accounts.role, group: accounts.groupName }).from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt))).orderBy(asc(accounts.code));
      return { key, title: "BI export — chart of accounts", subtitle: sub(ctx), columns: ["code", "name", "type", "role", "group"].map((k) => ({ key: k, label: k })), rows };
    }
  }
  return null;
}
