import { PageHeader, Notice } from "@/components/ui";
import CreditStudio from "@/components/CreditStudio";
import { requireCompany, can } from "@/lib/ctx";
import { loadStatements, savedStatements, stmtFromLedger } from "@/services/finance";
import type { Stmt } from "@/engines/ratios";

export const metadata = { title: "Credit & Risk" };
export default async function Credit() {
  const ctx = await requireCompany(); const saved = await savedStatements(ctx.company.id); const live = stmtFromLedger(await loadStatements(ctx));
  const options = [...saved.map((s) => ({ id: s.id, label: s.label, periodEnd: s.periodEnd, data: s.data as Stmt })), ...((live.revenue ?? 0) > 0 ? [{ id: "live", label: `${ctx.fy.label} (live ledger)`, periodEnd: ctx.fy.endDate, data: live }] : [])].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return (<><PageHeader title="Credit & Risk Analysis" desc="Borrower assessment with explainable scoring, DSCR, Altman Z, Piotroski F, EMI schedules and a credit memorandum generator." crumbs={[{ label: "Analysis & Planning" }, { label: "Credit" }]} />
    <div className="mb-4"><Notice tone="warn" title="Decision support only">Scores are illustrative, rule-based and fully explained. They are not a credit decision or guarantee. Borrower statements can be loaded from your ledger, saved periods, or pasted from a spreadsheet; upload source documents in Document Intelligence for the audit file.</Notice></div>
    <CreditStudio options={options} canWrite={can(ctx.role, "write")} /></>);
}
