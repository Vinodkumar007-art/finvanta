import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiConversations, aiMessages, aiProposals } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const own = (id: string, ctx: { org: { id: string }; user: { id: string } }) =>
  and(eq(aiConversations.id, id), eq(aiConversations.orgId, ctx.org.id), eq(aiConversations.userId, ctx.user.id), isNull(aiConversations.deletedAt));

export async function GET(req: Request, { params }: P) {
  const a = await apiCtx(req); if ("error" in a) return a.error;
  const { id } = await params;
  const [c] = await db.select().from(aiConversations).where(own(id, a.ctx));
  if (!c) return json({ error: "Not found" }, 404);
  const messages = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.createdAt));
  const ids = messages.flatMap((m) => ((m.meta as { proposalIds?: string[] })?.proposalIds ?? []));
  const proposals = ids.length ? await db.select().from(aiProposals).where(and(inArray(aiProposals.id, ids), eq(aiProposals.orgId, a.ctx.org.id))) : [];
  return json({ conversation: c, messages, proposals });
}

const patch = z.object({ title: z.string().trim().min(1).max(120).optional(), folder: z.string().trim().max(60).nullable().optional() });
export async function PATCH(req: Request, { params }: P) {
  const a = await apiCtx(req, { mutate: true }); if ("error" in a) return a.error;
  const { id } = await params; const p = patch.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return json({ error: "Invalid body" }, 400);
  await db.update(aiConversations).set({ ...p.data, folder: p.data.folder === "" ? null : p.data.folder }).where(own(id, a.ctx));
  return json({ ok: true });
}
export async function DELETE(req: Request, { params }: P) {
  const a = await apiCtx(req, { mutate: true }); if ("error" in a) return a.error;
  const { id } = await params;
  await db.update(aiConversations).set({ deletedAt: new Date() }).where(own(id, a.ctx));
  return json({ ok: true });
}
