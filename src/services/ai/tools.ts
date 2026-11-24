import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, aiProposals, documents, tdsSections } from "@/db/schema";
import { calcRecord, D, r2, type CalcRecord } from "@/engines/core";
import { validateVoucher } from "@/engines/accounting";
import { computeRatios } from "@/engines/ratios";
import { computeTds, gstSplit, incomeTax, TAX_RULES } from "@/engines/tax";
import { emi } from "@/engines/credit";
import { dcf } from "@/engines/valuation";
import { ageing, loadStatements, stmtFromLedger } from "@/services/finance";
import { getIndianStock, getIndianStockList, searchIndianStocks } from "@/services/indian-market";
import { getQuote } from "@/services/market";
import { logCalc } from "@/lib/audit";
import type { CompanyCtx } from "@/lib/ctx";

type ToolOut = { result: unknown; source: string; calc?: CalcRecord };
const fx = (d: { toFixed(n: number): string }) => d.toFixed(2);

export const TOOL_DEFS = [
  { name: "get_financial_summary", description: "Current-FY P&L, balance sheet and cash-flow totals from the ledger.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_trial_balance", description: "Trial balance of the active company/FY with balance check.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_ratios", description: "Financial ratios computed from the ledger with formulas and inputs.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_ageing", description: "Receivables or payables ageing as of today.", parameters: { type: "object", properties: { kind: { type: "string", enum: ["receivables", "payables"] } }, required: ["kind"] } },
  { name: "calc_gst", description: "Compute CGST/SGST/IGST on a taxable value.", parameters: { type: "object", properties: { taxable: { type: "number" }, rate_percent: { type: "number" }, interstate: { type: "boolean" } }, required: ["taxable", "rate_percent", "interstate"] } },
  { name: "calc_tds", description: "Compute TDS for a payment under a section (194C, 194J(b), 194I(b), 194A, 194H, 194Q).", parameters: { type: "object", properties: { section: { type: "string" }, amount: { type: "number" }, deductee_type: { type: "string", enum: ["individual", "company"] }, pan_available: { type: "boolean" }, paid_ytd: { type: "number" } }, required: ["section", "amount", "deductee_type", "pan_available"] } },
  { name: "calc_income_tax", description: "Compute income tax under old or new regime for salary and other income.", parameters: { type: "object", properties: { regime: { type: "string", enum: ["old", "new"] }, salary: { type: "number" }, other_income: { type: "number" }, s80c: { type: "number" }, s80d: { type: "number" }, hra: { type: "number" }, home_loan_interest: { type: "number" } }, required: ["regime", "salary"] } },
  { name: "calc_emi", description: "EMI for a loan.", parameters: { type: "object", properties: { principal: { type: "number" }, annual_rate_percent: { type: "number" }, months: { type: "number" } }, required: ["principal", "annual_rate_percent", "months"] } },
  { name: "calc_dcf", description: "Driver-based DCF valuation.", parameters: { type: "object", properties: { base_revenue: { type: "number" }, growth_rates: { type: "array", items: { type: "number" }, description: "decimals, e.g. 0.1" }, ebitda_margin: { type: "number" }, da_pct: { type: "number" }, capex_pct: { type: "number" }, nwc_pct: { type: "number" }, tax_rate: { type: "number" }, wacc: { type: "number" }, terminal_growth: { type: "number" }, net_debt: { type: "number" }, shares: { type: "number" } }, required: ["base_revenue", "growth_rates", "ebitda_margin", "wacc", "terminal_growth"] } },
  { name: "search_documents", description: "Search uploaded documents (extracted text) of the active company.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_market_quote", description: "Latest quote from the configured market data provider. Returns unavailable if no provider is configured.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
  { name: "search_indian_stocks", description: "Search NSE/BSE companies and symbols from the configured Indian Market API.", parameters: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 80 } }, required: ["query"], additionalProperties: false } },
  { name: "get_indian_stock", description: "Retrieve current/latest available NSE/BSE stock price and fundamentals. Missing values are returned as null, never estimated.", parameters: { type: "object", properties: { symbol: { type: "string", minLength: 1, maxLength: 30 } }, required: ["symbol"], additionalProperties: false } },
  { name: "compare_indian_stocks", description: "Retrieve comparable quote and fundamentals for 2–10 NSE/BSE symbols. Missing values are returned as null.", parameters: { type: "object", properties: { symbols: { type: "array", minItems: 2, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 30 } } }, required: ["symbols"], additionalProperties: false } },
  { name: "propose_journal_entry", description: "Create a DRAFT journal entry for the user to approve. It does NOT post anything.", parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, narration: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { account_code: { type: "string" }, debit: { type: "number" }, credit: { type: "number" } }, required: ["account_code", "debit", "credit"] } } }, required: ["date", "narration", "lines"] } },
] as const;

