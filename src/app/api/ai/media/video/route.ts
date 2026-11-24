import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getOpenRouterVideoJob, OpenRouterMediaError, OPENROUTER_MEDIA_PAUSED_MESSAGE, startOpenRouterVideo } from "@/services/ai/openrouter-media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const createBody = z.object({
  conversationId: z.string().uuid().optional(),
  model: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(2000),
  duration: z.number().int().positive().optional(),
  resolution: z.string().trim().max(20).optional(),
  aspectRatio: z.string().trim().max(20).optional(),
  confirmCost: z.literal(true),
});

export async function POST(req: Request) {
  const auth = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  if (process.env.AI_MEDIA_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ error: OPENROUTER_MEDIA_PAUSED_MESSAGE }, 503);
  }
  const parsed = createBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  const { ctx } = auth;
  const limit = rateLimit(`ai-video:${ctx.user.id}`, 2, 10 * 60_000);
  if (!limit.ok) return json({ error: `Video generation limit reached. Retry in ${limit.retryAfter}s.` }, 429);

  let conversationId = parsed.data.conversationId;
  if (conversationId) {
    const [conversation] = await db.select({ id: aiConversations.id }).from(aiConversations).where(and(
      eq(aiConversations.id, conversationId),
      eq(aiConversations.orgId, ctx.org.id),
      eq(aiConversations.userId, ctx.user.id),
      isNull(aiConversations.deletedAt),
    ));
    if (!conversation) return json({ error: "Conversation not found." }, 404);
  } else {
    const [conversation] = await db.insert(aiConversations).values({
      orgId: ctx.org.id,
      userId: ctx.user.id,
      title: `Video: ${parsed.data.prompt.slice(0, 45)}`,
      agent: "general",
    }).returning({ id: aiConversations.id });
    conversationId = conversation.id;
  }

  try {
    const job = await startOpenRouterVideo({
      model: parsed.data.model,
      prompt: parsed.data.prompt,
      duration: parsed.data.duration,
      resolution: parsed.data.resolution,
      aspectRatio: parsed.data.aspectRatio,
    });
    await db.insert(aiMessages).values({
      conversationId,
      role: "assistant",
      content: `Video generation started with ${parsed.data.model}.`,
      meta: { mediaKind: "video", mediaJobId: job.id, model: parsed.data.model },
    });
    await db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
    return json({ jobId: job.id, conversationId });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Video generation failed." },
      error instanceof OpenRouterMediaError ? error.status : 502,
    );
  }
}

const statusQuery = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  conversationId: z.string().uuid(),
});

export async function GET(req: Request) {
  const auth = await apiCtx(req, { needCompany: true });
  if ("error" in auth) return auth.error;
  const parsed = statusQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return json({ error: "A valid video job and conversation are required." }, 400);
  const { ctx } = auth;
  const limit = rateLimit(`ai-video-status:${ctx.user.id}`, 20, 60_000);
  if (!limit.ok) return json({ error: `Video status check limit reached. Retry in ${limit.retryAfter}s.` }, 429);
  const { jobId, conversationId } = parsed.data;
  const [conversation] = await db.select({ id: aiConversations.id }).from(aiConversations).where(and(
    eq(aiConversations.id, conversationId),
    eq(aiConversations.orgId, ctx.org.id),
    eq(aiConversations.userId, ctx.user.id),
    isNull(aiConversations.deletedAt),
  ));
  if (!conversation) return json({ error: "Conversation not found." }, 404);
  const messages = await db.select({ meta: aiMessages.meta }).from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, "assistant")))
    .orderBy(desc(aiMessages.createdAt)).limit(50);
  const ownsJob = messages.some((message) => message.meta?.mediaKind === "video" && message.meta.mediaJobId === jobId);
  if (!ownsJob) return json({ error: "Video job not found for this conversation." }, 404);
  try {
    return json(await getOpenRouterVideoJob(jobId));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Could not check video status." },
      error instanceof OpenRouterMediaError ? error.status : 502,
    );
  }
}
