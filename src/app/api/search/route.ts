import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, aiConversations, documents, parties, vouchers } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiCtx(req, { needCompany: true }); if ("error" in a) return a.error;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/[%_]/g, "").slice(0, 60);
  if (q.length < 2) return json([]);
  const like = `%${q}%`; const cid = a.ctx.company.id; const out: { href: string; label: string; sub: string }[] = [];
  const [v, p, ac, d, c] = await Promise.all([
    db.select().from(vouchers).where(and(eq(vouchers.companyId, cid), isNull(vouchers.deletedAt), or(ilike(vouchers.number, like), ilike(vouchers.narration, like)))).limit(5),
    db.select().from(parties).where(and(eq(parties.companyId, cid), isNull(parties.deletedAt), or(ilike(parties.name, like), ilike(parties.gstin, like)))).limit(5),
    db.select().from(accounts).where(and(eq(accounts.companyId, cid), isNull(accounts.deletedAt), or(ilike(accounts.name, like), ilike(accounts.code, like)))).limit(5),
    db.select().from(documents).where(and(eq(documents.companyId, cid), isNull(documents.deletedAt), ilike(documents.name, like))).limit(4),
    db.select().from(aiConversations).where(and(eq(aiConversations.userId, a.ctx.user.id), isNull(aiConversations.deletedAt), ilike(aiConversations.title, like))).limit(3),
  ]);
  v.forEach((x) => out.push({ href: `/accounting?tab=vouchers&q=${encodeURIComponent(x.number)}`, label: `${x.number} — ${x.narration.slice(0, 50)}`, sub: `Voucher · ${x.date}` }));
  p.forEach((x) => out.push({ href: `/${x.kind === "customer" ? "receivables" : "payables"}?tab=parties`, label: x.name, sub: x.kind }));
  ac.forEach((x) => out.push({ href: `/accounting?tab=ledger&account=${x.id}`, label: `${x.code} ${x.name}`, sub: "Ledger account" }));
  d.forEach((x) => out.push({ href: "/documents", label: x.name, sub: `Document · ${x.docType}` }));
  c.forEach((x) => out.push({ href: `/ai?c=${x.id}`, label: x.title, sub: "AI conversation" }));
  return json(out);
}
