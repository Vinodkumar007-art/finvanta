"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { assertCan, requireCtx } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import type { FormState } from "./auth";

export async function addMember(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCtx(); assertCan(ctx, "admin");
    const p = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "accountant", "analyst", "viewer"]) }).parse(Object.fromEntries(fd));
    const [u] = await db.select().from(users).where(eq(users.email, p.email));
    if (!u) return { error: "No registered user with that email. Ask them to sign up first (invite emails are not configured), then add them here." };
    await db.insert(memberships).values({ orgId: ctx.org.id, userId: u.id, role: p.role }).onConflictDoNothing();
    await audit(ctx, "member.add", "membership", u.id, p); revalidatePath("/settings"); return { ok: `${u.name} added as ${p.role}.` };
  } catch (e) { return { error: (e as Error).message }; }
}
export async function setMemberRole(userId: string, role: string) {
  const ctx = await requireCtx(); assertCan(ctx, "admin");
  if (!["admin", "accountant", "analyst", "viewer"].includes(role) || userId === ctx.user.id) throw new Error("Invalid role change.");
  await db.update(memberships).set({ role }).where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.userId, userId)));
  await audit(ctx, "member.role", "membership", userId, { role }); revalidatePath("/settings");
}
export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireCtx(); const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Enter your name." };
  await db.update(users).set({ name }).where(eq(users.id, ctx.user.id)); revalidatePath("/", "layout"); return { ok: "Profile updated." };
}
