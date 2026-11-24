import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";

export async function GET(req: Request) {
  const a = await apiCtx(req); if ("error" in a) return a.error;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const [c] = await db.select().from(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.orgId, a.ctx.org.id), eq(aiConversations.userId, a.ctx.user.id), isNull(aiConversations.deletedAt)));
  if (!c) return json({ error: "Not found" }, 404);
  const ms = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.createdAt));
  const md = [`# ${c.title}`, `_Agent: ${c.agent} · Exported ${new Date().toISOString()} · FINVANTA AI output is decision support, not professional advice._`, ""]
    .concat(ms.flatMap((m) => [`## ${m.role === "user" ? "You" : "FINVANTA AI"}`, m.content, ""])).join("\n");
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="finvanta-${id.slice(0, 8)}.md"` } });
}
