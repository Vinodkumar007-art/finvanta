import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { complianceRecords, invoices, parties, tdsEntries, tdsSections } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Badge, Card, Notice, PageHeader, Stat, Tabs, inr } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExportMenu from "@/components/ExportMenu";
import ActionForm from "@/components/ActionForm";
import { CapGainsCalc, GstCalc, IncomeTaxCalc, LateFeeCalc, TdsCalc } from "@/components/TaxCalculators";
import GstFilingFlow from "@/components/GstFilingFlow";
import Recon2B from "@/components/Recon2B";
import { invoiceRows } from "@/services/finance";
import { buildReport } from "@/services/reports";
import { gstr3bSummary, TAX_RULES, tdsDepositDue, tdsQuarter, validateGstin } from "@/engines/tax";
import { addComplianceRecord, prepareEinvoice, recordChallan, recordTdsDeduction, updateTdsSection } from "@/actions/tax";

export const metadata = { title: "GST, TDS & Income Tax" };
const TABS = [["calendar", "Compliance calendar"], ["gst", "GST workspace"], ["recon", "GSTR-2B reconciliation"], ["einv", "E-invoice & e-way"], ["tds", "TDS"], ["itax", "Income tax"], ["notices", "Notices & records"]].map(([id, label]) => ({ id, label }));
const d2 = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export default async function TaxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const tab = sp.tab ?? "calendar";
  const canWrite = can(ctx.role, "write"), canApprove = can(ctx.role, "approve");
  const gstEnv = process.env.GST_ENV?.trim().toLowerCase() ?? "";
  const gspProvider = process.env.GSP_PROVIDER?.trim().toLowerCase() ?? "";
  const mockGspBanner = gspProvider === "mock" && tab !== "gst"
    ? <div role="alert" className="mb-4 rounded-lg border border-amber-500 bg-amber-950 px-4 py-3 text-sm font-bold text-amber-100">⚠ MOCK GSP — no real filing is happening</div>
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const banner = <Notice tone="warn" title="Mock-only workflow — no government filing">FINVANTA calculates draft data from your books. The local mock can return a fabricated status and ARN only after human OTP approval; it never submits to GSTN, NIC/IRP or TRACES. Rates are configurable defaults (FY {TAX_RULES.fy}); verify against {TAX_RULES.sources.join(", ")}.</Notice>;
  let body: React.ReactNode = null;

  if (tab === "calendar") {
    const t = new Date(); const y = t.getUTCFullYear(), m = t.getUTCMonth();
    const ev: { date: string; item: string; note: string }[] = [];
    for (let i = 0; i < 4; i++) { const mm = m + i; ev.push({ date: d2(y, mm, 7), item: "TDS/TCS deposit", note: "For deductions of previous month (30 Apr for March)" }, { date: d2(y, mm, 11), item: "GSTR-1 (monthly filers)", note: "Outward supplies" }, { date: d2(y, mm, 20), item: "GSTR-3B (monthly filers)", note: "Summary return & tax payment" }); }
    ev.push({ date: d2(y, 5, 15), item: "Advance tax — 1st instalment (15%)", note: "" }, { date: d2(y, 8, 15), item: "Advance tax — 2nd instalment (45% cumulative)", note: "" }, { date: d2(y, 11, 15), item: "Advance tax — 3rd instalment (75% cumulative)", note: "" }, { date: d2(y + 1, 2, 15), item: "Advance tax — 4th instalment (100%)", note: "" }, { date: d2(y, 6, 31), item: "TDS return 26Q/24Q/27Q — Q1", note: "" }, { date: d2(y, 9, 31), item: "TDS return — Q2", note: "" }, { date: d2(y + 1, 0, 31), item: "TDS return — Q3", note: "" }, { date: d2(y, 6, 31), item: "ITR due date (non-audit assessees)", note: "" });
    const notices = await db.select().from(complianceRecords).where(and(eq(complianceRecords.companyId, ctx.company.id), eq(complianceRecords.type, "notice")));
    const rows = [...ev, ...notices.filter((n) => n.dueDate).map((n) => ({ date: n.dueDate!, item: `Notice: ${n.ref}`, note: "Your recorded notice" }))].filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30).map((e) => ({ ...e, days: Math.round((Date.parse(e.date) - Date.parse(today)) / 86400000), status: Math.round((Date.parse(e.date) - Date.parse(today)) / 86400000) <= 7 ? "Due soon" : "Upcoming" }));
    body = (<div className="space-y-4">{banner}<Card title="Upcoming statutory dates" subtitle="Standard due dates — extensions, QRMP/quarterly options and turnover-based variations are NOT modelled. Confirm on the official calendars."><DataTable title="compliance-calendar" searchable={false} columns={[{ key: "date", label: "Due date" }, { key: "days", label: "In days", kind: "num" }, { key: "item", label: "Obligation" }, { key: "note", label: "Note" }, { key: "status", label: "", kind: "tone" }]} rows={rows} /></Card></div>);
  } else if (tab === "gst") {
    const [s, p] = [await invoiceRows(ctx, "sales"), await invoiceRows(ctx, "purchase")];
    const map = (r: typeof s) => r.map(({ inv, party }) => ({ gstin: party.gstin, invoiceNo: inv.number, date: inv.date, taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst }));
    const x = gstr3bSummary(map(s.filter((r) => r.inv.status !== "pending_approval")), map(p.filter((r) => r.inv.status !== "pending_approval")));
    const f = (d: { toNumber(): number }) => d.toNumber();
    const gstinOk = ctx.company.gstin ? validateGstin(ctx.company.gstin) : null;
    const sr = await buildReport(ctx, "gst-sales");
    body = (<div className="space-y-4">{banner}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Output tax (approved sales)" value={inr(f(x.outward.cgst.plus(x.outward.sgst).plus(x.outward.igst)))} /><Stat label="Input tax credit" value={inr(f(x.itc.cgst.plus(x.itc.sgst).plus(x.itc.igst)))} /><Stat label="Net tax payable in cash" value={inr(f(x.setoff.cashTotal))} tone="warn" /><Stat label="ITC carried forward" value={inr(f(x.setoff.carryIgst.plus(x.setoff.carryCgst).plus(x.setoff.carrySgst)))} /></div>
      <Card title="GSTR-3B draft — liability & ITC set-off" subtitle={`${ctx.company.name} · GSTIN ${ctx.company.gstin ?? "not set"} ${gstinOk === false ? "(checksum INVALID)" : gstinOk ? "(valid)" : ""} · ${ctx.fy.label} (approved invoices)`} action={<span className="flex flex-wrap gap-1"><a className="btn btn-sm" href="/api/tax/draft?type=gstr3b">GSTR-3B draft JSON</a><a className="btn btn-sm" href="/api/tax/draft?type=gstr3b&format=csv">GSTR-3B CSV</a><a className="btn btn-sm" href="/api/tax/draft?type=gstr1">GSTR-1 draft JSON</a><a className="btn btn-sm" href="/api/tax/draft?type=gstr1&format=csv">GSTR-1 CSV</a></span>}>
        <table className="tbl"><thead><tr><th>Head</th><th className="r">Output tax</th><th className="r">ITC available</th><th className="r">Cash payable</th><th className="r">ITC carry-forward</th></tr></thead><tbody>
          {([["IGST", x.outward.igst, x.itc.igst, x.setoff.cashIgst, x.setoff.carryIgst], ["CGST", x.outward.cgst, x.itc.cgst, x.setoff.cashCgst, x.setoff.carryCgst], ["SGST/UTGST", x.outward.sgst, x.itc.sgst, x.setoff.cashSgst, x.setoff.carrySgst]] as const).map(([h, o, i, c, cf]) => <tr key={h}><td>{h}</td><td className="r num">{inr(f(o), 2)}</td><td className="r num">{inr(f(i), 2)}</td><td className="r num">{inr(f(c), 2)}</td><td className="r num">{inr(f(cf), 2)}</td></tr>)}</tbody></table>
        <p className="mt-2 text-[11px] text-muted">Set-off follows the statutory order (IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST). Shown for the whole selected FY; file month-wise on the GST portal.</p></Card>
      <div className="grid gap-4 lg:grid-cols-2"><Card title="GST calculator"><GstCalc stateCode={ctx.company.stateCode} /></Card><Card title="Late fee & interest estimator"><LateFeeCalc /></Card></div>
      <Card title="GST sales register" action={<span className="flex gap-2"><ExportMenu report="gst-sales" /><ExportMenu report="gst-purchase" formats={["xlsx", "csv"]} /></span>} pad={false}><div className="p-3">{sr && <DataTable title="gst-sales-register" columns={sr.columns} rows={sr.rows} />}</div></Card>
      <GstFilingFlow companyName={ctx.company.name} canWrite={canWrite} canApprove={canApprove} gstEnv={gstEnv} gspProvider={gspProvider} initialPeriod={new Date().toISOString().slice(0, 7)} /></div>);
  } else if (tab === "recon") {
    const p = await invoiceRows(ctx, "purchase");
    body = (<Card title="GSTR-2B reconciliation" subtitle="ITC eligibility check against supplier-reported data">{<Recon2B books={p.filter((r) => r.inv.status !== "pending_approval").map(({ inv, party }) => ({ gstin: party.gstin, invoiceNo: inv.number, date: inv.date, taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst }))} />}</Card>);
  } else if (tab === "einv") {
    const sales = (await invoiceRows(ctx, "sales")).filter((r) => r.inv.status !== "pending_approval");
    const recs = await db.select().from(complianceRecords).where(and(eq(complianceRecords.companyId, ctx.company.id))).orderBy(desc(complianceRecords.createdAt));
    const er = recs.filter((r) => r.type === "einvoice" || r.type === "eway");
    body = (<div className="space-y-4">{banner}<div className="grid gap-4 lg:grid-cols-2">
      {canWrite && <Card title="Prepare e-invoice JSON" subtitle="Generates NIC-schema-style payload from an approved sales invoice"><ActionForm submit="Prepare" action={prepareEinvoice} fields={[{ name: "kind", label: "", type: "select", options: [["einvoice", "E-invoice (IRN) payload"]], span: 2 }, { name: "invoiceId", label: "Invoice", type: "select", span: 2, options: sales.map(({ inv, party }) => [inv.id, `${inv.number} · ${party.name} · ${inr(inv.total, 2)}`] as [string, string]) }]} /></Card>}
      {canWrite && <Card title="Prepare e-way bill data" subtitle="Capture transport details for upload to the e-way bill portal"><ActionForm submit="Prepare" action={prepareEinvoice} fields={[{ name: "kind", label: "", type: "select", options: [["eway", "E-way bill"]], span: 2 }, { name: "invoiceId", label: "Invoice", type: "select", span: 2, options: sales.map(({ inv, party }) => [inv.id, `${inv.number} · ${party.name}`] as [string, string]) }, { name: "transporter", label: "Transporter" }, { name: "vehicle", label: "Vehicle no." }, { name: "distance", label: "Distance (km)", type: "number" }]} /></Card>}</div>
      <Card title="Prepared records" pad={false}><div className="p-3"><table className="tbl"><thead><tr><th>Type</th><th>Invoice</th><th>Status</th><th>Prepared</th><th /></tr></thead><tbody>{er.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Nothing prepared yet.</td></tr>}{er.map((r) => <tr key={r.id}><td>{r.type}</td><td>{r.ref}</td><td><Badge tone="warn">Draft data · not submitted</Badge></td><td className="num">{r.createdAt.toISOString().slice(0, 10)}</td><td><a className="btn btn-sm" href={`/api/tax/draft?type=${r.type}&id=${(r.payload as { invoiceId: string }).invoiceId}`}>Download JSON</a></td></tr>)}</tbody></table></div></Card></div>);
  } else if (tab === "tds") {
    const secs = await db.select().from(tdsSections).where(eq(tdsSections.companyId, ctx.company.id)).orderBy(asc(tdsSections.section));
    const ded = await db.select().from(parties).where(and(eq(parties.companyId, ctx.company.id), isNull(parties.deletedAt)));
    const ent = await db.select().from(tdsEntries).where(eq(tdsEntries.companyId, ctx.company.id));
    const reg = await buildReport(ctx, "tds-register");
    const byQ: Record<string, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }; ent.forEach((e) => { byQ[tdsQuarter(e.date)] += Number(e.tds); });
    const pending = ent.filter((e) => !e.challanId);
    body = (<div className="space-y-4">{banner}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(byQ).map(([q, v]) => <Stat key={q} label={`${q} TDS deducted`} value={inr(v)} sub={q === tdsQuarter(today) ? "current quarter" : undefined} />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Card title="TDS calculator"><TdsCalc sections={secs.map((s) => ({ section: s.section, description: s.description, rateIndividual: s.rateIndividual, rateOther: s.rateOther, singleThreshold: s.singleThreshold, annualThreshold: s.annualThreshold }))} /></Card>
        {canWrite && <Card title="Record TDS deduction" subtitle="Calculated by the TDS engine using the section table and the deductee’s year-to-date payments."><ActionForm submit="Calculate & record" action={recordTdsDeduction} fields={[{ name: "deducteeId", label: "Deductee", type: "select", span: 2, options: ded.filter((x) => x.kind !== "customer").map((x) => [x.id, `${x.name} · PAN ${x.pan ?? "—"}`] as [string, string]) }, { name: "section", label: "Section", type: "select", options: secs.map((s) => [s.section, s.section] as [string, string]) }, { name: "amount", label: "Payment amount", type: "number", required: true }, { name: "date", label: "Date", type: "date", defaultValue: today, required: true }, { name: "post", label: "Also post Dr AP / Cr TDS payable", type: "checkbox", defaultValue: 1, span: 2 }]} /></Card>}</div>
      <Card title="TDS register — deductee-wise" action={<ExportMenu report="tds-register" />} pad={false}><div className="p-3">{reg && <DataTable title="tds-register" columns={reg.columns} rows={reg.rows} />}</div>
        <p className="px-4 pb-3 text-[11px] text-muted">Data support for Forms 26Q/24Q/27Q/27EQ: export this register to prepare the return in the NSDL RPU. Form 16/16A certificates are generated on TRACES — record them under Notices &amp; records.</p></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {canApprove && <Card title="Record challan deposit" subtitle={`Unlinked deductions: ${pending.length} · ₹${inr(pending.reduce((s, e) => s + Number(e.tds), 0))}. Deposit due by ${tdsDepositDue(today)} for this month’s deductions.`}><ActionForm submit="Record challan" action={recordChallan} fields={[{ name: "quarter", label: "Quarter", type: "select", options: [["Q1", "Q1 Apr–Jun"], ["Q2", "Q2 Jul–Sep"], ["Q3", "Q3 Oct–Dec"], ["Q4", "Q4 Jan–Mar"]] }, { name: "amount", label: "Challan amount", type: "number", required: true }, { name: "bsr", label: "BSR code", required: true }, { name: "challanNo", label: "Challan serial no.", required: true }, { name: "date", label: "Deposit date", type: "date", defaultValue: today, required: true }, { name: "post", label: "Post Dr TDS payable / Cr Bank", type: "checkbox" }]} /></Card>}
        <Card title="Section rate configuration" subtitle="Defaults only — update when the law changes. Edits are audit-logged.">{canApprove ? <div className="max-h-96 space-y-3 overflow-auto">{secs.map((s) => <details key={s.id} className="rounded-lg border border-line p-2 text-xs"><summary className="cursor-pointer font-semibold">{s.section} · {s.description} — {s.rateIndividual}%/{s.rateOther}%</summary><div className="mt-2"><ActionForm cols={4} compact submit="Save" action={updateTdsSection} resetOnOk={false} fields={[{ name: "section", label: "Section", defaultValue: s.section }, { name: "rateIndividual", label: "Ind/HUF %", defaultValue: s.rateIndividual }, { name: "rateOther", label: "Other %", defaultValue: s.rateOther }, { name: "singleThreshold", label: "Single txn ₹", defaultValue: s.singleThreshold }, { name: "annualThreshold", label: "Annual ₹", defaultValue: s.annualThreshold, span: 2 }]} /></div></details>)}</div> : <p className="text-xs text-muted">Approver role required to edit.</p>}</Card></div></div>);
  } else if (tab === "itax") {
    body = (<div className="space-y-4">{banner}<Card title="Old vs new regime comparison & advance tax"><IncomeTaxCalc /></Card><Card title="Capital gains calculator"><CapGainsCalc /></Card></div>);
  } else {
    const recs = await db.select().from(complianceRecords).where(and(eq(complianceRecords.companyId, ctx.company.id))).orderBy(desc(complianceRecords.createdAt));
    const rows = recs.filter((r) => ["notice", "form16", "form16a", "challan"].includes(r.type));
    body = (<div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2" title="GST notices, certificates & challans" pad={false}><div className="p-3"><DataTable title="compliance-records" columns={[{ key: "type", label: "Type" }, { key: "ref", label: "Reference" }, { key: "dueDate", label: "Due" }, { key: "status", label: "Status", kind: "tone" }, { key: "note", label: "Note" }]} rows={rows.map((r) => ({ type: r.type, ref: r.ref, dueDate: r.dueDate, status: r.status, note: String((r.payload as { note?: string }).note ?? "") }))} /></div></Card>
      {canWrite && <Card title="Add record" subtitle="Track a notice, Form 16/16A or other item. Notices with due dates feed the calendar."><ActionForm submit="Save" action={addComplianceRecord} fields={[{ name: "type", label: "Type", type: "select", options: [["notice", "GST/IT notice"], ["form16", "Form 16"], ["form16a", "Form 16A"]], span: 2 }, { name: "ref", label: "Reference / DIN", required: true, span: 2 }, { name: "dueDate", label: "Response due", type: "date", span: 2 }, { name: "note", label: "Notes", type: "textarea", span: 2 }]} /></Card>}</div>);
  }
  return (<><PageHeader title="GST, TDS & Income Tax" desc="Indian tax workspace: transparent calculations, draft return data and a compliance calendar." crumbs={[{ label: "Accounting & Compliance" }, { label: "Tax" }]} />{mockGspBanner}<Tabs tabs={TABS} active={tab} base="/tax" />{body}</>);
}
