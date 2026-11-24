import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { accounts, costCentres, invoices, parties, scheduledReports, voucherLines, vouchers, inventoryItems } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Card, Notice, PageHeader, Stat, Tabs, compact, inr } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExportMenu from "@/components/ExportMenu";
import ActionForm from "@/components/ActionForm";
import MISInteractiveDashboard from "@/components/MISInteractiveDashboard";
import { REPORTS } from "@/services/reports";
import { monthlySeries, invoiceRows } from "@/services/finance";
import { scheduleReport } from "@/actions/analytics";
import { D } from "@/engines/core";

export const metadata = { title: "MIS & BI Studio" };
const TABS = [["dash", "Dashboards"], ["pivot", "Pivot analysis"], ["clean", "Data cleaning & transform"], ["export", "BI exports & schedules"]].map(([id, label]) => ({ id, label }));
const DIMS: Record<string, string> = { account: "Ledger account", group: "Account group", type: "Voucher type", month: "Month", cost: "Cost centre", party: "Party" };

function PivotSelect({ name, value, options }: { name: string; value: string; options: [string, string][] }) {
  return <select name={name} defaultValue={value} className="inp !w-auto">{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>;
}

export default async function Mis({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const tab = sp.tab ?? "dash"; const canWrite = can(ctx.role, "write");
  let body: React.ReactNode = null;
  if (tab === "dash") {
    const m = await monthlySeries(ctx); const sales = await invoiceRows(ctx, "sales"); const purch = await invoiceRows(ctx, "purchase");
    const agg = (rows: typeof sales) => { const mp = new Map<string, number>(); rows.filter((r) => r.inv.status !== "pending_approval").forEach(({ inv, party }) => mp.set(party.name, (mp.get(party.name) ?? 0) + Number(inv.taxable))); return [...mp.entries()].sort((a, b) => b[1] - a[1]); };
    const cust = agg(sales), vend = agg(purch); const tot = cust.reduce((s, x) => s + x[1], 0);
    const exp = await db.select({ name: accounts.name, dr: voucherLines.debit, cr: voucherLines.credit }).from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt))).innerJoin(accounts, eq(accounts.id, voucherLines.accountId)).where(and(eq(vouchers.companyId, ctx.company.id), eq(accounts.type, "expense"), gte(vouchers.date, ctx.fy.startDate), lte(vouchers.date, ctx.fy.endDate)));
    const em = new Map<string, number>(); exp.forEach((e) => em.set(e.name, (em.get(e.name) ?? 0) + Number(e.dr) - Number(e.cr)));
    const inv = await db.select().from(inventoryItems).where(and(eq(inventoryItems.companyId, ctx.company.id), isNull(inventoryItems.deletedAt)));
    body = (<div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Active customers" value={String(cust.length)} sub={`Top-3 share ${tot ? Math.round((cust.slice(0, 3).reduce((s, x) => s + x[1], 0) / tot) * 100) : 0}%`} /><Stat label="Active vendors" value={String(vend.length)} /><Stat label="Avg monthly revenue" value={compact(m.filter((x) => x.revenue).reduce((s, x, _, a) => s + x.revenue / a.length, 0))} /><Stat label="Inventory items" value={String(inv.length)} sub="See Accounting → Inventory" /></div>
      <MISInteractiveDashboard months={m} expenses={[...em.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))} company={ctx.company.name} financialYear={ctx.fy.label} currency={ctx.company.baseCurrency} />
      <div className="grid gap-4 lg:grid-cols-2"><Card title="Customer analytics — revenue concentration" pad={false}><div className="p-3"><DataTable title="customers" searchable={false} columns={[{ key: "n", label: "Customer" }, { key: "v", label: "Taxable revenue", kind: "money" }, { key: "s", label: "Share", kind: "pct" }]} rows={cust.map(([n, v]) => ({ n, v, s: tot ? v / tot : 0 }))} /></div></Card>
        <Card title="Vendor analytics" pad={false}><div className="p-3"><DataTable title="vendors" searchable={false} columns={[{ key: "n", label: "Vendor" }, { key: "v", label: "Taxable spend", kind: "money" }]} rows={vend.map(([n, v]) => ({ n, v }))} /></div></Card></div>
      <Notice>Employee-productivity dashboards need HR/timesheet data that FINVANTA does not collect; connect a source via the BI exports to model it in your BI tool.</Notice></div>);
  } else if (tab === "pivot") {
    const rowDim = sp.row ?? "account", colDim = sp.col ?? "month"; const measure = sp.measure ?? "net";
    const lines = await db.select({ date: vouchers.date, vtype: vouchers.type, acc: accounts.name, grp: accounts.groupName, atype: accounts.type, dr: voucherLines.debit, cr: voucherLines.credit, cc: costCentres.name, party: parties.name }).from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt))).innerJoin(accounts, eq(accounts.id, voucherLines.accountId)).leftJoin(costCentres, eq(costCentres.id, voucherLines.costCentreId)).leftJoin(parties, eq(parties.id, voucherLines.partyId)).where(and(eq(vouchers.companyId, ctx.company.id), gte(vouchers.date, ctx.fy.startDate), lte(vouchers.date, ctx.fy.endDate)));
    const key = (l: (typeof lines)[number], d: string) => ({ account: l.acc, group: l.grp, type: l.vtype, month: l.date.slice(0, 7), cost: l.cc ?? "(none)", party: l.party ?? "(none)" }[d] ?? "?");
    const piv = new Map<string, Map<string, number>>(); const cols = new Set<string>();
    lines.forEach((l) => { const r = key(l, rowDim), c = key(l, colDim); const v = measure === "debit" ? Number(l.dr) : measure === "credit" ? Number(l.cr) : Number(l.dr) - Number(l.cr); cols.add(c); const row = piv.get(r) ?? new Map(); row.set(c, (row.get(c) ?? 0) + v); piv.set(r, row); });
    const cl = [...cols].sort(); const rows = [...piv.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([r, m]) => ({ r, ...Object.fromEntries(cl.map((c) => [c, (m.get(c) ?? 0).toFixed(2)])), total: [...m.values()].reduce((a, b) => a + b, 0).toFixed(2) }));
    body = (<Card title="Pivot analysis over posted voucher lines" subtitle="Drill-through: click ledger names in Accounting → Chart of accounts. Net = debit − credit."><form className="mb-3 flex flex-wrap items-center gap-2 text-xs"><input type="hidden" name="tab" value="pivot" />Rows<PivotSelect name="row" value={rowDim} options={Object.entries(DIMS)} />Columns<PivotSelect name="col" value={colDim} options={Object.entries(DIMS)} />Measure<PivotSelect name="measure" value={measure} options={[["net", "Net (Dr−Cr)"], ["debit", "Debit"], ["credit", "Credit"]]} /><button className="btn btn-primary btn-sm">Pivot</button></form>
      <DataTable title="pivot" pageSize={50} columns={[{ key: "r", label: DIMS[rowDim] }, ...cl.map((c) => ({ key: c, label: c, kind: "money" as const })), { key: "total", label: "Total", kind: "money" as const }]} rows={rows} /></Card>);
  } else if (tab === "clean") {
    body = <Card title="Data cleaning & transformation workbench"><DataCleaner /></Card>;
  } else {
    const sch = await db.select().from(scheduledReports).where(eq(scheduledReports.companyId, ctx.company.id)).orderBy(desc(scheduledReports.createdAt));
    body = (<div className="grid gap-4 lg:grid-cols-2"><div className="space-y-4"><Card title="Management Information Pack" subtitle="Branded Excel workbook with an executive dashboard, KPI cards, explanatory charts, and separate P&L, Balance Sheet, Cash Flow, Ratios and Trial Balance sheets."><a className="btn btn-primary" href="/api/export?report=mis-pack&format=xlsx" download>Download MIS Excel</a></Card><Card title="Excel · CSV · Power BI-compatible exports" subtitle="Flat, typed tables. In Power BI use Get Data → Web (CSV) with your session, or download and import. JSON available too."><table className="tbl"><tbody>{REPORTS.map((r) => <tr key={r.key}><td>{r.label}</td><td className="text-right"><ExportMenu report={r.key} formats={["xlsx", "csv", "json"]} /></td></tr>)}</tbody></table></Card></div>
      <div className="space-y-4">{canWrite && <Card title="Schedule a report" subtitle="Schedules are recorded; automated delivery needs an email/cron provider (not configured). Use the export links to run on demand."><ActionForm submit="Save schedule" action={scheduleReport} fields={[{ name: "name", label: "Name", required: true, span: 2 }, { name: "report", label: "Report", type: "select", options: REPORTS.map((r) => [r.key, r.label] as [string, string]) }, { name: "frequency", label: "Frequency", type: "select", options: [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]] }, { name: "format", label: "Format", type: "select", options: [["xlsx", "Excel"], ["csv", "CSV"], ["pdf", "PDF"]], span: 2 }]} /></Card>}
        <Card title="Saved schedules" pad={false}><div className="p-3"><table className="tbl"><tbody>{sch.length === 0 && <tr><td className="py-4 text-center text-muted">None.</td></tr>}{sch.map((s) => <tr key={s.id}><td>{s.name}<div className="text-[11px] text-muted">{s.frequency} · {s.format}</div></td><td className="text-right"><ExportMenu report={s.report} formats={[s.format]} /></td></tr>)}</tbody></table></div></Card></div></div>);
  }
  return (<><PageHeader title="MIS & Business Intelligence" desc="Interactive financial dashboards with period filters, hover-to-inspect charts, pivots, customer analytics and BI exports." crumbs={[{ label: "Analysis & Planning" }, { label: "MIS" }]} /><Tabs tabs={TABS} active={tab} base="/mis" />{body}</>);
}
import DataCleaner from "@/components/DataCleaner";
void asc; void inr; void D;
