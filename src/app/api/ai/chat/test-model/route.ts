import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { availableLlmModels, llmConfigured, streamCompletion } from "@/services/ai/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestBody = z.object({
  provider: z.enum(["cloudflare", "gemini", "openai"]),
  model: z.string().trim().min(1).max(200),
});

export async function POST(req: Request) {
  const auth = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const parsed = requestBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  const { provider, model } = parsed.data;

  const limit = rateLimit(`ai-model-test:${ctx.user.id}`, 3, 10 * 60_000);
  if (!limit.ok) return json({ error: `Model test limit reached. Retry in ${limit.retryAfter}s.` }, 429);
  if (!llmConfigured(provider)) return json({ error: `${provider} is not configured on the server.` }, 400);

  try {
    const models = await availableLlmModels(provider);
    if (!models.includes(model)) return json({ error: "Select a model from the current provider catalog." }, 400);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [{ used }] = await db.select({
      used: sql<number>`coalesce(sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens}), 0)::int`,
    }).from(aiUsage).where(and(eq(aiUsage.orgId, ctx.org.id), gte(aiUsage.createdAt, today)));
    const dailyLimit = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 500000);
    if (used >= dailyLimit) {
      return json({ error: `Organisation daily AI token budget (${dailyLimit.toLocaleString()}) reached.` }, 429);
    }

    const result = await streamCompletion({
      provider,
      model,
      messages: [
        { role: "system", content: "This is a provider connectivity test. Do not use tools or provide any other content." },
        { role: "user", content: "Reply with exactly: FINVANTA AI ready" },
      ],
      tools: [],
      onText: () => undefined,
      signal: AbortSignal.timeout(25_000),
    });
    if (!result.content.trim()) return json({ error: "The model returned no text for the connectivity test." }, 502);
    await db.insert(aiUsage).values({
      orgId: ctx.org.id,
      userId: ctx.user.id,
      model: result.model,
      promptTokens: result.usage.prompt,
      completionTokens: result.usage.completion,
      mode: "model_test",
    });
    return json({ ok: true, model: result.model });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The model connectivity test failed." }, 502);
  }
}
