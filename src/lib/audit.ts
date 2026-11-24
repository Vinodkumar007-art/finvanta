import { db } from "@/db";
import { auditLogs, calcLogs, notifications } from "@/db/schema";
import type { CalcRecord } from "@/engines/core";

type Actor = { org: { id: string }; user: { id: string }; company?: { id: string } | null };
type AuditTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(ctx: Actor, action: string, entity: string, entityId?: string | null, detail: Record<string, unknown> = {}, tx?: AuditTransaction) {
  await (tx ?? db).insert(auditLogs).values({ orgId: ctx.org.id, companyId: ctx.company?.id ?? null, userId: ctx.user.id, action, entity, entityId: entityId ?? null, detail });
}
export async function logCalc(ctx: Actor, rec: CalcRecord) {
  await db.insert(calcLogs).values({ orgId: ctx.org.id, userId: ctx.user.id, name: rec.name, record: rec as unknown as Record<string, unknown> });
}
export async function notify(orgId: string, title: string, body = "", level: "info" | "warning" | "critical" = "info", href?: string, userId?: string) {
  await db.insert(notifications).values({ orgId, userId: userId ?? null, title, body, level, href });
}
