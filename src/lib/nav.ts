export type NavItem = { href: string; label: string; keywords?: string };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Command", items: [
    { href: "/dashboard", label: "Executive Dashboard", keywords: "kpi home overview" },
    { href: "/operations", label: "Operations Hub", keywords: "back office workflow approvals documents automation" },
    { href: "/ai", label: "FINVANTA AI", keywords: "assistant chat agent cfo" },
    { href: "/insights", label: "Intelligence Lab", keywords: "red flags health score stress anomaly briefing survival" },
  ] },
  { group: "Accounting & Compliance", items: [
    { href: "/accounting", label: "Accounting", keywords: "voucher ledger trial balance journal books" },
    { href: "/tax", label: "GST, TDS & Income Tax", keywords: "gstr tds itr tax compliance" },
    { href: "/receivables", label: "Receivables (AR)", keywords: "customers sales invoices ageing" },
    { href: "/payables", label: "Payables (AP)", keywords: "vendors bills ageing" },
    { href: "/imports", label: "Data Imports", keywords: "csv excel upload parties inventory invoices" },
    { href: "/banking", label: "Banking & Reconciliation", keywords: "bank statement reconcile" },
    { href: "/documents", label: "Document Intelligence", keywords: "ocr upload invoice extract" },
  ] },
  { group: "Analysis & Planning", items: [
    { href: "/analysis", label: "Statement Analysis", keywords: "ratios common size altman piotroski" },
    { href: "/modelling", label: "Modelling & Valuation", keywords: "dcf wacc lbo ddm three statement" },
    { href: "/fpna", label: "Budgeting & FP&A", keywords: "budget variance forecast headcount" },
    { href: "/credit", label: "Credit & Risk", keywords: "emi dscr loan memo" },
    { href: "/mis", label: "MIS & BI Studio", keywords: "pivot kpi export power bi" },
  ] },
  { group: "Markets & Investing", items: [
    { href: "/markets", label: "Market Terminal", keywords: "equity screener watchlist indices" },
    { href: "/charts", label: "Charting", keywords: "technical rsi macd candlestick" },
    { href: "/portfolio", label: "Portfolios", keywords: "holdings xirr paper trading" },
  ] },
  { group: "Workspace", items: [
    { href: "/screensaver", label: "Ambient Screensaver", keywords: "fullscreen ambient motion display idle" },
    { href: "/workbench", label: "Personal Finance & Learning", keywords: "sip goal retirement learn report consolidated" },
    { href: "/settings", label: "Settings & Security", keywords: "profile mfa theme members" },
    { href: "/usage", label: "Plan & AI Usage", keywords: "subscription tokens" },
  ] },
];
