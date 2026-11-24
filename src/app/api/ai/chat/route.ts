import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiConversations, aiMessages, aiProposals, aiUsage } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { AGENTS, systemPrompt, type AgentId } from "@/services/ai/agents";
import { availableLlmModelOptions, availableLlmModels, llmConfigured, llmProvider, llmProviderLabel, llmProvidersForChat, streamCompletion, type ChatMsg, type LlmProvider } from "@/services/ai/llm";
import { TOOL_DEFS, runTool } from "@/services/ai/tools";
import { engineAnswer } from "@/services/ai/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const body = z.object({
  conversationId: z.string().uuid().optional(),
  agent: z.enum(AGENTS.map((a) => a.id) as [AgentId, ...AgentId[]]).default("general"),
  provider: z.enum(["cloudflare", "gemini", "openai"]).optional(),
  model: z.string().max(200).optional(),
  message: z.string().trim().min(1).max(8000),
  attachments: z.array(z.object({ name: z.string().max(200), text: z.string().max(30000) })).max(3).optional(),
  path: z.string().max(100).optional(),
});

const wrapDocs = (docs: { name: string; text: string }[] = []) =>
  docs.map((d) => `\n\n<uploaded_document name="${d.name.replace(/"/g, "")}" trust="untrusted-data">\n${d.text}\n</uploaded_document>`).join("");

const FALLBACK_SAFE_TOOLS = new Set([
  "get_financial_summary", "get_trial_balance", "get_ratios", "get_ageing", "search_documents", "get_market_quote",
  "search_indian_stocks", "get_indian_stock", "compare_indian_stocks",
]);

