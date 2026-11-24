import { requireCompany } from "@/lib/ctx";
import { Card, PageHeader, Tabs } from "@/components/ui";
import CardCarousel from "@/components/CardCarousel";
import PersonalFinance from "@/components/PersonalFinance";
import PrintButton from "@/components/PrintButton";
import ExportMenu from "@/components/ExportMenu";
import { buildReport, REPORTS } from "@/services/reports";
import DataTable from "@/components/DataTable";

export const metadata = { title: "Personal Finance & Learning" };
const TABS = [["personal", "Personal finance"], ["learn", "Learning centre"], ["report", "Custom report builder"]].map(([id, label]) => ({ id, label }));
const LESSONS: [string, string][] = [
  ["Double-entry in one minute", "Every transaction has equal debits and credits. Assets & expenses increase with debits; liabilities, equity & income increase with credits. The trial balance sums all closing balances — if debits ≠ credits, a posting is wrong. Try: post a Journal in Accounting with two lines and watch the Trial Balance."],
  ["Reading a balance sheet", "Assets = Liabilities + Equity. Current items fall due within 12 months. Working capital = current assets − current liabilities. Always check the Cash Flow Statement reconciles to the movement in cash."],
  ["GST: CGST, SGST, IGST", "Within one state the tax splits equally into CGST + SGST; across states it is IGST. Input tax credit offsets output tax in a fixed order (IGST first). GSTR-3B summarises liability; GSTR-2B shows credit your suppliers reported — reconcile them monthly."],
  ["TDS basics", "Payers deduct tax at source on specified payments (sections 194C, 194J …) above thresholds, at rates that rise to 20% if the payee has no PAN. Deposit by the 7th of next month; file quarterly returns; issue Form 16/16A."],
  ["Ratios that matter", "Current ratio (liquidity), debt/equity (leverage), interest cover (EBIT ÷ interest), ROE/ROCE (returns), DSO/DIO/DPO (working capital cycle). One ratio never tells the story — compare over time and against peers."],
  ["DCF intuition", "Value = present value of future free cash flows. The terminal value often dominates, so test WACC and terminal growth in the sensitivity grid. A DCF is only as good as its assumptions."],
  ["XIRR vs CAGR vs TWR", "CAGR ignores interim cash flows. XIRR is the money-weighted annualised return for dated flows. Time-weighted return removes the effect of when you invested, so it compares managers fairly."],
  ["Sharpe, Sortino, drawdown", "Sharpe = excess return ÷ total volatility. Sortino penalises only downside volatility. Max drawdown is the worst peak-to-trough loss — what the journey felt like."],
  ["Old vs new tax regime", "The new regime has lower slab rates but almost no deductions; the old regime allows 80C/80D/HRA etc. Which is cheaper depends on your deductions — use the calculator under Tax → Income tax."],
];
const SECTIONS: [string, string][] = [["profit-loss", "Profit & loss"], ["balance-sheet", "Balance sheet"], ["cash-flow", "Cash flow"], ["trial-balance", "Trial balance"], ["ratios", "Ratios"], ["ageing-receivables", "Receivables ageing"], ["ageing-payables", "Payables ageing"], ["gst-sales", "GST sales register"]];

export default async function Workbench({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const tab = (sp.tab as string) ?? "personal"; let body: React.ReactNode = null;
  if (tab === "personal") body = <Card title="Personal finance workspace" subtitle="Calculators run in your browser; nothing is stored."><PersonalFinance /></Card>;
  else if (tab === "learn") body = (
    <Card title="Financial learning centre" subtitle="Concepts with pointers to the working tools">
      <CardCarousel
        label="Financial learning lessons"
        cards={LESSONS.map(([title, description], index) => ({
          id: `lesson-${index}`,
          content: (
            <article className="h-full min-h-[190px] rounded-lg border border-line bg-bg2 p-4">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>
            </article>
          ),
        }))}
      />
    </Card>
  );
  else {
    const chosen = ([] as string[]).concat((sp.s as string[] | string | undefined) ?? []); const reports = await Promise.all(chosen.filter((c) => SECTIONS.some(([k]) => k === c)).map((c) => buildReport(ctx, c)));
    body = (<div className="space-y-4"><Card title="Custom report builder" subtitle="Pick sections, generate, then print/save as PDF or export each as Excel/CSV."><form className="flex flex-wrap items-center gap-3 text-xs"><input type="hidden" name="tab" value="report" />{SECTIONS.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name="s" value={k} defaultChecked={chosen.includes(k)} />{l}</label>)}<button className="btn btn-primary btn-sm">Generate</button>{chosen.length > 0 && <PrintButton />}</form></Card>
      {reports.map((r) => r && <Card key={r.key} title={r.title} subtitle={r.subtitle} action={<ExportMenu report={r.key} />} pad={false}><div className="p-3"><DataTable title={r.key} columns={r.columns} rows={r.rows} searchable={false} pageSize={60} /></div></Card>)}
      <p className="text-[11px] text-muted">{REPORTS.length} report types are available for export from MIS → BI exports.</p></div>);
  }
  return (<><PageHeader title="Personal Finance, Learning & Reports" desc="Goal planning calculators, a learning centre and a custom report builder." crumbs={[{ label: "Workspace" }, { label: "Workbench" }]} /><Tabs tabs={TABS} active={tab} base="/workbench" />{body}</>);
}
