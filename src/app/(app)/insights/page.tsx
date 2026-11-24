import Link from "next/link";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { accounts, voucherLines, vouchers, companies, financialYears } from "@/db/schema";
import { requireCompany } from "@/lib/ctx";
import { Badge, Card, Notice, PageHeader, Tabs, compact, inr, pct } from "@/components/ui";
import DataTable from "@/components/DataTable";
import StressLab from "@/components/StressLab";
import PrintButton from "@/components/PrintButton";
import { BarsChart } from "@/components/Charts";
import { ageing, getBalances, loadStatements, monthlySeries, stmtFromLedger } from "@/services/finance";
import { benford, detectAnomalies, earningsQuality, healthScore, redFlags, workingCapitalIntel } from "@/engines/insights";
import { balanceSheet, profitAndLoss } from "@/engines/accounting";
import { computeRatios } from "@/engines/ratios";
import { D } from "@/engines/core";

export const metadata = { title: "Intelligence Lab" };
const TABS = [["briefing", "CFO briefing"], ["flags", "Red flags & quality"], ["stress", "Stress & survival"], ["anomaly", "Anomalies & heatmap"], ["consol", "Consolidated"]].map(([id, label]) => ({ id, label }));

export default async function Insights({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const tab = sp.tab ?? "briefing";
  const s = await loadStatements(ctx); const st = stmtFromLedger(s); const n = (d: { toNumber(): number }) => d.toNumber();
  const hasData = (st.revenue ?? 0) > 0; const health = healthScore(st); const flags = redFlags(st); const eq_ = earningsQuality(st); const wc = workingCapitalIntel(st);
  let body: React.ReactNode = null;
  if (!hasData && tab !== "consol") body = <Notice tone="warn">Needs ledger activity — post vouchers or load demo data from Accounting → Periods.</Notice>;
  else if (tab === "briefing") {
    const m = (await monthlySeries(ctx)).filter((x) => x.revenue || x.expense); const arr = await ageing(ctx, "sales", new Date().toISOString().slice(0, 10));
    const over = arr.reduce((a, r) => a + r.buckets["31-60"] + r.buckets["61-90"] + r.buckets["90+"], 0); const rt = Object.fromEntries(computeRatios(st).map((r) => [r.key, r.value]));
    const last = m[m.length - 1], prev = m[m.length - 2]; const lines = [
      `Revenue for ${ctx.fy.label} to date is ${inr(n(s.pl.revenue))} with gross margin ${pct(rt.gpm as number)} and net margin ${pct(rt.npm as number)}; net profit stands at ${inr(n(s.pl.netProfit))}.`,
      last && prev ? `Latest month revenue ${inr(last.revenue)} vs ${inr(prev.revenue)} previously (${prev.revenue ? pct((last.revenue - prev.revenue) / prev.revenue) : "n/a"}).` : "Not enough months to compare month-on-month.",
      `Liquidity: cash & bank ${inr(n(s.bs.cash))}; current ratio ${(rt.cr as number)?.toFixed(2) ?? "n/a"}; working capital ${inr(n(s.bs.currentAssets.minus(s.bs.currentLiabilities)))}.`,
      `Leverage: debt ${inr(n(s.bs.debt))}, debt/equity ${(rt.de as number)?.toFixed(2) ?? "n/a"}, interest cover ${(rt.icr as number)?.toFixed(1) ?? "n/a"}x.`,
      `Collections: ${inr(over)} of receivables is more than 30 days past due.`,
      flags.length ? `Attention: ${flags.slice(0, 3).map((f) => f.message).join("; ")}.` : "No red flags triggered by the rule set.",
      `Financial health score ${health.score ?? "n/a"}/100 (${health.label}). Books ${s.tb.balanced ? "balance" : "DO NOT balance"}.`];
    body = (<Card title={`CFO briefing — ${ctx.company.name}`} subtitle={`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from your ledger by deterministic rules (no language model). Ask the CFO AI agent for narrative analysis.`} action={<PrintButton />}><ul className="space-y-2 text-sm">{lines.map((l) => <li key={l} className="flex gap-2"><span className="text-accent">▸</span>{l}</li>)}</ul><div className="mt-4"><Link className="btn btn-primary btn-sm" href="/ai">Discuss with CFO AI →</Link></div></Card>);
  } else if (tab === "flags") {
    body = (<div className="grid gap-4 lg:grid-cols-2"><Card title="Automated red flags">{flags.length === 0 ? <p className="text-sm text-up">✓ None triggered.</p> : <ul className="space-y-2">{flags.map((f) => <li key={f.message} className="flex gap-2 text-xs"><Badge tone={f.severity === "high" ? "down" : f.severity === "medium" ? "warn" : "neutral"}>{f.severity}</Badge><span><b>{f.area}: {f.message}</b><br /><span className="text-muted">{f.evidence}</span></span></li>)}</ul>}</Card>
      <Card title="Earnings quality"><table className="tbl"><tbody><tr><td>CFO ÷ net profit<div className="text-[10px] text-muted">Cash conversion of profit</div></td><td className="r num">{eq_.cfoPat === null ? "—" : eq_.cfoPat.toFixed(2)}</td></tr><tr><td>Accrual ratio<div className="text-[10px] text-muted">(PAT − CFO) ÷ assets; high positive = low quality</div></td><td className="r num">{eq_.accrual === null ? "—" : pct(eq_.accrual)}</td></tr><tr><td>FCF ÷ EBITDA</td><td className="r num">{eq_.fcfConv === null ? "—" : pct(eq_.fcfConv)}</td></tr><tr><td colSpan={2} className="font-semibold">{eq_.verdict}</td></tr></tbody></table></Card>
      <Card title="Working-capital intelligence"><table className="tbl"><tbody>{[["DSO", wc.dso], ["DIO", wc.dio], ["DPO", wc.dpo], ["Cash conversion cycle", wc.ccc]].map(([k, v]) => <tr key={String(k)}><td>{String(k)}</td><td className="r num">{(v as number).toFixed(0)} days</td></tr>)}</tbody></table><h4 className="mb-1 mt-3 text-xs font-semibold">Cash released by levers (indicative)</h4><ul className="text-xs">{wc.levers.map((l) => <li key={l.lever} className="flex justify-between"><span>{l.lever}</span><span className="num">{inr(l.cashRelease)}</span></li>)}</ul></Card>
      <Card title="Financial health score"><div className="num text-4xl font-bold text-accent">{health.score ?? "—"}</div><ul className="mt-2 text-xs">{health.parts.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name} <span className="text-muted">({p.weight}%)</span></span><span className="num">{p.score === null ? "n/a" : Math.round(p.score * 100)}</span></li>)}</ul></Card></div>);
  } else if (tab === "stress") {
    const mo = (await monthlySeries(ctx)).filter((x) => x.revenue || x.expense); const k = Math.max(1, mo.length);
    body = <Card title="Cash-flow stress testing & survival"><StressLab cash={n(s.bs.cash)} revenue={mo.reduce((a, x) => a + x.revenue, 0) / k} costs={mo.reduce((a, x) => a + x.expense, 0) / k} receivables={n(s.bs.receivables)} /></Card>;
  } else if (tab === "anomaly") {
    const lines = await db.select({ id: vouchers.id, number: vouchers.number, date: vouchers.date, acc: accounts.name, dr: voucherLines.debit, cr: voucherLines.credit, narr: vouchers.narration }).from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt))).innerJoin(accounts, eq(accounts.id, voucherLines.accountId)).where(and(eq(vouchers.companyId, ctx.company.id), gte(vouchers.date, ctx.fy.startDate), lte(vouchers.date, ctx.fy.endDate)));
    const al = lines.map((l) => ({ voucherId: l.id, number: l.number, date: l.date, account: l.acc, amount: Math.max(Number(l.dr), Number(l.cr)) })); const an = detectAnomalies(al); const bf = benford(al.map((l) => l.amount).filter((a) => a > 0));
    const dims = ["Liquidity", "Leverage", "Profitability", "Collections", "Controls"]; const rt = Object.fromEntries(computeRatios(st).map((r) => [r.key, r.value])); const over90 = (await ageing(ctx, "sales", new Date().toISOString().slice(0, 10))).reduce((a, r) => a + r.buckets["90+"], 0);
    const lvl = [(rt.cr as number) < 1 ? 3 : (rt.cr as number) < 1.3 ? 2 : 1, (rt.de as number) > 2 ? 3 : (rt.de as number) > 1 ? 2 : 1, (rt.npm as number) < 0 ? 3 : (rt.npm as number) < 0.05 ? 2 : 1, over90 > 0 ? 3 : 1, an.filter((a) => a.severity !== "low").length > 3 ? 3 : an.length ? 2 : 1];
    body = (<div className="space-y-4"><Card title="Financial risk heatmap" subtitle="Rule-based banding of live metrics"><div className="grid grid-cols-5 gap-2">{dims.map((d, i) => <div key={d} className={`rounded-lg p-3 text-center text-xs font-semibold ${lvl[i] === 3 ? "bg-down/25 text-down" : lvl[i] === 2 ? "bg-warn/25 text-warn" : "bg-up/20 text-up"}`}>{d}<div className="mt-1 text-[10px] uppercase">{["", "Low", "Medium", "High"][lvl[i]]}</div></div>)}</div></Card>
      <Card title={`Fraud & anomaly screens (${al.length} posted lines)`} subtitle="Duplicates, weekend postings, round sums and statistical outliers. Findings are leads to investigate, not conclusions." pad={false}><div className="p-3"><DataTable title="anomalies" columns={[{ key: "severity", label: "Severity", kind: "tone" }, { key: "type", label: "Screen" }, { key: "number", label: "Voucher" }, { key: "detail", label: "Detail" }]} rows={an} empty="No anomalies detected." /></div></Card>
      <Card title="Benford first-digit test"><BarsChart height={200} data={bf.counts.map((c, i) => ({ d: String(i + 1), Observed: +(bf.n ? (c / bf.n) * 100 : 0).toFixed(1), Expected: +(bf.expected[i] * 100).toFixed(1) }))} x="d" series={[{ key: "Observed" }, { key: "Expected", color: "#94a3b8" }]} /><p className="mt-1 text-xs text-muted">n = {bf.n}, χ² = {bf.chi.toFixed(1)}. {bf.note}</p></Card></div>);
  } else {
    const out: { name: string; revenue: number; ebitda: number; net: number; assets: number; cash: number; debt: number }[] = [];
    for (const c of ctx.companies) { const [fy] = (await db.select().from(financialYears).where(eq(financialYears.companyId, c.id))).sort((a, b) => b.startDate.localeCompare(a.startDate)); if (!fy) continue; const b = await getBalances({ company: c, fy }); const p = profitAndLoss(b), bs = balanceSheet(b); out.push({ name: c.name, revenue: n(p.revenue), ebitda: n(p.ebitda), net: n(p.netProfit), assets: n(bs.totalAssets), cash: n(bs.cash), debt: n(bs.debt) }); }
    const t = out.reduce((a, o) => ({ revenue: a.revenue + o.revenue, ebitda: a.ebitda + o.ebitda, net: a.net + o.net, assets: a.assets + o.assets, cash: a.cash + o.cash, debt: a.debt + o.debt }), { revenue: 0, ebitda: 0, net: 0, assets: 0, cash: 0, debt: 0 });
    body = (<Card title="Multi-company consolidated view" subtitle="Simple aggregation of each company's latest financial year in base currency units as recorded. No inter-company elimination or currency translation is performed — treat as management aggregation." pad={false}><div className="p-3"><DataTable searchable={false} title="consolidated" columns={[{ key: "name", label: "Company" }, { key: "revenue", label: "Revenue", kind: "money" }, { key: "ebitda", label: "EBITDA", kind: "money" }, { key: "net", label: "Net profit", kind: "money" }, { key: "assets", label: "Total assets", kind: "money" }, { key: "cash", label: "Cash", kind: "money" }, { key: "debt", label: "Debt", kind: "money" }]} rows={[...out, { name: "CONSOLIDATED (aggregate)", ...t }]} /></div>{ctx.companies.length < 2 && <p className="px-4 pb-3 text-xs text-muted">Add another company (Settings) to see a multi-entity aggregation.</p>}</Card>);
  }
  void D; void compact; void companies;
  return (<><PageHeader title="Intelligence Lab" desc="CFO briefings, red flags, earnings quality, stress tests, anomaly detection and risk heatmaps — rule-based and explainable." crumbs={[{ label: "Command" }, { label: "Intelligence" }]} /><Tabs tabs={TABS} active={tab} base="/insights" />{body}</>);
}