export async function POST(req: Request) {
  const a = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in a) return a.error;
  const ctx = a.ctx;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  const b = parsed.data;
  const rl = rateLimit(`ai:${ctx.user.id}`, 20, 10 * 60_000);
  if (!rl.ok) return json({ error: `Rate limit reached (20 messages / 10 min). Retry in ${rl.retryAfter}s.` }, 429);

  const dailyLimit = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 500000);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens}),0)::int` }).from(aiUsage).where(and(eq(aiUsage.orgId, ctx.org.id), gte(aiUsage.createdAt, today)));
  if (used >= dailyLimit) return json({ error: `Organisation daily AI token budget (${dailyLimit.toLocaleString()}) reached.` }, 429);

  const provider = b.provider ?? llmProvider();
  if (b.provider && !llmConfigured(b.provider)) {
    return json({ error: `${b.provider} is not configured on the server.` }, 400);
  }
  let models: string[];
  try {
    models = await availableLlmModels(provider);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  // conversation (org + user scoped)
  let convId = b.conversationId;
  if (convId) {
    const [c] = await db.select().from(aiConversations).where(and(eq(aiConversations.id, convId), eq(aiConversations.orgId, ctx.org.id), eq(aiConversations.userId, ctx.user.id), isNull(aiConversations.deletedAt)));
    if (!c) return json({ error: "Conversation not found." }, 404);
  } else {
    const [c] = await db.insert(aiConversations).values({ orgId: ctx.org.id, userId: ctx.user.id, title: b.message.slice(0, 60), agent: b.agent }).returning();
    convId = c.id;
  }
  const conversationId = convId;
  const history = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(desc(aiMessages.createdAt)).limit(14);
  await db.insert(aiMessages).values({ conversationId, role: "user", content: b.message, meta: { attachments: b.attachments ?? [], agent: b.agent, path: b.path } });
  await db.update(aiConversations).set({ updatedAt: new Date(), agent: b.agent }).where(eq(aiConversations.id, conversationId));

  const model = b.model && models.includes(b.model) ? b.model : models[0] ?? "";
  const modelOrder = [
    model,
    ...models.filter((candidate) => candidate !== model && /flash|lite/i.test(candidate)),
    ...models.filter((candidate) => candidate !== model && !/flash|lite/i.test(candidate)),
  ];
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* closed */ } };
      send({ type: "meta", conversationId });
      const toolLog: { name: string; source: string; args: unknown; calc?: unknown }[] = [];
      const proposalIds: string[] = [];
      let full = ""; let usage = { prompt: 0, completion: 0 }; const mode = provider && llmConfigured(provider) ? "llm" : "engine";
      let activeModel = model;
      let textStarted = false;
      const failedModels = new Set<string>();
      try {
        if (mode === "engine") {
          const r = await engineAnswer(b.message, ctx, conversationId);
          for (const t of r.tools) { toolLog.push({ name: t.name, source: t.source, args: {}, calc: t.calc }); send({ type: "tool", name: t.name, source: t.source, calc: t.calc }); }
          send({ type: "notice", text: "Engine mode — no language-model provider is configured, so only deterministic tool answers are available." });
          for (const chunk of r.text.match(/[\s\S]{1,60}/g) ?? []) { full += chunk; send({ type: "text", delta: chunk }); }
        } else {
          const msgs: ChatMsg[] = [{ role: "system", content: systemPrompt(b.agent, { company: ctx.company.name, fy: ctx.fy.label, currency: ctx.company.baseCurrency, path: b.path }) }];
          for (const m of history.reverse()) {
            const att = ((m.meta as { attachments?: { name: string; text: string }[] })?.attachments ?? []).map((d) => ({ name: d.name, text: d.text.slice(0, 8000) }));
            msgs.push(m.role === "user" ? { role: "user", content: m.content + wrapDocs(att) } : { role: "assistant", content: m.content });
          }
          msgs.push({ role: "user", content: b.message + wrapDocs(b.attachments) });
          for (let round = 0; round < 5; round++) {
            const fallbackModels = !textStarted && toolLog.every((tool) => FALLBACK_SAFE_TOOLS.has(tool.name))
              ? modelOrder.filter((candidate) => candidate !== activeModel && !failedModels.has(candidate))
              : [];
            const r = await streamCompletion({
              provider: provider as Exclude<LlmProvider, null>,
              model: activeModel,
              fallbackModels,
              onFallback: (from, to) => {
                failedModels.add(from);
                activeModel = to;
                send({ type: "model", model: to });
                send({ type: "notice", text: `${from} was unavailable; switched to ${to}.` });
              },
              messages: msgs,
              tools: TOOL_DEFS as never,
              onText: (d) => { textStarted = true; full += d; send({ type: "text", delta: d }); },
              signal: req.signal,
            });
            activeModel = r.model;
            usage = { prompt: usage.prompt + r.usage.prompt, completion: usage.completion + r.usage.completion };
            if (!r.toolCalls.length) break;
            msgs.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: c.args || "{}" },
              ...(c.extra_content ? { extra_content: c.extra_content } : {}),
            })) });
            for (const c of r.toolCalls) {
              let args: Record<string, unknown> = {}; try { args = JSON.parse(c.args || "{}"); } catch { /* model produced invalid JSON */ }
              let out: { result: unknown; source: string; calc?: unknown };
              try { out = await runTool(c.name, args, ctx, conversationId); } catch (e) { out = { result: { error: (e as Error).message }, source: c.name }; }
              toolLog.push({ name: c.name, source: out.source, args, calc: out.calc });
              send({ type: "tool", name: c.name, source: out.source, args, calc: out.calc });
              const pid = (out.result as { proposalId?: string })?.proposalId;
              if (pid) { proposalIds.push(pid); const [p] = await db.select().from(aiProposals).where(eq(aiProposals.id, pid)); send({ type: "proposal", proposal: p }); }
              msgs.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out.result).slice(0, 14000) });
            }
          }
        }
        await db.insert(aiMessages).values({ conversationId, role: "assistant", content: full || "(no response)", meta: { tools: toolLog, proposalIds, agent: b.agent, model: mode === "llm" ? activeModel : "engine", usage, mode } });
        await db.insert(aiUsage).values({ orgId: ctx.org.id, userId: ctx.user.id, model: mode === "llm" ? activeModel : "engine", promptTokens: usage.prompt, completionTokens: usage.completion, mode });
        send({ type: "done", usage });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
        if (full) await db.insert(aiMessages).values({ conversationId, role: "assistant", content: full, meta: { error: (e as Error).message, tools: toolLog, proposalIds, agent: b.agent, model: mode === "llm" ? activeModel : "engine", usage, mode } });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

export async function GET() {
  void asc;
  const configuredProviders = llmProvidersForChat();
  const providerOptions = await Promise.all(configuredProviders.map(async (provider) => {
    try {
      return { provider, label: llmProviderLabel(provider), models: await availableLlmModelOptions(provider) };
    } catch (error) {
      return { provider, label: llmProviderLabel(provider), models: [], error: (error as Error).message };
    }
  }));
  const preferred = llmProvider();
  const selected = providerOptions.find((option) => option.provider === preferred && option.models.length > 0)
    ?? providerOptions.find((option) => option.models.length > 0)
    ?? providerOptions[0];
  return json({
    configured: providerOptions.some((option) => option.models.length > 0),
    provider: selected?.provider ?? null,
    models: selected?.models ?? [],
    providers: providerOptions,
    agents: AGENTS.map(({ id, name, focus, starters }) => ({ id, name, focus, starters })),
  });
}
