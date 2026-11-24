type UnknownRecord = Record<string, unknown>;

export type OpenRouterMediaModel = {
  id: string;
  label: string;
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
};

type VideoJobStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";

export type OpenRouterVideoJob = {
  id: string;
  status: VideoJobStatus;
  progress?: number;
  videoUrl?: string;
  cost?: number;
  error?: string;
};

export const OPENROUTER_MEDIA_PAUSED_MESSAGE = "Image/video generation is paused. Enable AI_MEDIA_ENABLED=true only when an image/video quota is available.";

export class OpenRouterMediaError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "OpenRouterMediaError";
  }
}

const modelCache = new Map<string, { expiresAt: number; models: OpenRouterMediaModel[] }>();

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openRouterConfig() {
  const provider = (process.env.LLM_PROVIDER ?? process.env.LLM_Provider)?.trim().toLowerCase();
  if (provider !== "openrouter" && provider !== "openrouter.ai") {
    throw new Error("Set LLM_PROVIDER=openrouter to use image and video generation.");
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenRouter media generation.");
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  };
}

async function request(path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = openRouterConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    let detail = body.slice(0, 400);
    try {
      const payload: unknown = JSON.parse(body);
      if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
        detail = payload.error.message.slice(0, 400);
      }
    } catch { /* use the bounded response text */ }
    const message = response.status === 402
      ? "OpenRouter reports insufficient account credits, so this media request was rejected. Add credits at https://openrouter.ai/settings/credits, or configure another provider with an available image/video quota; a text-only free model cannot generate media."
      : `OpenRouter request failed (${response.status}). ${detail}`;
    throw new OpenRouterMediaError(response.status, message);
  }
  return response;
}

export async function listOpenRouterMediaModels(kind: "image" | "video"): Promise<OpenRouterMediaModel[]> {
  if (process.env.AI_MEDIA_ENABLED?.trim().toLowerCase() !== "true") {
    throw new OpenRouterMediaError(503, OPENROUTER_MEDIA_PAUSED_MESSAGE);
  }
  const cached = modelCache.get(kind);
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  const response = await request(kind === "image" ? "/images/models" : "/videos/models");
  const payload: unknown = await response.json();
  const items = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const models = items.flatMap((item): OpenRouterMediaModel[] => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.id;
    const durations = Array.isArray(item.supported_durations)
      ? item.supported_durations.filter((value): value is number => Number.isInteger(value) && Number(value) > 0)
      : [];
    const resolutions = Array.isArray(item.supported_resolutions)
      ? item.supported_resolutions.filter((value): value is string => typeof value === "string")
      : [];
    const aspectRatios = Array.isArray(item.supported_aspect_ratios)
      ? item.supported_aspect_ratios.filter((value): value is string => typeof value === "string")
      : [];
    return [{ id: item.id, label: `${name} (${item.id})`, durations, resolutions, aspectRatios }];
  });
  if (!models.length) throw new Error(`OpenRouter returned no ${kind} generation models.`);
  models.sort((left, right) => left.label.localeCompare(right.label));
  modelCache.set(kind, { models, expiresAt: Date.now() + 10 * 60_000 });
  return models;
}

export async function generateOpenRouterImage(model: string, prompt: string) {
  const models = await listOpenRouterMediaModels("image");
  if (!models.some((option) => option.id === model)) throw new Error("Select an image model from the current OpenRouter catalog.");
  const response = await request("/images", {
    method: "POST",
    body: JSON.stringify({ model, prompt, response_format: "url" }),
  });
  const payload: unknown = await response.json();
  const first = isRecord(payload) && Array.isArray(payload.data) ? payload.data[0] : undefined;
  const url = isRecord(first) && typeof first.url === "string" ? first.url : undefined;
  if (!url || new URL(url).protocol !== "https:") throw new Error("OpenRouter did not return a secure image URL.");
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  const cost = usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : undefined;
  return { url, cost };
}

export async function startOpenRouterVideo(input: {
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
}): Promise<{ id: string }> {
  const models = await listOpenRouterMediaModels("video");
  const modelInfo = models.find((option) => option.id === input.model);
  if (!modelInfo) throw new Error("Select a video model from the current OpenRouter catalog.");
  if (input.duration !== undefined && !modelInfo.durations.includes(input.duration)) {
    throw new Error("The selected video model does not support that duration.");
  }
  if (input.resolution && !modelInfo.resolutions.includes(input.resolution)) {
    throw new Error("The selected video model does not support that resolution.");
  }
  if (input.aspectRatio && !modelInfo.aspectRatios.includes(input.aspectRatio)) {
    throw new Error("The selected video model does not support that aspect ratio.");
  }
  const response = await request("/videos", {
    method: "POST",
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      ...(input.duration ? { duration: input.duration } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    }),
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.id)) {
    throw new Error("OpenRouter returned an invalid video job identifier.");
  }
  return { id: payload.id };
}

export async function getOpenRouterVideoJob(jobId: string): Promise<OpenRouterVideoJob> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(jobId)) throw new Error("Invalid video job identifier.");
  const response = await request(`/videos/${encodeURIComponent(jobId)}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.id !== jobId) throw new Error("OpenRouter returned an invalid video job.");
  const allowedStatuses: VideoJobStatus[] = ["pending", "in_progress", "completed", "failed", "cancelled", "expired"];
  if (typeof payload.status !== "string" || !allowedStatuses.includes(payload.status as VideoJobStatus)) {
    throw new Error("OpenRouter returned an unknown video job status.");
  }
  const urls = Array.isArray(payload.urls) ? payload.urls : [];
  const videoUrl = typeof urls[0] === "string" && new URL(urls[0]).protocol === "https:" ? urls[0] : undefined;
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  const cost = usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : undefined;
  const progress = typeof payload.progress === "number" && Number.isFinite(payload.progress) ? payload.progress : undefined;
  return {
    id: jobId,
    status: payload.status as VideoJobStatus,
    ...(videoUrl ? { videoUrl } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(typeof payload.error === "string" ? { error: payload.error.slice(0, 500) } : {}),
  };
}
