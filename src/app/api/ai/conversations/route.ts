import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiCtx(req); if ("error" in a) return a.error;
  const q = new URL(req.url).searchParams.get("q")?.trim().replace(/[%_]/g, "");
  const base = and(eq(aiConversations.orgId, a.ctx.org.id), eq(aiConversations.userId, a.ctx.user.id), isNull(aiConversations.deletedAt));
  const rows = await db.select({ id: aiConversations.id, title: aiConversations.title, agent: aiConversations.agent, folder: aiConversations.folder, updatedAt: aiConversations.updatedAt })
    .from(aiConversations)
    .where(q ? and(base, or(ilike(aiConversations.title, `%${q}%`), sql`exists (select 1 from ai_messages m where m.conversation_id = ${aiConversations.id} and m.content ilike ${"%" + q + "%"})`)) : base)
    .orderBy(desc(aiConversations.updatedAt)).limit(100);
  return json(rows);
}
