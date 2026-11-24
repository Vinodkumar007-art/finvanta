import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, budgets, kpis } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Badge, Card, Notice, PageHeader, Stat, Tabs, inr } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExportMenu from "@/components/ExportMenu";
import ActionForm from "@/components/ActionForm";
import PrintButton from "@/components/PrintButton";
import { BarsChart, LinesChart } from "@/components/Charts";
import { BudgetBuilder, Headcount, ScenarioPlanner } from "@/components/FpnaClient";
import { buildReport } from "@/services/reports";
import { loadStatements, monthlySeries } from "@/services/finance";
import { budgetWorkflow, deleteKpi, saveKpi } from "@/actions/analytics";
import { evalFormula, linearForecast, movingAverageForecast } from "@/engines/insights";

export const metadata = { title: "Budgeting & FP&A" };
const TABS = [["budgets", "Budgets & approvals"], ["variance", "Budget vs actual"], ["forecast", "Rolling forecast"], ["headcount", "Headcount"], ["kpi", "KPI tracking"], ["scenario", "Scenarios"], ["report", "Management report"]].map(([id, label]) => ({ id, label }));

export default async function Fpna({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const tab = sp.tab ?? "budgets"; const canWrite = can(ctx.role, "write"), canApprove = can(ctx.role, "approve");
  const bs = await db.select().from(budgets).where(and(eq(budgets.companyId, ctx.company.id), isNull(budgets.deletedAt))).orderBy(desc(budgets.createdAt));
  let body: React.ReactNode = null;
  if (tab === "budgets") {
    const accs = await db.select().from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt), ...[])).orderBy(asc(accounts.code));
    const start = new Date(ctx.fy.startDate + "T00:00:00Z"); const ml = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" }));
    body = (<div className="space-y-4"><Card title="Budget register & approval workflow" subtitle="Draft → Submitted → Approved/Rejected. Approvals are audit-logged; self-approval is flagged." pad={false}><div className="p-3"><table className="tbl"><thead><tr><th>Name</th><th>Type</th><th>Status</th><th /></tr></thead><tbody>{bs.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No budgets yet — create one below.</td></tr>}{bs.map((b) => <tr key={b.id}><td className="font-medium">{b.name}</td><td>{b.kind}{b.department ? ` · ${b.department}` : ""}</td><td><Badge tone={b.status === "approved" ? "up" : b.status === "rejected" ? "down" : b.status === "submitted" ? "warn" : "neutral"}>{b.status}</Badge></td>
      <td className="flex gap-1"><a className="btn btn-sm" href={`?tab=variance&budget=${b.id}`}>Variance</a>{canWrite && ["draft", "rejected"].includes(b.status) && <form action={budgetWorkflow.bind(null, b.id, "submitted")}><button className="btn btn-sm">Submit</button></form>}{canApprove && b.status === "submitted" && <><form action={budgetWorkflow.bind(null, b.id, "approved")}><button className="btn btn-sm btn-primary">Approve</button></form><form action={budgetWorkflow.bind(null, b.id, "rejected")}><button className="btn btn-sm">Reject</button></form></>}</td></tr>)}</tbody></table></div></Card>
      {canWrite && <Card title={`Create budget for ${ctx.fy.label}`} subtitle="Monthly by ledger (income and expense accounts)."><BudgetBuilder monthLabels={ml} accounts={accs.filter((a) => ["income", "expense"].includes(a.type)).map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))} /></Card>}</div>);
  } else if (tab === "variance") {
    const r = await buildReport(ctx, "budget-vs-actual", sp.budget ? { budget: sp.budget } : {});
    body = (<Card title={r?.title ?? "Budget vs actual"} subtitle={r?.subtitle} action={<ExportMenu report="budget-vs-actual" params={sp.budget ? { budget: sp.budget } : {}} />} pad={false}><div className="p-3">{r && r.rows.length ? (<><BarsChart height={220} data={r.rows.map((x) => ({ a: String(x.account).slice(0, 18), Budget: Number(x.budget), Actual: Number(x.actual) }))} x="a" series={[{ key: "Budget", color: "#94a3b8" }, { key: "Actual" }]} /><div className="mt-3"><DataTable title="variance" columns={r.columns} rows={r.rows} searchable={false} /></div><p className="mt-2 text-[11px] text-muted">Variance = actual − budget (YTD actual vs full-year budget). Favourable: income above / expense below budget.</p></>) : <p className="py-8 text-center text-sm text-muted">No budget for this year — create one under Budgets.</p>}</div></Card>);
  } else if (tab === "forecast") {
    const m = await monthlySeries(ctx); const act = m.filter((x) => x.revenue || x.expense); const rem = 12 - act.length;
    const method = sp.method ?? "linear"; const fn = method === "ma" ? movingAverageForecast : (y: number[], a: number) => linearForecast(y, a);
    const fr = act.length >= 3 && rem > 0 ? fn(act.map((x) => x.revenue), rem).map((v) => Math.max(0, v)) : []; const fe = act.length >= 3 && rem > 0 ? fn(act.map((x) => x.expense), rem).map((v) => Math.max(0, v)) : [];
    const data = m.map((x, i) => { const j = i - act.length; return { label: x.label, "Actual revenue": i < act.length ? Math.round(x.revenue) : null, "Forecast revenue": j >= 0 ? Math.round(fr[j] ?? 0) : null, "Actual expense": i < act.length ? Math.round(x.expense) : null, "Forecast expense": j >= 0 ? Math.round(fe[j] ?? 0) : null }; });
    body = (<Card title="Rolling forecast — actuals + statistical projection" action={<span className="flex gap-1"><a className={`btn btn-sm ${method === "linear" ? "btn-primary" : ""}`} href="?tab=forecast&method=linear">Linear trend</a><a className={`btn btn-sm ${method === "ma" ? "btn-primary" : ""}`} href="?tab=forecast&method=ma">3-mo moving avg</a></span>}>
      {fr.length === 0 ? <p className="py-8 text-center text-sm text-muted">Needs ≥3 months of actuals and remaining months in the year.</p> : <><LinesChart height={280} data={data as never} x="label" series={[{ key: "Actual revenue" }, { key: "Forecast revenue", color: "#14b8a6" }, { key: "Actual expense", color: "#94a3b8" }, { key: "Forecast expense", color: "#fbbf24" }]} />
        <p className="mt-2 text-xs text-muted">Full-year outlook — revenue {inr(act.reduce((s, x) => s + x.revenue, 0) + fr.reduce((a, b) => a + b, 0))}, expenses {inr(act.reduce((s, x) => s + x.expense, 0) + fe.reduce((a, b) => a + b, 0))}. Statistical projection only (no seasonality, pipeline or one-offs); adjust with scenario planning.</p></>}</Card>);
  } else if (tab === "headcount") {
    body = <Card title="Headcount & payroll plan"><Headcount canWrite={canWrite} /></Card>;
  } else if (tab === "kpi") {
    const s = await loadStatements(ctx); const n = (d: { toNumber(): number }) => d.toNumber();
    const vars: Record<string, number> = { revenue: n(s.pl.revenue), cogs: n(s.pl.cogs), gross_profit: n(s.pl.grossProfit), opex: n(s.pl.opex), ebitda: n(s.pl.ebitda), ebit: n(s.pl.ebit), net_profit: n(s.pl.netProfit), interest: n(s.pl.interest), cash: n(s.bs.cash), receivables: n(s.bs.receivables), payables: n(s.bs.payables), inventory: n(s.bs.inventory), total_assets: n(s.bs.totalAssets), equity: n(s.bs.equity), debt: n(s.bs.debt), current_assets: n(s.bs.currentAssets), current_liabilities: n(s.bs.currentLiabilities) };
    const ks = await db.select().from(kpis).where(eq(kpis.companyId, ctx.company.id));
    body = (<div className="grid gap-4 lg:grid-cols-3"><div className="space-y-3 lg:col-span-2">{ks.length === 0 && <Notice>No KPIs yet. Define one with a formula over ledger variables.</Notice>}{ks.map((k) => { const r = evalFormula(k.formula, vars); const t = k.target === null ? null : Number(k.target); const ok = r.value === null || t === null ? null : k.direction === "higher" ? r.value >= t : r.value <= t; return (<div key={k.id} className="flex items-center justify-between rounded-xl border border-line bg-panel p-4"><div><div className="text-sm font-semibold">{k.name}</div><div className="num text-[11px] text-muted">{k.formula}</div></div><div className="text-right"><div className={`num text-xl font-bold ${ok === null ? "" : ok ? "text-up" : "text-down"}`}>{r.value === null ? "—" : r.value.toFixed(2)}{k.unit}</div><div className="text-[11px] text-muted">{r.error ?? (t === null ? "no target" : `target ${k.direction === "higher" ? "≥" : "≤"} ${t}${k.unit}`)}</div>{canWrite && <form action={deleteKpi.bind(null, k.id)}><button className="text-[11px] text-muted hover:text-down">remove</button></form>}</div></div>); })}</div>
      {canWrite && <Card title="Custom KPI builder" subtitle={`Variables: ${Object.keys(vars).join(", ")}. Operators + − × ÷ ( ).`}><ActionForm submit="Save KPI" action={saveKpi} fields={[{ name: "name", label: "KPI name", required: true, span: 2 }, { name: "formula", label: "Formula", required: true, span: 2, placeholder: "(revenue - cogs) / revenue * 100" }, { name: "target", label: "Target", type: "number" }, { name: "unit", label: "Unit", placeholder: "%" }, { name: "direction", label: "Better when", type: "select", options: [["higher", "Higher"], ["lower", "Lower"]], span: 2 }]} /></Card>}</div>);
  } else if (tab === "scenario") {
    const s = await loadStatements(ctx); const m = await monthlySeries(ctx); const act = m.filter((x) => x.revenue || x.expense).length;
    body = <Card title="Scenario planning (what-if)"><ScenarioPlanner revenue={s.pl.revenue.toNumber()} expenses={s.pl.cogs.plus(s.pl.opex).toNumber()} months={act} /></Card>;
  } else {
    const s = await loadStatements(ctx); const m = await monthlySeries(ctx); const f = (d: { toNumber(): number }) => inr(d.toNumber());
    body = (<Card title={`Management report — ${ctx.company.name}, ${ctx.fy.label}`} action={<span className="flex gap-2"><ExportMenu report="profit-loss" /><ExportMenu report="balance-sheet" formats={["pdf"]} /><PrintButton /></span>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Revenue" value={f(s.pl.revenue)} /><Stat label="EBITDA" value={f(s.pl.ebitda)} /><Stat label="Net profit" value={f(s.pl.netProfit)} tone={s.pl.netProfit.lt(0) ? "down" : "up"} /><Stat label="Cash" value={f(s.bs.cash)} /></div>
      <div className="mt-4"><BarsChart height={220} data={m.map((x) => ({ l: x.label, Revenue: Math.round(x.revenue), Expenses: Math.round(x.expense) }))} x="l" series={[{ key: "Revenue" }, { key: "Expenses", color: "#94a3b8" }]} /></div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm"><li>Gross margin {s.pl.revenue.isZero() ? "—" : s.pl.grossProfit.div(s.pl.revenue).mul(100).toFixed(1)}%, net margin {s.pl.revenue.isZero() ? "—" : s.pl.netProfit.div(s.pl.revenue).mul(100).toFixed(1)}%.</li><li>Trial balance {s.tb.balanced ? "balances" : "does NOT balance"}; cash-flow {s.cf.reconciled ? "reconciles" : "does not reconcile"} to cash.</li><li>Working capital {f(s.bs.currentAssets.minus(s.bs.currentLiabilities))}; debt {f(s.bs.debt)}.</li></ul></Card>);
  }
  return (<><PageHeader title="Budgeting & FP&A" desc="Budgets with approval workflow, variance analysis, rolling forecasts, headcount planning and KPI tracking." crumbs={[{ label: "Analysis & Planning" }, { label: "FP&A" }]} /><Tabs tabs={TABS} active={tab} base="/fpna" />{body}</>);
}
