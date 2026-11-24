import type { ReactNode } from "react";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  if (!ctx.company || !ctx.fy) redirect("/onboarding");
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.orgId, ctx.org.id), or(isNull(notifications.userId), eq(notifications.userId, ctx.user.id)), isNull(notifications.readAt)));
  return (
    <AppShell user={{ name: ctx.user.name, email: ctx.user.email }} orgName={ctx.org.name} role={ctx.role}
      companies={ctx.companies.map((c) => ({ id: c.id, name: c.name }))} companyId={ctx.company.id}
      fys={ctx.fys.map((f) => ({ id: f.id, label: f.label, status: f.status }))} fyId={ctx.fy.id} unread={Number(n)}>
      {children}
    </AppShell>
  );
}
