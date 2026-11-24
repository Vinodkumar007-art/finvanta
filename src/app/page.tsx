import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { getCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

const MODULES = [
  ["Accounting", "Double-entry vouchers, ledgers, trial balance, P&L, balance sheet, cash flow, period locks & audit trail."],
  ["GST · TDS · Income Tax", "CGST/SGST/IGST, ITC set-off, GSTR-3B draft, 2B reconciliation, TDS engine, regime comparison, capital gains."],
  ["Statement Analysis", "30 ratios with formulas, common-size, trends, Altman Z and Piotroski F."],
  ["Modelling & Valuation", "DCF, WACC, DDM, LBO, comps, three-statement projections with balance checks, sensitivity & Excel export."],
  ["Markets & Charting", "Provider-based quotes, screener, watchlists, alerts; 11 indicators, drawing tools, multi-chart layouts."],
  ["Portfolios", "FIFO cost basis, realised/unrealised P&L, XIRR, CAGR, Sharpe, Sortino, drawdown, rebalancing, paper trading."],
  ["FP&A · Credit · MIS", "Budgets with approval workflow, variance, runway, credit scorecards, EMI, pivots and BI exports."],
  ["AR · AP · Banking", "GST invoices with PDF, ageing, receipts, CSV bank import, duplicate detection & reconciliation."],
  ["Document Intelligence", "Upload, classify, extract and validate — posts to books only after human confirmation."],
  ["FINVANTA AI", "Ten specialist agents with tool-calling, citations, streaming, and approval-gated actions."],
];

export default async function Landing() {
  const ctx = await getCtx();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Wordmark size={30} />
        <nav className="flex items-center gap-2 text-sm">
          {ctx ? <Link className="btn btn-primary" href="/dashboard">Open dashboard</Link> : (<><Link className="btn" href="/login">Sign in</Link><Link className="btn btn-primary" href="/signup">Start free</Link></>)}
        </nav>
      </header>
      <section className="grid-bg border-y border-line">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent">Financial intelligence ecosystem</span>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">One platform. <span className="bg-gradient-to-r from-teal to-accent bg-clip-text text-transparent">Every financial workflow.</span> One intelligent assistant.</h1>
          <p className="mt-5 max-w-2xl text-base text-muted">From bookkeeping and GST to DCF and portfolio risk — FINVANTA gives accountants, CFOs, analysts and investors a single, auditable workspace where every number shows its inputs, formula and source.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/signup" className="btn btn-primary !px-5 !py-2.5 !text-sm">Create your workspace</Link><Link href="/login" className="btn !px-5 !py-2.5 !text-sm">Sign in</Link></div>
          <dl className="mt-12 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[["Decimal-safe", "ledger arithmetic"], ["49+", "engine unit tests"], ["Org-isolated", "multi-tenant data"], ["Approval-gated", "AI & postings"]].map(([a, b]) => (
              <div key={a} className="rounded-xl border border-line bg-panel/70 p-3"><dt className="num text-lg font-semibold text-accent">{a}</dt><dd className="text-[11px] text-muted">{b}</dd></div>))}
          </dl>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-2xl font-semibold tracking-tight">Built module by module — each with its own workflow</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(([t, d]) => (<div key={t} className="rounded-xl border border-line bg-panel p-4 transition-colors hover:border-accent/60"><h3 className="text-sm font-semibold">{t}</h3><p className="mt-1.5 text-xs leading-relaxed text-muted">{d}</p></div>))}
        </div>
      </section>
      <section className="border-t border-line bg-bg2">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-12 md:grid-cols-3">
          {[["Honest by design", "Demo, delayed and unavailable data is always labelled. Missing integrations are shown as not configured — never faked."], ["Calculations ≠ filings", "GST, TDS and ITR outputs are calculations and draft data. Nothing is ever reported as filed without an authorised integration."], ["AI that can’t invent numbers", "The assistant calls deterministic engines, cites its tools, and can only draft — you approve every posting."]].map(([t, d]) => (
            <div key={t}><h3 className="text-sm font-semibold text-accent">{t}</h3><p className="mt-1.5 text-sm text-muted">{d}</p></div>))}
        </div>
      </section>
      <footer className="border-t border-line px-5 py-6 text-center text-[11px] text-muted">© FINVANTA · Created by Vinod Kumar · Analytical tools are not investment, tax or legal advice.</footer>
    </div>
  );
}
