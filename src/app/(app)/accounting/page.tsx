import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, costCentres, financialYears, inventoryItems, vouchers, voucherLines } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Badge, Card, Notice, PageHeader, Tabs, inr } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExportMenu from "@/components/ExportMenu";
import ActionForm from "@/components/ActionForm";
import VoucherForm from "@/components/VoucherForm";
import { buildReport } from "@/services/reports";
import { addFixedAsset, addInventoryItem, closeFinancialYear, createAccount, createCostCentre, inventoryMove, loadDemoData, reopenFinancialYear, reverseVoucher, runDepreciation, setOpeningBalance } from "@/actions/accounting";
import { VOUCHER_TYPES } from "@/engines/accounting";
import { loadStatements } from "@/services/finance";

export const metadata = { title: "Accounting" };
const TABS = [["vouchers", "Vouchers"], ["new", "New voucher"], ["accounts", "Chart of accounts"], ["ledger", "Ledger"], ["reports", "Financial statements"], ["books", "Books"], ["assets", "Fixed assets"], ["inventory", "Inventory"], ["audit", "Audit trail"], ["period", "Periods & closing"]].map(([id, label]) => ({ id, label }));

export default async function Accounting({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const tab = sp.tab ?? "vouchers";
  const canWrite = can(ctx.role, "write"), canApprove = can(ctx.role, "approve"), isAdmin = can(ctx.role, "admin");
  const accs = await db.select().from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt))).orderBy(asc(accounts.code));
  const ccs = await db.select().from(costCentres).where(and(eq(costCentres.companyId, ctx.company.id), isNull(costCentres.deletedAt)));
  const today = new Date().toISOString().slice(0, 10);

  let body: React.ReactNode = null;
  if (tab === "vouchers") {
    const cond = [eq(vouchers.companyId, ctx.company.id), isNull(vouchers.deletedAt), gte(vouchers.date, ctx.fy.startDate), lte(vouchers.date, ctx.fy.endDate)];
    if (sp.type) cond.push(eq(vouchers.type, sp.type));
    if (sp.q) cond.push(ilike(vouchers.narration, `%${sp.q.replace(/[%_]/g, "")}%`));
    let rows = await db.select({ v: vouchers, amount: sql<string>`coalesce(sum(${voucherLines.debit}),0)::text` }).from(vouchers).leftJoin(voucherLines, eq(voucherLines.voucherId, vouchers.id)).where(and(...cond)).groupBy(vouchers.id).orderBy(desc(vouchers.date), desc(vouchers.number)).limit(300);
    if (sp.q) { const more = await db.select({ v: vouchers, amount: sql<string>`coalesce(sum(${voucherLines.debit}),0)::text` }).from(vouchers).leftJoin(voucherLines, eq(voucherLines.voucherId, vouchers.id)).where(and(eq(vouchers.companyId, ctx.company.id), ilike(vouchers.number, `%${sp.q}%`))).groupBy(vouchers.id).limit(50); rows = [...rows, ...more.filter((m) => !rows.some((r) => r.v.id === m.v.id))]; }
    body = (
      <Card title={`Vouchers — ${ctx.fy.label}`} action={<ExportMenu report="day-book" />} pad={false}>
        <form className="flex flex-wrap gap-2 border-b border-line p-3" method="get"><input type="hidden" name="tab" value="vouchers" />
          <select name="type" defaultValue={sp.type ?? ""} className="inp !w-auto"><option value="">All types</option>{VOUCHER_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select>
          <input name="q" defaultValue={sp.q} className="inp !w-64" placeholder="Search narration or number…" /><button className="btn">Filter</button></form>
        <div className="max-h-[600px] overflow-auto"><table className="tbl"><thead><tr><th>Date</th><th>Number</th><th>Type</th><th>Narration</th><th className="r">Amount</th><th>Status</th><th>Source</th><th /></tr></thead><tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-muted">No vouchers match. <Link className="text-accent" href="?tab=new">Post one →</Link></td></tr>}
          {rows.map(({ v, amount }) => (<tr key={v.id}><td className="num">{v.date}</td><td className="num font-medium">{v.number}</td><td>{v.type.replace("_", " ")}</td><td className="max-w-xs truncate" title={v.narration}>{v.narration}</td><td className="r num">{inr(amount, 2)}</td>
            <td><Badge tone={v.status === "posted" ? "up" : "warn"}>{v.status}</Badge></td><td className="text-muted">{v.source}</td>
            <td>{canApprove && v.status === "posted" && !v.reversalOf && <form action={reverseVoucher.bind(null, v.id)}><button className="btn btn-sm" title="Post an equal and opposite entry">Reverse</button></form>}</td></tr>))}
        </tbody></table></div>
      </Card>);
  } else if (tab === "new") {
    body = canWrite ? <Card title="New voucher" subtitle="Double-entry with live validation. Totals must balance before posting."><VoucherForm accounts={accs.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))} costCentres={ccs.map((c) => ({ id: c.id, label: `${c.name} (${c.category})` }))} today={today > ctx.fy.endDate ? ctx.fy.endDate : today < ctx.fy.startDate ? ctx.fy.startDate : today} currency={ctx.company.baseCurrency} /></Card> : <Notice tone="warn">Your role ({ctx.role}) is read-only.</Notice>;
  } else if (tab === "accounts") {
    body = (<div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Chart of accounts" subtitle="Opening balance: debit positive / credit negative" pad={false}>
        <div className="p-3"><DataTable title="chart-of-accounts" pageSize={40} columns={[{ key: "code", label: "Code" }, { key: "name", label: "Ledger" }, { key: "type", label: "Type" }, { key: "group", label: "Group" }, { key: "role", label: "System role" }, { key: "opening", label: "Opening (Dr+/Cr−)", kind: "money" }]} rows={accs.map((a) => ({ code: a.code, name: a.name, type: a.type, group: a.groupName, role: a.role, opening: a.openingBalance, href: `?tab=ledger&account=${a.id}` }))} /></div>
        <p className="px-4 pb-3 text-[11px] text-muted">Account roles drive automatic posting (e.g. invoices post to roles <code>ar</code>, <code>sales</code>, <code>output_cgst</code>) and statement classification.</p>
      </Card>
      <div className="space-y-4">
        {canWrite && <Card title="Add ledger"><ActionForm cols={2} submit="Create ledger" action={createAccount} fields={[{ name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true }, { name: "type", label: "Type", type: "select", options: [["asset", "Asset"], ["liability", "Liability"], ["equity", "Equity"], ["income", "Income"], ["expense", "Expense"]] }, { name: "role", label: "Role", type: "select", options: [["other", "Other"], ["opex", "Operating expense"], ["other_income", "Other income"], ["other_ca", "Other current asset"], ["other_cl", "Other current liability"], ["cogs", "COGS"], ["sales", "Sales"]] }, { name: "groupName", label: "Group", span: 2 }]} /></Card>}
        {canApprove && <Card title="Set opening balance" subtitle="Audit-logged. Opening balances across all ledgers must net to zero."><ActionForm cols={2} submit="Save balance" action={setOpeningBalance} fields={[{ name: "accountId", label: "Ledger", type: "select", span: 2, options: accs.filter((a) => !["income", "expense"].includes(a.type)).map((a) => [a.id, `${a.code} ${a.name}`] as [string, string]) }, { name: "amount", label: "Amount", type: "number", step: "0.01", required: true }, { name: "side", label: "Side", type: "select", options: [["dr", "Debit"], ["cr", "Credit"]] }]} /></Card>}
        <Card title="Cost centres" subtitle="Tag voucher lines for departmental/project reporting">
          <ul className="mb-3 space-y-1 text-xs">{ccs.length === 0 && <li className="text-muted">None yet.</li>}{ccs.map((c) => <li key={c.id}>{c.name} <Badge>{c.category}</Badge></li>)}</ul>
          {canWrite && <ActionForm cols={2} submit="Add" action={createCostCentre} fields={[{ name: "name", label: "Name", required: true }, { name: "category", label: "Category", type: "select", options: [["Department", "Department"], ["Project", "Project"], ["Location", "Location"]] }]} />}
        </Card>
      </div></div>);
  } else if (tab === "ledger") {
    const r = sp.account ? await buildReport(ctx, "ledger", { account: sp.account }) : null;
    body = (<div className="space-y-4"><Card><form method="get" className="flex gap-2"><input type="hidden" name="tab" value="ledger" /><select name="account" defaultValue={sp.account} className="inp !w-80">{accs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><button className="btn btn-primary">Show ledger</button>{sp.account && <ExportMenu report="ledger" params={{ account: sp.account }} />}</form></Card>
      {r && <Card title={r.title} subtitle={r.subtitle} pad={false}><div className="p-3"><DataTable title="ledger" columns={r.columns} rows={r.rows} pageSize={100} /></div></Card>}</div>);
  } else if (tab === "reports" || tab === "books" || tab === "audit") {
    const opts = tab === "reports" ? [["trial-balance", "Trial balance"], ["profit-loss", "Profit & loss"], ["balance-sheet", "Balance sheet"], ["cash-flow", "Cash flow"], ["ratios", "Ratios"]] : tab === "books" ? [["day-book", "Day book"], ["cash-book", "Cash book"], ["bank-book", "Bank book"]] : [["audit-trail", "Audit trail"]];
    const key = (tab === "reports" ? sp.r : tab === "books" ? sp.b : "audit-trail") ?? opts[0][0];
    const r = await buildReport(ctx, key);
    body = (<Card title={r?.title} subtitle={r?.subtitle} action={<ExportMenu report={key} />} pad={false}>
      {opts.length > 1 && <div className="flex flex-wrap gap-1 border-b border-line p-3">{opts.map(([k, l]) => <Link key={k} className={`btn btn-sm ${k === key ? "btn-primary" : ""}`} href={`?tab=${tab}&${tab === "reports" ? "r" : "b"}=${k}`}>{l}</Link>)}</div>}
      <div className="p-3">{r && <DataTable title={key} columns={r.columns} rows={r.rows} pageSize={80} searchable={r.rows.length > 15} />}</div></Card>);
  } else if (tab === "assets") {
    const r = await buildReport(ctx, "fixed-assets");
    body = (<div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2" title="Fixed assets register" action={<span className="flex gap-2"><ExportMenu report="fixed-assets" />{canApprove && <form action={runDepreciation}><button className="btn btn-sm btn-primary" title="Posts one journal for the financial year">Run depreciation for {ctx.fy.label}</button></form>}</span>} pad={false}><div className="p-3">{r && <DataTable title="fixed-assets" columns={r.columns} rows={r.rows} />}</div>
      <p className="px-4 pb-3 text-[11px] text-muted">SLM: (cost − salvage) ÷ life. WDV: opening book value × rate. Depreciation is capped so book value never falls below salvage; running it posts Dr Depreciation / Cr Accumulated depreciation.</p></Card>
      {canWrite && <Card title="Add asset"><ActionForm submit="Add asset" action={addFixedAsset} fields={[{ name: "name", label: "Asset name", required: true, span: 2 }, { name: "category", label: "Category", type: "select", options: ["Plant & Machinery", "Computers", "Furniture", "Vehicles", "Buildings"].map((x) => [x, x] as [string, string]) }, { name: "purchaseDate", label: "Purchase date", type: "date", required: true }, { name: "cost", label: "Cost", type: "number", required: true }, { name: "salvage", label: "Salvage value", type: "number", defaultValue: 0 }, { name: "method", label: "Method", type: "select", options: [["SLM", "Straight-line"], ["WDV", "Written-down value"]] }, { name: "lifeYears", label: "Life (years)", type: "number", defaultValue: 5 }, { name: "wdvRate", label: "WDV rate %", type: "number", defaultValue: 15 }]} /></Card>}</div>);
  } else if (tab === "inventory") {
    const r = await buildReport(ctx, "inventory"); const items = await db.select().from(inventoryItems).where(and(eq(inventoryItems.companyId, ctx.company.id), isNull(inventoryItems.deletedAt)));
    body = (<div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2" title="Inventory valuation — weighted average cost" action={<ExportMenu report="inventory" />} pad={false}><div className="p-3">{r && <DataTable title="inventory" columns={r.columns} rows={r.rows} />}</div></Card>
      <div className="space-y-4">{canWrite && <><Card title="New item"><ActionForm submit="Create item" action={addInventoryItem} fields={[{ name: "sku", label: "SKU", required: true }, { name: "name", label: "Name", required: true }, { name: "unit", label: "Unit", defaultValue: "Nos" }, { name: "hsn", label: "HSN" }, { name: "reorderLevel", label: "Reorder level", type: "number", defaultValue: 0 }]} /></Card>
        <Card title="Stock movement" subtitle="Issues are valued at the running weighted-average cost and rejected if stock is insufficient."><ActionForm submit="Record" action={inventoryMove} fields={[{ name: "itemId", label: "Item", type: "select", span: 2, options: items.map((i) => [i.id, `${i.sku} · ${i.name}`] as [string, string]) }, { name: "kind", label: "Type", type: "select", options: [["in", "Receipt (in)"], ["out", "Issue (out)"]] }, { name: "date", label: "Date", type: "date", defaultValue: today, required: true }, { name: "qty", label: "Quantity", type: "number", required: true }, { name: "rate", label: "Rate (for receipts)", type: "number", defaultValue: 0 }]} /></Card></>}
        <Notice>Linked purchase bills and approved sales invoices post inventory and cost of goods sold alongside stock movements. Manual stock movements update only the inventory sub-ledger.</Notice></div></div>);
  } else if (tab === "period") {
    const s = await loadStatements(ctx);
    const fys = await db.select().from(financialYears).where(eq(financialYears.companyId, ctx.company.id)).orderBy(desc(financialYears.startDate));
    body = (<div className="grid gap-4 lg:grid-cols-2"><Card title="Financial years & period closing" subtitle="Closing locks the year against new postings and opens the next year with carried-forward balances.">
      <table className="tbl"><thead><tr><th>Year</th><th>Period</th><th>Status</th><th /></tr></thead><tbody>{fys.map((f) => <tr key={f.id}><td className="font-medium">{f.label}</td><td className="num">{f.startDate} → {f.endDate}</td><td><Badge tone={f.status === "open" ? "up" : "warn"}>{f.status}</Badge></td>
        <td>{isAdmin && (f.status === "open" ? <form action={closeFinancialYear.bind(null, f.id)}><button className="btn btn-sm">Close year</button></form> : <form action={reopenFinancialYear.bind(null, f.id)}><button className="btn btn-sm">Reopen</button></form>)}</td></tr>)}</tbody></table>
      {!isAdmin && <p className="mt-2 text-[11px] text-muted">Owner/admin role required to close or reopen periods. Both actions are audit-logged.</p>}</Card>
      <Card title="Pre-close checklist"><ul className="space-y-2 text-sm"><li>{s.tb.balanced ? "✅" : "❌"} Trial balance balances ({s.tb.totalDr.toFixed(2)} / {s.tb.totalCr.toFixed(2)})</li><li>{s.bs.balanced ? "✅" : "❌"} Balance sheet balances (difference {s.bs.difference.toFixed(2)})</li><li>{s.cf.reconciled ? "✅" : "❌"} Cash-flow statement reconciles to cash & bank</li><li>ℹ️ Run depreciation and reconcile bank accounts before closing.</li></ul>
        <div className="mt-4"><form action={loadDemoData}><button className="btn btn-sm">Load demo data (empty companies only)</button></form></div></Card></div>);
  }

  return (<><PageHeader title="Accounting" desc="Double-entry bookkeeping with automatic posting, period locks and a complete audit trail." crumbs={[{ label: "Accounting & Compliance" }, { label: "Accounting" }]} /><Tabs tabs={TABS} active={tab} base="/accounting" />{body}</>);
}
