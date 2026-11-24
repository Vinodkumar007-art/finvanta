import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, auditLogs, calcLogs } from "@/db/schema";
import { requireCtx } from "@/lib/ctx";
import { Card, PageHeader, Stat } from "@/components/ui";
import DataTable from "@/components/DataTable";
import { llmConfigured } from "@/services/ai/llm";

export const metadata = { title: "Plan & AI Usage" };
export default async function Usage() {
  const ctx = await requireCtx(); const limit = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 500000);
  const daily = await db.select({ day: sql<string>`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`, model: aiUsage.model, mode: aiUsage.mode, msgs: sql<number>`count(*)::int`, prompt: sql<number>`sum(${aiUsage.promptTokens})::int`, completion: sql<number>`sum(${aiUsage.completionTokens})::int` }).from(aiUsage).where(eq(aiUsage.orgId, ctx.org.id)).groupBy(sql`1`, aiUsage.model, aiUsage.mode).orderBy(desc(sql`1`)).limit(60);
  const today = new Date().toISOString().slice(0, 10); const used = daily.filter((d) => d.day === today).reduce((a, d) => a + d.prompt + d.completion, 0);
  const [{ n: calcs }] = await db.select({ n: sql<number>`count(*)::int` }).from(calcLogs).where(eq(calcLogs.orgId, ctx.org.id)); const [{ n: audits }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(eq(auditLogs.orgId, ctx.org.id));
  return (<><PageHeader title="Plan & AI Usage" desc="Subscription plan, AI token monitoring and governance counters." crumbs={[{ label: "Workspace" }, { label: "Usage" }]} />
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Plan" value={ctx.org.plan.toUpperCase()} sub="No payment processor is connected; plans are not billed" /><Stat label="AI tokens today" value={used.toLocaleString("en-IN")} sub={`Daily org budget ${limit.toLocaleString("en-IN")}`} tone={used > limit * 0.8 ? "warn" : undefined} /><Stat label="Calculation audit records" value={String(calcs)} /><Stat label="Audit-trail events" value={String(audits)} /></div>
    <Card title="AI usage by day and model" subtitle={llmConfigured() ? "Provider configuration detected; a live request has not been verified." : "No LLM provider configured — only deterministic engine-mode answers (0 tokens) are served"} pad={false}><div className="p-3"><DataTable title="ai-usage" searchable={false} columns={[{ key: "day", label: "Day" }, { key: "model", label: "Model" }, { key: "mode", label: "Mode" }, { key: "msgs", label: "Messages", kind: "num" }, { key: "prompt", label: "Prompt tokens", kind: "num" }, { key: "completion", label: "Completion tokens", kind: "num" }]} rows={daily} empty="No AI usage yet." /></div></Card>
    <p className="mt-3 text-xs text-muted">Limits: 20 AI messages per 10 minutes per user; daily organisation token budget via <code>AI_DAILY_TOKEN_LIMIT</code>; market-data requests capped per provider per day.</p></>);
}
