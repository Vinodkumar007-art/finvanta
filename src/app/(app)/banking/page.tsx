import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankTransactions } from "@/db/schema";
import { requireCompany, can } from "@/lib/ctx";
import { Badge, Card, Empty, Notice, PageHeader, Stat, inr } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExportMenu from "@/components/ExportMenu";
import ActionForm from "@/components/ActionForm";
import { BarsChart } from "@/components/Charts";
import { addBankAccount, autoReconcile, importStatement, postFromTxn, setTxnStatus } from "@/actions/banking";
import { D } from "@/engines/core";
import { getBalances } from "@/services/finance";

export const metadata = { title: "Banking & Reconciliation" };

export default async function Banking({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCompany(); const sp = await searchParams; const canWrite = can(ctx.role, "write"), canApprove = can(ctx.role, "approve");
  const banks = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, ctx.company.id), isNull(bankAccounts.deletedAt)));
  const sel = banks.find((b) => b.id === sp.acct) ?? banks[0];
  const accs = await db.select().from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt))).orderBy(asc(accounts.code));
  const txns = sel ? await db.select().from(bankTransactions).where(eq(bankTransactions.bankAccountId, sel.id)).orderBy(desc(bankTransactions.date)) : [];
  const by = (s: string) => txns.filter((t) => t.status === s);
  const unmatched = by("unmatched"); const sum = (xs: typeof txns, k: "debit" | "credit") => xs.reduce((s, t) => s.plus(t[k]), D(0));
  const bals = await getBalances(ctx); const ledger = sel?.ledgerAccountId ? bals.find((b) => b.id === sel.ledgerAccountId) : null;
  const ledgerClosing = ledger ? D(ledger.prior).plus(ledger.dr).minus(ledger.cr) : null;
  const stmtNet = sum(txns.filter((t) => t.status !== "duplicate"), "credit").minus(sum(txns.filter((t) => t.status !== "duplicate"), "debit"));
  const monthly = new Map<string, { m: string; Inflow: number; Outflow: number }>();
  txns.filter((t) => t.status !== "duplicate").forEach((t) => { const m = t.date.slice(0, 7); const e = monthly.get(m) ?? { m, Inflow: 0, Outflow: 0 }; e.Inflow += Number(t.credit); e.Outflow += Number(t.debit); monthly.set(m, e); });
  const dupSuspects = new Map<string, number>(); txns.forEach((t) => { const k = `${t.date}|${t.debit}|${t.credit}`; dupSuspects.set(k, (dupSuspects.get(k) ?? 0) + 1); });
  const suspects = txns.filter((t) => (dupSuspects.get(`${t.date}|${t.debit}|${t.credit}`) ?? 0) > 1 && t.status !== "duplicate");
  const byCat = new Map<string, number>(); txns.forEach((t) => byCat.set(t.category ?? "Uncategorised", (byCat.get(t.category ?? "Uncategorised") ?? 0) + Number(t.debit)));

  return (<><PageHeader title="Banking & Reconciliation" desc="User-uploaded statements only — FINVANTA does not connect to banks or hold banking credentials." crumbs={[{ label: "Accounting & Compliance" }, { label: "Banking" }]} actions={<ExportMenu report="bank-transactions" formats={["xlsx", "csv"]} />} />
    <div className="mb-4 flex flex-wrap gap-2">{banks.map((b) => <a key={b.id} href={`?acct=${b.id}`} className={`btn ${b.id === sel?.id ? "btn-primary" : ""}`}>{b.name} ····{b.last4}</a>)}</div>
    {!sel ? <div className="grid gap-4 lg:grid-cols-2"><Empty title="No bank account yet">Add an account, then import a CSV/Excel statement to categorise and reconcile.</Empty>{canWrite && <Card title="Add bank account"><ActionForm submit="Add account" action={addBankAccount} fields={[{ name: "name", label: "Account nickname", required: true }, { name: "bankName", label: "Bank" }, { name: "last4", label: "Last 4 digits" }, { name: "ledger", label: "Ledger", type: "select", options: accs.filter((a) => a.role === "bank").map((a) => [a.id, a.name] as [string, string]) }]} /></Card>}</div> : (<div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Stat label="Statement net movement" value={inr(stmtNet.toNumber(), 2)} sub="Credits − debits (excl. duplicates)" /><Stat label="Ledger closing (Dr+)" value={ledgerClosing ? inr(ledgerClosing.toNumber(), 2) : "—"} sub="Linked bank ledger" /><Stat label="Matched" value={String(by("matched").length + by("posted").length)} tone="up" /><Stat label="Unmatched" value={String(unmatched.length)} sub={`Dr ${inr(sum(unmatched, "debit").toNumber())} / Cr ${inr(sum(unmatched, "credit").toNumber())}`} tone={unmatched.length ? "warn" : undefined} /><Stat label="Duplicates flagged" value={String(by("duplicate").length)} tone={by("duplicate").length ? "down" : undefined} /></div>
      <div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2" title="Cash-flow monitor"><BarsChart height={220} data={[...monthly.values()].sort((a, b) => a.m.localeCompare(b.m)).map((x) => ({ ...x, Inflow: Math.round(x.Inflow), Outflow: Math.round(x.Outflow) }))} x="m" series={[{ key: "Inflow" }, { key: "Outflow", color: "#94a3b8" }]} /></Card>
        <Card title="Spend by auto-category" subtitle="Rule-based; verify"><ul className="space-y-1 text-xs">{[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="num">{inr(v)}</span></li>)}</ul></Card></div>
      <div className="grid gap-4 lg:grid-cols-3">{canWrite && <Card title="Import statement"><ActionForm submit="Import" action={importStatement} fields={[{ name: "bankAccountId", label: "Account", type: "select", span: 2, defaultValue: sel.id, options: banks.map((b) => [b.id, b.name] as [string, string]) }, { name: "file", label: "CSV or XLSX statement", type: "file", span: 2, required: true, accept: ".csv,.xlsx", hint: "Needs Date + Narration columns and Debit/Credit (or Amount) columns. Re-importing the same file flags duplicates." }]} /></Card>}
        {canWrite && <Card title="Reconciliation" subtitle="Auto-match: same amount & side on the bank ledger within ±3 days, one-to-one."><form action={autoReconcile.bind(null, sel.id)}><button className="btn btn-primary">Run auto-reconcile</button></form><p className="mt-2 text-[11px] text-muted">Remaining unmatched items need a voucher (below) or investigation.</p></Card>}
        {canApprove && unmatched.length > 0 && <Card title="Post unmatched item"><ActionForm submit="Post voucher" action={postFromTxn} fields={[{ name: "txnId", label: "Transaction", type: "select", span: 2, options: unmatched.map((t) => [t.id, `${t.date} · ${t.description.slice(0, 30)} · ${Number(t.debit) ? "Dr " + t.debit : "Cr " + t.credit}`] as [string, string]) }, { name: "accountId", label: "Counter ledger", type: "select", span: 2, options: accs.filter((a) => a.id !== sel.ledgerAccountId).map((a) => [a.id, `${a.code} ${a.name}`] as [string, string]) }]} /></Card>}</div>
      {suspects.length > 0 && <Notice tone="warn" title={`${suspects.length} possible duplicate lines`}>Same date and amount appear more than once: {suspects.slice(0, 4).map((s) => `${s.date} ${inr(Number(s.debit) || Number(s.credit), 2)}`).join("; ")}. Could be legitimate — review.</Notice>}
      <Card title={`Transactions — ${sel.name}`} pad={false}><div className="overflow-auto"><table className="tbl"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="r">Debit</th><th className="r">Credit</th><th>Status</th><th /></tr></thead><tbody>{txns.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">No transactions imported.</td></tr>}
        {txns.slice(0, 300).map((t) => <tr key={t.id}><td className="num">{t.date}</td><td className="max-w-xs truncate" title={t.description}>{t.description}</td><td className="text-muted">{t.category}</td><td className="r num">{Number(t.debit) ? inr(t.debit, 2) : ""}</td><td className="r num">{Number(t.credit) ? inr(t.credit, 2) : ""}</td><td><Badge tone={t.status === "unmatched" ? "warn" : t.status === "duplicate" ? "down" : t.status === "ignored" ? "neutral" : "up"}>{t.status}</Badge></td>
          <td>{canWrite && t.status === "unmatched" && <form action={setTxnStatus.bind(null, t.id, "ignored")}><button className="btn btn-sm">Ignore</button></form>}{canWrite && ["ignored", "matched"].includes(t.status) && <form action={setTxnStatus.bind(null, t.id, "unmatched")}><button className="btn btn-sm">Unmatch</button></form>}</td></tr>)}</tbody></table></div></Card>
      {canWrite && <Card title="Add another bank account"><ActionForm submit="Add account" action={addBankAccount} cols={4} fields={[{ name: "name", label: "Nickname", required: true }, { name: "bankName", label: "Bank" }, { name: "last4", label: "Last 4" }, { name: "ledger", label: "Ledger", type: "select", options: accs.filter((a) => ["bank", "cash"].includes(a.role)).map((a) => [a.id, a.name] as [string, string]) }]} /></Card>}</div>)}</>);
}
