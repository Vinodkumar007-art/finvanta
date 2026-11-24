import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";

export const dynamic = "force-dynamic";
const scope = (ctx: { org: { id: string }; user: { id: string } }) => and(eq(notifications.orgId, ctx.org.id), or(isNull(notifications.userId), eq(notifications.userId, ctx.user.id)));

export async function GET(req: Request) {
  const a = await apiCtx(req); if ("error" in a) return a.error;
  return json(await db.select().from(notifications).where(scope(a.ctx)).orderBy(desc(notifications.createdAt)).limit(30));
}
export async function POST(req: Request) {
  const a = await apiCtx(req, { mutate: true }); if ("error" in a) return a.error;
  await db.update(notifications).set({ readAt: new Date() }).where(and(scope(a.ctx), isNull(notifications.readAt)));
  return json({ ok: true });
}
