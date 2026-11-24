import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiProposals } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { assertCan } from "@/lib/ctx";
import { postVoucher } from "@/services/posting";
import { audit } from "@/lib/audit";

/** Human approval gate: AI-drafted journal entries are posted ONLY here, by an authorised user. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiCtx(req, { mutate: true, needCompany: true }); if ("error" in a) return a.error;
  const ctx = a.ctx; const { id } = await params;
  const body = z.object({ action: z.enum(["approve", "reject"]) }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return json({ error: "Invalid action" }, 400);
  try { assertCan(ctx, "approve"); } catch (e) { return json({ error: (e as Error).message }, 403); }
  const [p] = await db.select().from(aiProposals).where(and(eq(aiProposals.id, id), eq(aiProposals.orgId, ctx.org.id)));
  if (!p || p.status !== "pending") return json({ error: "Proposal not found or already decided." }, 404);
  if (p.companyId !== ctx.company.id) return json({ error: "Switch to the company this proposal belongs to first." }, 409);
  if (body.data.action === "reject") {
    await db.update(aiProposals).set({ status: "rejected" }).where(eq(aiProposals.id, id));
    await audit(ctx, "ai.proposal.reject", "ai_proposal", id);
    return json({ ok: true, status: "rejected" });
  }
  const pl = p.payload as { date: string; narration: string; lines: { accountId: string; debit: string; credit: string }[] };
  try {
    const v = await postVoucher(ctx, { type: "journal", date: pl.date, narration: `[AI-drafted, user-approved] ${pl.narration}`, lines: pl.lines, source: "ai" });
    await db.update(aiProposals).set({ status: "approved", resultRef: v.number }).where(eq(aiProposals.id, id));
    await audit(ctx, "ai.proposal.approve", "ai_proposal", id, { voucher: v.number });
    return json({ ok: true, status: "approved", voucher: v.number });
  } catch (e) { return json({ error: (e as Error).message }, 400); }
}
