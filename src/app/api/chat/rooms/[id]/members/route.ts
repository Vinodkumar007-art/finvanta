import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chatRoomMembers, chatRooms, memberships, users } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { can } from "@/lib/ctx";

export const dynamic = "force-dynamic";

const addMemberSchema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiCtx(request, { mutate: true });
  if ("error" in auth) return auth.error;
  const { id: roomId } = await params;
  const [room] = await db.select({ id: chatRooms.id, createdBy: chatRooms.createdBy })
    .from(chatRooms)
    .where(and(eq(chatRooms.id, roomId), eq(chatRooms.orgId, auth.ctx.org.id), isNull(chatRooms.deletedAt)))
    .limit(1);
  if (!room) return json({ error: "Room not found." }, 404);
  if (!can(auth.ctx.role, "admin") && room.createdBy !== auth.ctx.user.id) return json({ error: "Only a room creator or administrator may add members." }, 403);

  const body: unknown = await request.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid email." }, 400);
  const [member] = await db.select({ id: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.email, parsed.data.email), eq(memberships.orgId, auth.ctx.org.id), isNull(users.deletedAt)))
    .limit(1);
  if (!member) return json({ error: "That person is not an active member of this organisation." }, 404);
  await db.insert(chatRoomMembers).values({ roomId, userId: member.id }).onConflictDoNothing();
  return json({ ok: true });
}
