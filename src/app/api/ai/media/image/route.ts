import { z } from "zod";
import { apiCtx, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { generateOpenRouterImage, OpenRouterMediaError, OPENROUTER_MEDIA_PAUSED_MESSAGE } from "@/services/ai/openrouter-media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestBody = z.object({
  model: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(2000),
  confirmCost: z.literal(true),
});

export async function POST(req: Request) {
  const auth = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  if (process.env.AI_MEDIA_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ error: OPENROUTER_MEDIA_PAUSED_MESSAGE }, 503);
  }
  const parsed = requestBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  const { ctx } = auth;
  const limit = rateLimit(`ai-image:${ctx.user.id}`, 4, 10 * 60_000);
  if (!limit.ok) return json({ error: `Image generation limit reached. Retry in ${limit.retryAfter}s.` }, 429);
  try {
    const result = await generateOpenRouterImage(parsed.data.model, parsed.data.prompt);
    return json({ imageUrl: result.url, cost: result.cost });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Image generation failed." },
      error instanceof OpenRouterMediaError ? error.status : 502,
    );
  }
}
