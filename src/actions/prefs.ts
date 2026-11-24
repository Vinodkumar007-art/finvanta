"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireCtx } from "@/lib/ctx";

export async function saveDashboardLayout(order: string[]) {
  const ctx = await requireCtx();
  const clean = order.filter((s) => /^-?[a-z0-9-]{2,30}$/.test(s)).slice(0, 30);
  await db.insert(userPreferences).values({ userId: ctx.user.id, dashboardLayout: clean }).onConflictDoUpdate({ target: userPreferences.userId, set: { dashboardLayout: clean } });
  void eq;
}
