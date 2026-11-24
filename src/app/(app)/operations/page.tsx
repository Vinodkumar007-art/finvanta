import Link from "next/link";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { ArrowRight, ArrowUpRight, Bot, FileSearch, Landmark, ReceiptText, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { db } from "@/db";
import { aiProposals, bankTransactions, documents, invoices } from "@/db/schema";
import { can, requireCompany } from "@/lib/ctx";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Operations Hub" };

type QueueItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  href: string;
  createdAt: Date;
  amount?: string | null;
};

function QueueCard({ title, description, count, href, icon: Icon, tone }: {
  title: string;
  description: string;
  count: number;
  href: string;
  icon: typeof FileSearch;
  tone: string;
}) {
  return (
    <Link href={href} className="group block rounded-xl border border-line bg-panel p-4 transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl border border-line ${tone}`}><Icon size={18} aria-hidden="true" /></span>
        <span className="num rounded-lg bg-panel2 px-2.5 py-1 text-sm font-semibold">{count}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-1 min-h-9 text-xs leading-relaxed text-muted">{description}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">Open queue <ArrowUpRight size={13} aria-hidden="true" /></span>
    </Link>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  return (
    <Link href={item.href} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-panel2/70">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{item.detail} · {item.createdAt.toLocaleDateString("en-IN")}</span>
      </span>
      {item.amount && <span className="num text-xs">{item.amount}</span>}
      <Badge tone={item.status === "needs ocr" || item.status === "needs review" ? "warn" : "neutral"}>{item.status}</Badge>
    </Link>
  );
}

export default async function OperationsPage() {
  const ctx = await requireCompany();
  const canApprove = can(ctx.role, "approve");
  const pendingInvoiceWhere = and(
    eq(invoices.companyId, ctx.company.id),
    eq(invoices.fyId, ctx.fy.id),
    eq(invoices.status, "pending_approval"),
    isNull(invoices.deletedAt),
  );
  const reviewDocumentWhere = and(
    eq(documents.companyId, ctx.company.id),
    inArray(documents.status, ["uploaded", "extracted", "needs_ocr"]),
    isNull(documents.deletedAt),
  );
  const readyDocumentWhere = and(
    eq(documents.companyId, ctx.company.id),
    eq(documents.status, "confirmed"),
    isNull(documents.deletedAt),
  );
  const unmatchedBankWhere = and(
    eq(bankTransactions.companyId, ctx.company.id),
    eq(bankTransactions.status, "unmatched"),
  );
  const pendingProposalWhere = and(
    eq(aiProposals.companyId, ctx.company.id),
    eq(aiProposals.orgId, ctx.org.id),
    eq(aiProposals.status, "pending"),
  );

  const invoiceApprovalCounts = await db.select({ kind: invoices.kind, count: count() }).from(invoices).where(pendingInvoiceWhere).groupBy(invoices.kind);
  const salesApprovalCount = Number(invoiceApprovalCounts.find((row) => row.kind === "sales")?.count ?? 0);
  const purchaseApprovalCount = Number(invoiceApprovalCounts.find((row) => row.kind === "purchase")?.count ?? 0);
  const invoiceApprovalCount = salesApprovalCount + purchaseApprovalCount;

  const [pendingInvoices, documentsToReview, readyDocuments, unmatchedBank, pendingProposals] = await Promise.all([
    db.select({ id: invoices.id, kind: invoices.kind, number: invoices.number, date: invoices.date, total: invoices.total, createdAt: invoices.createdAt }).from(invoices).where(pendingInvoiceWhere).orderBy(desc(invoices.createdAt)).limit(5),
    db.select({ id: documents.id, name: documents.name, status: documents.status, createdAt: documents.createdAt }).from(documents).where(reviewDocumentWhere).orderBy(desc(documents.createdAt)).limit(5),
    db.select({ id: documents.id, name: documents.name, status: documents.status, createdAt: documents.createdAt }).from(documents).where(readyDocumentWhere).orderBy(desc(documents.createdAt)).limit(5),
    db.select({ id: bankTransactions.id, description: bankTransactions.description, date: bankTransactions.date, debit: bankTransactions.debit, credit: bankTransactions.credit }).from(bankTransactions).where(unmatchedBankWhere).orderBy(desc(bankTransactions.date)).limit(5),
    db.select({ id: aiProposals.id, conversationId: aiProposals.conversationId, kind: aiProposals.kind, createdAt: aiProposals.createdAt }).from(aiProposals).where(pendingProposalWhere).orderBy(desc(aiProposals.createdAt)).limit(5),
  ]);
  const [documentReviewCount] = await db.select({ count: count() }).from(documents).where(reviewDocumentWhere);
  const [readyDocumentCount] = await db.select({ count: count() }).from(documents).where(readyDocumentWhere);
  const [bankCount] = await db.select({ count: count() }).from(bankTransactions).where(unmatchedBankWhere);
  const [proposalCount] = await db.select({ count: count() }).from(aiProposals).where(pendingProposalWhere);

  const queue: QueueItem[] = [
    ...documentsToReview.map((doc) => ({
      id: `doc-${doc.id}`,
      title: doc.name,
      detail: "Document review",
      status: doc.status.replaceAll("_", " "),
      href: `/documents?id=${doc.id}`,
      createdAt: doc.createdAt,
    })),
    ...readyDocuments.map((doc) => ({
      id: `ready-${doc.id}`,
      title: doc.name,
      detail: "Verified fields · ready for posting",
      status: "confirmed",
      href: `/documents?id=${doc.id}`,
      createdAt: doc.createdAt,
    })),
    ...pendingInvoices.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      title: `${invoice.kind === "sales" ? "Sales invoice" : "Purchase bill"} ${invoice.number}`,
      detail: `Approval · ${invoice.date}`,
      status: "pending approval",
      href: invoice.kind === "sales" ? "/receivables" : "/payables",
      createdAt: invoice.createdAt,
      amount: `${ctx.company.baseCurrency} ${Number(invoice.total).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
    })),
    ...unmatchedBank.map((transaction) => ({
      id: `bank-${transaction.id}`,
      title: transaction.description,
      detail: `Bank reconciliation · ${transaction.date}`,
      status: "unmatched",
      href: "/banking",
      createdAt: new Date(`${transaction.date}T00:00:00`),
      amount: `${ctx.company.baseCurrency} ${Number(transaction.debit || transaction.credit).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
    })),
    ...pendingProposals.filter((proposal) => proposal.conversationId).map((proposal) => ({
      id: `proposal-${proposal.id}`,
      title: "AI journal entry draft",
      detail: "Human approval required",
      status: "pending approval",
      href: `/ai?c=${proposal.conversationId}`,
      createdAt: proposal.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8);

  const totalActions = invoiceApprovalCount
    + Number(documentReviewCount?.count ?? 0)
    + Number(readyDocumentCount?.count ?? 0)
    + Number(bankCount?.count ?? 0)
    + Number(proposalCount?.count ?? 0);

  return (
    <>
      <PageHeader
        title="Operations Hub"
        desc="A FINVANTA workspace for moving finance work from documents and transactions through review, reconciliation and approval."
        crumbs={[{ label: "Command" }, { label: "Operations Hub" }]}
        actions={<Link href="/ai" className="btn btn-primary"><Sparkles size={14} aria-hidden="true" /> Ask FINVANTA AI</Link>}
      />

      <section className="mb-5 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.4fr)_minmax(250px,0.6fr)] md:items-center md:p-7">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
              <Workflow size={13} aria-hidden="true" /> Finance workflow command
            </div>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight md:text-3xl">Keep finance work moving. Keep every decision yours.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Capture source documents, review extracted fields, reconcile bank activity and approve entries in one place. FINVANTA AI can assist with analysis; it does not post to your books without an authorised human approval.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/documents" className="btn btn-primary"><FileSearch size={14} aria-hidden="true" /> Review documents</Link>
              <Link href="/accounting?tab=new" className="btn">Create voucher <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-panel2/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Current work queue</div>
                <div className="num mt-1 text-3xl font-semibold">{totalActions}</div>
              </div>
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><ShieldCheck size={20} aria-hidden="true" /></span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Items needing attention for {ctx.company.name}. Review and approve actions in their source modules.
            </p>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-up" /> {ctx.fy.label} · {ctx.role} access
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line md:grid-cols-4">
          <div className="border-r border-line p-3.5"><Stat label="Documents to review" value={String(Number(documentReviewCount?.count ?? 0))} sub="Extraction or OCR check" /></div>
          <div className="border-r border-line p-3.5"><Stat label="Invoices awaiting approval" value={String(invoiceApprovalCount)} sub={ctx.fy.label} /></div>
          <div className="border-r border-line p-3.5"><Stat label="Bank lines unmatched" value={String(Number(bankCount?.count ?? 0))} sub="Reconciliation queue" /></div>
          <div className="p-3.5"><Stat label="AI drafts awaiting review" value={String(Number(proposalCount?.count ?? 0))} sub="Never auto-posted" /></div>
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-sm font-semibold">Work queues</h2><p className="mt-0.5 text-xs text-muted">Live counts from this company’s records.</p></div>
          {!canApprove && <Badge tone="warn">Read-only approval access</Badge>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <QueueCard title="Documents" description="Review extracted fields and OCR requirements before confirming." count={Number(documentReviewCount?.count ?? 0)} href="/documents" icon={FileSearch} tone="bg-blue-500/10 text-blue-400" />
          <QueueCard title="Ready to post" description="Open confirmed documents and post only after verification." count={Number(readyDocumentCount?.count ?? 0)} href="/documents" icon={ReceiptText} tone="bg-teal-500/10 text-teal-400" />
          <QueueCard title="Bank reconciliation" description="Match imported statement lines to ledger vouchers." count={Number(bankCount?.count ?? 0)} href="/banking" icon={Landmark} tone="bg-amber-500/10 text-amber-400" />
          <QueueCard title="Sales approvals" description="Review sales invoices awaiting approval." count={salesApprovalCount} href="/receivables" icon={ShieldCheck} tone="bg-violet-500/10 text-violet-400" />
          <QueueCard title="Purchase bill approvals" description="Review vendor bills awaiting approval." count={purchaseApprovalCount} href="/payables" icon={ReceiptText} tone="bg-orange-500/10 text-orange-400" />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <Card title="Next actions" subtitle="Recent items across your existing FINVANTA workflows." pad={false}>
          {queue.length ? <div>{queue.map((item) => <QueueRow key={item.id} item={item} />)}</div> : <div className="p-4"><Empty title="All caught up">No documents, invoices, bank lines, or AI drafts currently require review.</Empty></div>}
          {queue.length > 0 && <div className="border-t border-line px-4 py-2.5 text-[10px] text-muted">Queue entries link to their existing modules. Approval and posting permissions are enforced there.</div>}
        </Card>
        <div className="space-y-4">
          <Card title="AI with human checkpoints" subtitle="Use assistance without surrendering control.">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><Bot size={17} aria-hidden="true" /></span>
              <div>
                <p className="text-xs leading-relaxed text-muted">Ask FINVANTA AI to explain ledger figures or draft a journal proposal. Proposals stay pending until an authorised user approves them.</p>
                <Link href="/ai" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">Open FINVANTA AI <ArrowRight size={13} aria-hidden="true" /></Link>
              </div>
            </div>
          </Card>
          <Card title="Connected workflows" subtitle="Existing FINVANTA modules, working together.">
            <div className="space-y-2">
              {[
                { label: "Accounting & ledger", href: "/accounting", detail: "Vouchers, ledgers and reports" },
                { label: "Receivables & payables", href: "/receivables", detail: "Invoice review and ageing" },
                { label: "Banking", href: "/banking", detail: "Import, match and reconcile" },
                { label: "Tax workspace", href: "/tax", detail: "Calculations and draft returns" },
                { label: "Document intelligence", href: "/documents", detail: "Extract, verify and post" },
              ].map((item) => <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-lg border border-line/70 px-3 py-2 transition hover:border-accent/40 hover:bg-panel2/70"><span><span className="block text-xs font-medium">{item.label}</span><span className="text-[10px] text-muted">{item.detail}</span></span><ArrowUpRight size={14} className="text-muted" aria-hidden="true" /></Link>)}
            </div>
          </Card>
        </div>
      </div>
      <p className="mt-4 text-[10px] leading-relaxed text-muted">FINVANTA currently works with its own company ledger and uploaded records. External ERP connections, unattended posting, and messaging integrations are not enabled by this workspace.</p>
    </>
  );
}