export async function runTool(name: string, a: Record<string, unknown>, ctx: CompanyCtx, conversationId?: string): Promise<ToolOut> {
  const fyLabel = ctx.fy.label;
  switch (name) {
    case "get_financial_summary": {
      const s = await loadStatements(ctx);
      return { source: `ledger:${ctx.company.name}:${fyLabel}`, result: {
        currency: ctx.company.baseCurrency, financialYear: fyLabel,
        pl: Object.fromEntries(Object.entries(s.pl).map(([k, v]) => [k, fx(v)])),
        balanceSheet: { cash: fx(s.bs.cash), receivables: fx(s.bs.receivables), inventory: fx(s.bs.inventory), currentAssets: fx(s.bs.currentAssets), netFixedAssets: fx(s.bs.netFixed), totalAssets: fx(s.bs.totalAssets), payables: fx(s.bs.payables), currentLiabilities: fx(s.bs.currentLiabilities), debt: fx(s.bs.debt), equity: fx(s.bs.equity), balanced: s.bs.balanced },
        cashFlow: { operating: fx(s.cf.operating), investing: fx(s.cf.investing), financing: fx(s.cf.financing), netChange: fx(s.cf.netChange), reconciledToCash: s.cf.reconciled },
      } };
    }
    case "get_trial_balance": {
      const s = await loadStatements(ctx);
      return { source: `ledger:${ctx.company.name}:${fyLabel}`, result: { balanced: s.tb.balanced, totalDebit: fx(s.tb.totalDr), totalCredit: fx(s.tb.totalCr), rows: s.tb.rows.map((r) => ({ code: r.code, account: r.name, debit: fx(r.closingDr), credit: fx(r.closingCr) })) } };
    }
    case "get_ratios": {
      const st = stmtFromLedger(await loadStatements(ctx));
      return { source: `ledger:${ctx.company.name}:${fyLabel}`, result: { note: "Valuation ratios need share count & price and are n/a for ledger-derived data.", ratios: computeRatios(st).filter((r) => r.category !== "Valuation").map((r) => ({ name: r.name, value: r.value === null ? null : r.unit === "%" ? `${(r.value * 100).toFixed(2)}%` : r.value.toFixed(2) + (r.unit === "x" ? "x" : ` ${r.unit}`), formula: r.formula, inputs: r.inputs })) } };
    }
    case "get_ageing": {
      const kind = a.kind === "payables" ? "purchase" : "sales";
      const rows = await ageing(ctx, kind, new Date().toISOString().slice(0, 10));
      return { source: `subledger:${a.kind}:${new Date().toISOString().slice(0, 10)}`, result: rows.map((r) => ({ party: r.party, ...r.buckets, total: r.total })) };
    }
    case "calc_gst": {
      const g = gstSplit(D(a.taxable as number), Number(a.rate_percent), "27", a.interstate ? "29" : "27");
      const rec = calcRecord("GST", "CGST=SGST=taxable×rate/200 (intra-state); IGST=taxable×rate/100 (inter-state)", a, { cgst: fx(g.cgst), sgst: fx(g.sgst), igst: fx(g.igst), totalTax: fx(g.total), invoiceTotal: fx(D(a.taxable as number).plus(g.total)) }, ["Rate supplied by user; verify against the current GST rate schedule/HSN."], "FINVANTA tax engine");
      await logCalc(ctx, rec); return { source: "calc_gst", result: rec.result, calc: rec };
    }
    case "calc_tds": {
      const [row] = await db.select().from(tdsSections).where(and(eq(tdsSections.companyId, ctx.company.id), eq(tdsSections.section, String(a.section))));
      if (!row) return { source: "calc_tds", result: { error: `Section ${a.section} is not configured for this company.` } };
      const rec = computeTds({ section: row.section, rateIndividual: row.rateIndividual, rateOther: row.rateOther, singleThreshold: row.singleThreshold, annualThreshold: row.annualThreshold }, { amount: D(a.amount as number), deducteeType: a.deductee_type as "individual" | "company", panAvailable: !!a.pan_available, paidYtd: D((a.paid_ytd as number) ?? 0) });
      await logCalc(ctx, rec); return { source: "calc_tds", result: rec.result, calc: rec };
    }
    case "calc_income_tax": {
      const r = incomeTax({ regime: a.regime as "old" | "new", salary: Number(a.salary), otherIncome: Number(a.other_income ?? 0), houseIncome: 0, s80C: Number(a.s80c ?? 0), s80D: Number(a.s80d ?? 0), s80CCD1B: 0, hra: Number(a.hra ?? 0), homeLoanInterest: Number(a.home_loan_interest ?? 0), employerNps: 0, otherDeductions: 0 });
      const rec = calcRecord("Income tax", "Slab tax − 87A rebate + surcharge + 4% cess", a, { regime: r.regime, grossIncome: fx(r.gross), standardDeduction: fx(r.standardDeduction), deductions: fx(r.deductions), taxableIncome: fx(r.taxable), rebate87A: fx(r.rebate), surcharge: fx(r.surcharge), cess: fx(r.cess), totalTax: r.totalTax.toFixed(0) }, [`Rules table FY ${TAX_RULES.fy}; verify with incometax.gov.in.`, "Surcharge marginal relief not modelled."], "FINVANTA tax engine");
      await logCalc(ctx, rec); return { source: "calc_income_tax", result: rec.result, calc: rec };
    }
    case "calc_emi": {
      const e = emi(Number(a.principal), Number(a.annual_rate_percent), Number(a.months));
      const total = e.mul(Number(a.months));
      const rec = calcRecord("EMI", "EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = annual rate/12/100", a, { emi: fx(e), totalPayment: fx(total), totalInterest: fx(total.minus(D(a.principal as number))) }, ["Reducing-balance monthly compounding; last instalment may differ by rounding."], "FINVANTA credit engine");
      await logCalc(ctx, rec); return { source: "calc_emi", result: rec.result, calc: rec };
    }
    case "calc_dcf": {
      const g = (a.growth_rates as number[]).slice(0, 15);
      const input = { baseRevenue: Number(a.base_revenue), growth: g, ebitdaMargin: Number(a.ebitda_margin), daPct: Number(a.da_pct ?? 0.04), capexPct: Number(a.capex_pct ?? 0.05), nwcPct: Number(a.nwc_pct ?? 0.1), taxRate: Number(a.tax_rate ?? 0.25), wacc: Number(a.wacc), terminalGrowth: Number(a.terminal_growth), terminalMethod: "gordon" as const, netDebt: Number(a.net_debt ?? 0), shares: Number(a.shares ?? 0) };
      const r = dcf(input);
      const rec = calcRecord("DCF valuation", "EV = Σ FCF_t/(1+WACC)^t + TV/(1+WACC)^n; TV = FCF_n(1+g)/(WACC−g); Equity = EV − net debt", input, { enterpriseValue: r.ev.toFixed(2), equityValue: r.equity.toFixed(2), perShare: r.perShare?.toFixed(2) ?? "n/a (shares not provided)", terminalValueShareOfEV: r.tvShare === null ? null : `${(r.tvShare * 100).toFixed(1)}%`, warnings: r.errors, fcfByYear: r.rows.map((x) => ({ year: x.year, fcf: x.fcf.toFixed(2) })) }, ["Defaults used where not given: D&A 4%, capex 5%, NWC 10% of Δrevenue, tax 25%."], "FINVANTA valuation engine");
      await logCalc(ctx, rec); return { source: "calc_dcf", result: rec.result, calc: rec };
    }
    case "search_documents": {
      const q = String(a.query ?? "").slice(0, 100);
      const rows = await db.select({ id: documents.id, name: documents.name, docType: documents.docType, text: documents.extractedText }).from(documents)
        .where(and(eq(documents.companyId, ctx.company.id), isNull(documents.deletedAt), ilike(documents.extractedText, `%${q.replace(/[%_]/g, "")}%`))).orderBy(desc(documents.createdAt)).limit(5);
      return { source: "documents", result: rows.map((r) => { const i = (r.text ?? "").toLowerCase().indexOf(q.toLowerCase()); return { document: r.name, type: r.docType, snippet: (r.text ?? "").slice(Math.max(0, i - 150), i + 250) }; }) };
    }
    case "get_market_quote": {
      const q = await getQuote(String(a.symbol));
      return { source: q.quote ? `market:${q.quote.provider}:${q.quote.asOf}` : "market:unavailable", result: q };
    }
    case "search_indian_stocks": {
      const result = await searchIndianStocks(String(a.query ?? ""));
      return { source: `indian-market:${result.provider}${"fetchedAt" in result ? `:${result.fetchedAt}` : ""}`, result };
    }
    case "get_indian_stock": {
      const result = await getIndianStock(String(a.symbol ?? ""));
      return { source: result.stock ? `indian-market:${result.provider}:${result.stock.lastUpdate ?? result.stock.fetchedAt}` : "indian-market:unavailable", result };
    }
    case "compare_indian_stocks": {
      const symbols = Array.isArray(a.symbols) ? a.symbols.filter((symbol): symbol is string => typeof symbol === "string").slice(0, 10) : [];
      const result = await getIndianStockList(symbols);
      return { source: `indian-market:${result.provider}${"fetchedAt" in result ? `:${result.fetchedAt}` : ""}`, result };
    }
    case "propose_journal_entry": {
      const codes = (a.lines as { account_code: string }[]).map((l) => l.account_code);
      const accs = await db.select().from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt)));
      const missing = codes.filter((c) => !accs.some((x) => x.code === c));
      if (missing.length) return { source: "propose_journal_entry", result: { error: `Unknown account codes: ${missing.join(", ")}. Valid codes: ${accs.map((x) => `${x.code} ${x.name}`).join("; ")}` } };
      const lines = (a.lines as { account_code: string; debit: number; credit: number }[]).map((l) => ({ accountId: accs.find((x) => x.code === l.account_code)!.id, debit: r2(l.debit).toFixed(2), credit: r2(l.credit).toFixed(2), code: l.account_code, name: accs.find((x) => x.code === l.account_code)!.name }));
      const v = validateVoucher(lines);
      if (!v.ok) return { source: "propose_journal_entry", result: { error: v.errors.join(" ") } };
      const [p] = await db.insert(aiProposals).values({ orgId: ctx.org.id, companyId: ctx.company.id, conversationId, kind: "journal_entry", payload: { date: a.date, narration: a.narration, lines } }).returning();
      return { source: "propose_journal_entry", result: { proposalId: p.id, status: "PENDING_USER_APPROVAL — nothing has been posted", totalDebit: v.totalDebit } };
    }
  }
  return { source: name, result: { error: "Unknown tool" } };
}
