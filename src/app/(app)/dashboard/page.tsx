import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, budgets, notifications, accounts, vouchers } from "@/db/schema";
import { requireCompany } from "@/lib/ctx";
import { ageing, loadStatements, monthlySeries, stmtFromLedger } from "@/services/finance";
import { computeRatios } from "@/engines/ratios";
import { healthScore, linearForecast, redFlags } from "@/engines/insights";
import { Badge, Card, Empty, PageHeader, Stat, compact, inr, pct } from "@/components/ui";
import { BarsChart, LinesChart } from "@/components/Charts";
import DashboardGrid from "@/components/DashboardGrid";
import ExportMenu from "@/components/ExportMenu";
import { notify } from "@/lib/audit";
import { loadDemoData } from "@/actions/accounting";
import { D } from "@/engines/core";

export const metadata = { title: "Executive Dashboard" };

export default async function Dashboard() {
  const ctx = await requireCompany();
  const s = await loadStatements(ctx);
  const months = await monthlySeries(ctx);
  const [ar, ap] = await Promise.all([ageing(ctx, "sales", new Date().toISOString().slice(0, 10)), ageing(ctx, "purchase", new Date().toISOString().slice(0, 10))]);
  const hasData = s.bals.some((b) => D(b.dr).gt(0) || D(b.cr).gt(0) || !D(b.prior).isZero());
  const st = stmtFromLedger(s);
  const rt = Object.fromEntries(computeRatios(st).map((r) => [r.key, r.value]));
  const health = healthScore(st);
  const flags = redFlags(st);
  const arTotal = ar.reduce((a, r) => a + r.total, 0), apTotal = ap.reduce((a, r) => a + r.total, 0);
  const n = (d: { toNumber(): number }) => d.toNumber();
  const wc = n(s.bs.currentAssets.minus(s.bs.currentLiabilities));
  const [prefs] = [ctx.prefs];

  // Budget vs actual by month (approved budgets only)
  const [bud] = await db.select().from(budgets).where(and(eq(budgets.companyId, ctx.company.id), eq(budgets.fyId, ctx.fy.id), eq(budgets.status, "approved"), isNull(budgets.deletedAt))).orderBy(desc(budgets.createdAt)).limit(1);
  let budMonthly: { label: string; budgetRevenue: number; actualRevenue: number; budgetExpense: number; actualExpense: number }[] = [];
  if (bud) {
    const lines = await db.select({ amounts: budgetLines.amounts, type: accounts.type }).from(budgetLines).innerJoin(accounts, eq(accounts.id, budgetLines.accountId)).where(eq(budgetLines.budgetId, bud.id));
    budMonthly = months.map((m, i) => ({ label: m.label, actualRevenue: m.revenue, actualExpense: m.expense, budgetRevenue: lines.filter((l) => l.type === "income").reduce((a, l) => a + Number(l.amounts[i] ?? 0), 0), budgetExpense: lines.filter((l) => l.type === "expense").reduce((a, l) => a + Number(l.amounts[i] ?? 0), 0) }));
  }

  // Cash forecast: linear trend of monthly operating surplus (profit + depreciation), indicative only
  const active = months.filter((m) => m.revenue || m.expense);
  const surplus = active.map((m) => m.profit);
  const fc = active.length >= 3 ? linearForecast(surplus, 6) : [];
  const forecast = fc.map((_, i) => ({
    label: `+${i + 1}m`,
    cash: Math.round(n(s.bs.cash) + fc.slice(0, i + 1).reduce((total, value) => total + value, 0)),
  }));
  const growth = active.length >= 2 && active[active.length - 2].revenue > 0 ? (active[active.length - 1].revenue - active[active.length - 2].revenue) / active[active.length - 2].revenue : null;

  // KPI alerts → notification centre (deduplicated per day)
  const alertsNow: [string, string, "warning" | "critical"][] = [];
  if (hasData) {
    if (rt.cr !== null && (rt.cr as number) < 1) alertsNow.push(["Current ratio below 1.0", `Current ratio is ${(rt.cr as number).toFixed(2)}`, "critical"]);
    if (n(s.bs.cash) < 0) alertsNow.push(["Negative cash balance", "Cash & bank ledgers are overdrawn", "critical"]);
    if (!s.tb.balanced) alertsNow.push(["Trial balance out of balance", `Difference ${s.tb.difference.toFixed(2)}`, "critical"]);
    if (n(s.pl.netProfit) < 0) alertsNow.push(["Net loss year-to-date", `Net result ${inr(n(s.pl.netProfit))}`, "warning"]);
    const over90 = ar.reduce((a, r) => a + r.buckets["90+"], 0);
    if (over90 > 0) alertsNow.push(["Receivables over 90 days", `${inr(over90)} is more than 90 days past due`, "warning"]);
  }
  const recent = await db.select({ t: notifications.title }).from(notifications).where(and(eq(notifications.orgId, ctx.org.id), sql`${notifications.createdAt} >= now() - interval '1 day'`));
  for (const [t, b, l] of alertsNow) if (!recent.some((r) => r.t === t)) await notify(ctx.org.id, t, b, l, "/dashboard");
  const recentV = await db.select().from(vouchers).where(and(eq(vouchers.companyId, ctx.company.id), isNull(vouchers.deletedAt))).orderBy(desc(vouchers.createdAt)).limit(6);

  const cur = ctx.company.baseCurrency;
  const tone = (v: number) => (v < 0 ? "down" : undefined) as "down" | undefined;
  const k = (id: string, label: string, value: string, sub?: string, href = "/accounting?tab=reports&r=profit-loss", t?: "up" | "down" | "warn") => (
    <Link key={id} href={href} className="block min-h-[104px] transition-transform hover:-translate-y-0.5"><Stat label={label} value={value} sub={sub} tone={t} /></Link>
  );

  const widgets = [
    { id: "kpis", title: "Key financials", span: 2 as const, node: !hasData ? (
      <Empty title="No ledger activity yet" action={<div className="flex gap-2"><Link className="btn btn-primary" href="/accounting?tab=new">Post first voucher</Link><form action={loadDemoData}><button className="btn">Load labelled demo data</button></form></div>}>Post vouchers or load clearly-labelled demo data to see live KPIs computed from your ledger.</Empty>
    ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {k("rev", "Total revenue", `${compact(n(s.pl.revenue))}`, cur, undefined, "up")}
        {k("gp", "Gross profit", compact(n(s.pl.grossProfit)), `Margin ${pct(rt.gpm as number)}`)}
        {k("op", "Operating profit", compact(n(s.pl.ebit)), `Margin ${pct(rt.opm as number)}`)}
        {k("ebitda", "EBITDA", compact(n(s.pl.ebitda)), `Margin ${pct(rt.ebitdam as number)}`)}
        {k("np", "Net profit", compact(n(s.pl.netProfit)), `Margin ${pct(rt.npm as number)}`, undefined, n(s.pl.netProfit) < 0 ? "down" : "up")}
        {k("cash", "Cash & equivalents", compact(n(s.bs.cash)), "Cash + bank ledgers", "/accounting?tab=books&b=bank-book", n(s.bs.cash) < 0 ? "down" : undefined)}
        {k("wc", "Working capital", compact(wc), `Current ratio ${(rt.cr as number)?.toFixed(2) ?? "—"}`, "/accounting?tab=reports&r=balance-sheet", tone(wc))}
        {k("growth", "Revenue growth (MoM)", growth === null ? "—" : pct(growth), "Latest vs previous month", undefined, growth !== null && growth < 0 ? "down" : "up")}
        {k("ar", "Accounts receivable", compact(arTotal), "Open invoices", "/receivables")}
        {k("ap", "Accounts payable", compact(apTotal), "Open bills", "/payables")}
        {k("ta", "Total assets", compact(n(s.bs.totalAssets)), "Balance sheet", "/accounting?tab=reports&r=balance-sheet")}
        {k("tl", "Total liabilities", compact(n(s.bs.totalLiabilities)), `Equity ${compact(n(s.bs.equity))}`, "/accounting?tab=reports&r=balance-sheet")}
        {k("de", "Debt-to-equity", rt.de === null ? "—" : (rt.de as number).toFixed(2) + "x", `Debt ${compact(n(s.bs.debt))}`, "/analysis")}
        {k("nm", "Net margin", pct(rt.npm as number), "Net profit ÷ revenue", "/analysis")}
      </div>
    ) },
    { id: "health", title: "Financial health score", span: 1 as const, node: (
      <div>
        <div className="flex items-end gap-3"><div className="num text-5xl font-bold text-accent">{health.score ?? "—"}</div><div className="pb-1.5"><Badge tone={health.label === "Strong" ? "up" : health.label === "At risk" ? "down" : "warn"}>{health.label}</Badge><div className="text-[11px] text-muted">out of 100</div></div></div>
        <ul className="mt-3 space-y-1.5">{health.parts.map((p) => (
          <li key={p.name} className="text-xs"><div className="flex justify-between"><span>{p.name} <span className="text-muted">· {p.detail}</span></span><span className="num">{p.score === null ? "n/a" : Math.round(p.score * 100)}</span></div><div className="mt-0.5 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-accent" style={{ width: `${(p.score ?? 0) * 100}%` }} /></div></li>))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">Transparent weighted score from ledger ratios (profitability 25, liquidity 25, leverage 20, coverage 15, efficiency 15). Decision support only.</p>
      </div>) },
    { id: "alerts", title: "KPI alerts & red flags", span: 1 as const, node: flags.length === 0 && alertsNow.length === 0 ? <p className="text-sm text-muted">{hasData ? "✓ No threshold breaches or red flags detected." : "Alerts appear once the ledger has activity."}</p> : (
      <ul className="space-y-2">{[...alertsNow.map(([t, b, l]) => ({ t, b, sev: l === "critical" ? "high" : "medium" })), ...flags.map((f) => ({ t: f.message, b: f.evidence, sev: f.severity }))].slice(0, 7).map((a, i) => (
        <li key={i} className="flex gap-2 text-xs"><Badge tone={a.sev === "high" ? "down" : a.sev === "medium" ? "warn" : "neutral"}>{a.sev}</Badge><span><b>{a.t}</b><br /><span className="text-muted">{a.b}</span></span></li>))}</ul>) },
    { id: "perf", title: "Monthly performance", span: 2 as const, node: <><BarsChart data={months.map((m) => ({ label: m.label, Revenue: Math.round(m.revenue), Expenses: Math.round(m.expense) }))} x="label" series={[{ key: "Revenue" }, { key: "Expenses", color: "#94a3b8" }]} /><LinesChart height={140} data={months.map((m) => ({ label: m.label, "Net result": Math.round(m.profit) }))} x="label" series={[{ key: "Net result", color: "#14b8a6" }]} area /></> },
    { id: "budget", title: "Budget vs actual", span: 1 as const, node: bud ? <><BarsChart height={240} data={budMonthly.map((m) => ({ label: m.label, "Budget revenue": m.budgetRevenue, "Actual revenue": Math.round(m.actualRevenue) }))} x="label" series={[{ key: "Budget revenue", color: "#94a3b8" }, { key: "Actual revenue" }]} /><p className="mt-1 text-[11px] text-muted">Approved budget: {bud.name}. <Link className="text-accent" href="/fpna">Variance analysis →</Link></p></> : <Empty title="No approved budget">Create and approve a budget in <Link className="text-accent" href="/fpna">FP&A</Link> to compare against actuals.</Empty> },
    { id: "cashfc", title: "Cash-flow forecast (indicative)", span: 1 as const, node: forecast.length ? <><LinesChart height={240} area data={[{ label: "Now", cash: Math.round(n(s.bs.cash)) }, ...forecast]} x="label" series={[{ key: "cash", name: "Projected cash & bank" }]} /><p className="mt-1 text-[11px] text-muted">Linear trend of monthly operating surplus over {active.length} active months. Not a budget; ignores seasonality, receivable timing and financing. See <Link className="text-accent" href="/insights">Stress tests</Link>.</p></> : <Empty title="Not enough history">At least 3 months of activity are needed for a trend forecast.</Empty> },
    { id: "ageing", title: "Working-capital snapshot", span: 1 as const, node: (
      <table className="tbl"><thead><tr><th>Bucket</th><th className="r">Receivables</th><th className="r">Payables</th></tr></thead><tbody>
        {(["Not due", "1-30", "31-60", "61-90", "90+"] as const).map((b) => <tr key={b}><td>{b}</td><td className="r num">{inr(ar.reduce((a, r) => a + r.buckets[b], 0))}</td><td className="r num">{inr(ap.reduce((a, r) => a + r.buckets[b], 0))}</td></tr>)}
        <tr className="font-semibold"><td>Total</td><td className="r num">{inr(arTotal)}</td><td className="r num">{inr(apTotal)}</td></tr></tbody></table>) },
    { id: "recent", title: "Recent activity", span: 1 as const, node: recentV.length === 0 ? <p className="text-sm text-muted">No vouchers posted yet.</p> : <ul className="space-y-1.5 text-xs">{recentV.map((v) => <li key={v.id} className="flex justify-between gap-2"><Link className="text-accent hover:underline" href={`/accounting?tab=vouchers&q=${v.number}`}>{v.number}</Link><span className="truncate text-muted">{v.narration}</span><span className="num text-muted">{v.date}</span></li>)}</ul> },
  ];

  return (
    <>
      <PageHeader title="Executive Dashboard" desc={<>{ctx.company.name} · {ctx.fy.label} · figures computed live from the ledger. {!s.tb.balanced && <Badge tone="down">Trial balance out of balance</Badge>}</>}
        actions={<><ExportMenu report="profit-loss" /><ExportMenu report="balance-sheet" formats={["xlsx"]} /></>} />
      <DashboardGrid widgets={widgets} initial={prefs?.dashboardLayout ?? null} />
    </>
  );
}
