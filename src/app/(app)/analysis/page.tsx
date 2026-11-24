import { PageHeader, Notice } from "@/components/ui";
import AnalysisLab from "@/components/AnalysisLab";
import { requireCompany, can } from "@/lib/ctx";
import { loadStatements, savedStatements, stmtFromLedger } from "@/services/finance";
import { snapshotLedgerStatement, deleteStatement } from "@/actions/analytics";
import type { Stmt } from "@/engines/ratios";

export const metadata = { title: "Statement Analysis" };

export default async function Analysis() {
  const ctx = await requireCompany(); const saved = await savedStatements(ctx.company.id);
  const live = stmtFromLedger(await loadStatements(ctx));
  const hasLive = (live.revenue ?? 0) > 0 || (live.cash ?? 0) !== 0;
  const periods = [...saved.map((s) => ({ id: s.id, label: s.label, periodEnd: s.periodEnd, kind: s.kind, source: s.source, data: s.data as Stmt })),
    ...(hasLive ? [{ id: "live", label: `${ctx.fy.label} (live ledger)`, periodEnd: ctx.fy.endDate, kind: "annual", source: "ledger", data: live }] : [])].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.label.localeCompare(b.label));
  return (<><PageHeader title="Financial Statement Analysis" desc="A ratio laboratory: every metric shows its formula, the inputs used and a reference range." crumbs={[{ label: "Analysis & Planning" }, { label: "Statement analysis" }]}
    actions={can(ctx.role, "write") && hasLive ? <form action={snapshotLedgerStatement}><button className="btn btn-sm" title="Freeze the current ledger statements as a comparable period">Snapshot live ledger as period</button></form> : undefined} />
    {saved.some((s) => s.source === "demo") && <div className="mb-3"><Notice tone="warn" title="Demo statements present">Periods tagged [DEMO] are fictional figures loaded with demo data, for exploring the lab.</Notice></div>}
    <AnalysisLab periods={periods} canWrite={can(ctx.role, "write")} />
    {saved.length > 0 && can(ctx.role, "approve") && <details className="mt-4 text-xs"><summary className="cursor-pointer text-muted">Manage saved periods</summary><ul className="mt-2 space-y-1">{saved.map((s) => <li key={s.id} className="flex items-center gap-2">{s.label} <span className="text-muted">({s.source})</span><form action={deleteStatement.bind(null, s.id)}><button className="btn btn-sm btn-danger">Delete</button></form></li>)}</ul></details>}</>);
}
