import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chatRoomMembers, chatRooms } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { can } from "@/lib/ctx";

export const dynamic = "force-dynamic";

const createRoomSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET(request: Request) {
  const auth = await apiCtx(request);
  if ("error" in auth) return auth.error;
  const rooms = await db.select({ id: chatRooms.id, name: chatRooms.name, createdAt: chatRooms.createdAt })
    .from(chatRooms)
    .innerJoin(chatRoomMembers, eq(chatRoomMembers.roomId, chatRooms.id))
    .where(and(eq(chatRoomMembers.userId, auth.ctx.user.id), eq(chatRooms.orgId, auth.ctx.org.id), isNull(chatRooms.deletedAt)));
  return json({ rooms });
}

export async function POST(request: Request) {
  const auth = await apiCtx(request, { mutate: true });
  if ("error" in auth) return auth.error;
  if (!can(auth.ctx.role, "write")) return json({ error: "Your role cannot create chat rooms." }, 403);
  const body: unknown = await request.json().catch(() => null);
  const parsed = createRoomSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid room." }, 400);

  const room = await db.transaction(async (tx) => {
    const [created] = await tx.insert(chatRooms).values({
      orgId: auth.ctx.org.id,
      name: parsed.data.name,
      createdBy: auth.ctx.user.id,
    }).returning({ id: chatRooms.id, name: chatRooms.name, createdAt: chatRooms.createdAt });
    await tx.insert(chatRoomMembers).values({ roomId: created.id, userId: auth.ctx.user.id });
    return created;
  });
  return json({ room }, 201);
}
