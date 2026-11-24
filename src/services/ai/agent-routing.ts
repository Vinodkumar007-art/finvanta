import type { AgentId } from "@/services/ai/agents";

const routes: { agent: AgentId; pattern: RegExp }[] = [
  { agent: "tax", pattern: /\b(gst|gstr|tds|income tax|tax return|tax filing)\b/i },
  { agent: "indian-equity", pattern: /\b(nse|bse|nifty|sensex|indian stocks?)\b/i },
  { agent: "equity", pattern: /\b(stocks?|shares?|equity research|p\/e|ev\/ebitda)\b/i },
  { agent: "banker", pattern: /\b(dcf|valuation|enterprise value|terminal value|cost of capital)\b/i },
  { agent: "portfolio", pattern: /\b(portfolio|sharpe|sortino|xirr|cagr|rebalanc\w*)\b/i },
  { agent: "credit", pattern: /\b(credit|loan|emi|debt service|debt capacity|altman)\b/i },
  { agent: "fpna", pattern: /\b(budget|forecast|variance|fp&a|cash flow forecast)\b/i },
  { agent: "accountant", pattern: /\b(journal entr\w*|ledger|voucher|trial balance|bookkeep\w*|credit note)\b/i },
  { agent: "data", pattern: /\b(excel|spreadsheet|csv|sql|dax|power bi)\b/i },
  { agent: "cfo", pattern: /\b(cfo|executive briefing|financial health|cash position|cash runway|financial risks?)\b/i },
  { agent: "analyst", pattern: /\b(analyst|analysis|analy[sz]e|ratios?|financial statements?|du ?pont|profitability|margin analysis)\b/i },
];

export function routeAgentForPrompt(prompt: string): AgentId {
  return routes.find(({ pattern }) => pattern.test(prompt))?.agent ?? "general";
}
