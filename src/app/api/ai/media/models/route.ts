import { apiCtx, json } from "@/lib/http";
import { listOpenRouterMediaModels, OpenRouterMediaError, OPENROUTER_MEDIA_PAUSED_MESSAGE } from "@/services/ai/openrouter-media";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await apiCtx(req, { needCompany: true });
  if ("error" in auth) return auth.error;
  if (process.env.AI_MEDIA_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ error: OPENROUTER_MEDIA_PAUSED_MESSAGE }, 503);
  }
  const kind = new URL(req.url).searchParams.get("type");
  if (kind !== "image" && kind !== "video") return json({ error: "Select image or video models." }, 400);
  try {
    return json({ models: await listOpenRouterMediaModels(kind) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Could not load OpenRouter media models." },
      error instanceof OpenRouterMediaError ? error.status : 502,
    );
  }
}
