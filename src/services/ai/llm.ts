export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
      extra_content?: { google?: { thought_signature?: string } };
    }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmProvider = "cloudflare" | "gemini" | "openai" | null;

const preferredProvider = () => (process.env.LLM_PROVIDER ?? process.env.LLM_Provider)?.trim().toLowerCase();
const isOpenRouter = () => ["openrouter", "openrouter.ai"].includes(preferredProvider() ?? "");

const hasCloudflareConfig = () => [
  process.env.CLOUDFLARE_API_TOKEN,
  process.env.CLOUDFLARE_ACCOUNT_ID,
  process.env.CLOUDFLARE_MODEL,
  process.env.CLOUDFLARE_MODELS,
  process.env.CLOUDFLARE_AI_GATEWAY_ID,
].some((value) => value?.trim());

export const preferredLlmProvider = (): LlmProvider => {
  const preferred = preferredProvider();
  if (!preferred) return null;
  if (preferred === "openrouter" || preferred === "openrouter.ai") return "openai";
  if (preferred === "cloudflare" || preferred === "gemini" || preferred === "openai") return preferred;
  throw new Error("LLM_PROVIDER must be cloudflare, gemini, openai, or openrouter.");
};

export const llmProvider = (): LlmProvider => preferredLlmProvider()
  ?? (hasCloudflareConfig() ? "cloudflare"
    : process.env.GEMINI_API_KEY?.trim() ? "gemini"
      : process.env.OPENAI_API_KEY?.trim() ? "openai" : null);

export const llmProviderLabel = (provider: Exclude<LlmProvider, null>) =>
  provider === "openai" && isOpenRouter() ? "OpenRouter"
    : provider === "cloudflare" ? "Cloudflare"
      : provider === "gemini" ? "Gemini" : "OpenAI";

export const llmProviders = (): Exclude<LlmProvider, null>[] => {
  const configured: Exclude<LlmProvider, null>[] = [];
  if (hasCloudflareConfig()) configured.push("cloudflare");
  if (process.env.GEMINI_API_KEY?.trim()) configured.push("gemini");
  if (process.env.OPENAI_API_KEY?.trim()) configured.push("openai");
  return configured;
};

export const llmProvidersForChat = (): Exclude<LlmProvider, null>[] => {
  const preferred = preferredLlmProvider();
  return preferred ? [preferred] : llmProviders();
};

export const llmConfigured = (provider?: LlmProvider) =>
  provider ? llmProviders().includes(provider) : llmProviders().length > 0;

const parseModels = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

export type LlmModelOption = { id: string; label: string };

let cachedGeminiModels: { expiresAt: number; models: string[] } | undefined;
let cachedOpenRouterModels: { expiresAt: number; models: LlmModelOption[] } | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openRouterPriceLabel(value: unknown) {
  if (!isRecord(value)) return "pricing unavailable";
  const prompt = Number(value.prompt);
  const completion = Number(value.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return "pricing unavailable";
  if (prompt === 0 && completion === 0) return "free";
  const perMillion = (amount: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(amount * 1_000_000);
  return `USD $${perMillion(prompt)} input / $${perMillion(completion)} output per 1M tokens`;
}

async function openRouterModelCatalog(): Promise<LlmModelOption[]> {
  if (cachedOpenRouterModels && cachedOpenRouterModels.expiresAt > Date.now()) return cachedOpenRouterModels.models;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenRouter model discovery failed (${response.status}).`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error("OpenRouter returned an invalid model catalog.");

  const models = payload.data.flatMap((item): LlmModelOption[] => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length > 200) return [];
    const architecture = isRecord(item.architecture) ? item.architecture : {};
    const modalities = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
    const parameters = Array.isArray(item.supported_parameters) ? item.supported_parameters : [];
    if (!modalities.includes("text") || !parameters.includes("tools")) return [];
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.id;
    return [{ id: item.id, label: `${name} (${item.id}) · ${openRouterPriceLabel(item.pricing)}` }];
  });
  if (!models.length) throw new Error("OpenRouter returned no text models with tool-calling support.");
  models.sort((left, right) => left.id === "openrouter/free" ? -1 : right.id === "openrouter/free" ? 1 : left.label.localeCompare(right.label));
  cachedOpenRouterModels = { models, expiresAt: Date.now() + 10 * 60_000 };
  return models;
}

class ModelProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly outputStarted = false,
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

function isRetryableProviderError(status: number, detail: string, providerStatus?: string) {
  const providerState = providerStatus?.toUpperCase() ?? "";
  if ([404, 408, 429, 500, 502, 503, 504].includes(status)) return true;
  if (/RESOURCE_EXHAUSTED|UNAVAILABLE|OVERLOADED|HIGH.DEMAND/.test(`${providerState} ${detail}`.toUpperCase())) return true;
  const modelUnavailable = /\bmodel\b[\s\S]{0,100}\b(?:not found|does not exist|not supported|unsupported|not available|unavailable|not enabled)\b/i.test(detail)
    || /\b(?:not found|does not exist|not supported|unsupported|not available|unavailable|not enabled)\b[\s\S]{0,100}\bmodel\b/i.test(detail);
  if (status === 400) return modelUnavailable;
  return status === 403 && modelUnavailable;
}

function providerError(status: number, detail: string, provider: LlmProvider, providerStatus?: string) {
  const providerName = provider ? llmProviderLabel(provider) : "AI";
  const message = status === 401 || (provider === "gemini" && status === 400 && /api key|credential/i.test(detail))
    ? `The configured ${providerName} credential was rejected.`
    : status === 429
      ? `Provider rate limit or quota reached. ${detail}`
      : `Model provider error (${status}). ${detail}`;
  return new ModelProviderError(message, isRetryableProviderError(status, detail, providerStatus));
}

function readProviderError(body: string) {
  let detail = body.slice(0, 500);
  let status: string | undefined;
  let code: number | undefined;
  try {
    const payload = JSON.parse(body) as {
      error?: { message?: string; status?: string; code?: number };
      message?: string;
      errors?: { message?: string; code?: number }[];
    } | {
      error?: { message?: string; status?: string; code?: number };
      message?: string;
      errors?: { message?: string; code?: number }[];
    }[];
    const error = Array.isArray(payload) ? payload[0] : payload;
    detail = error?.error?.message ?? error?.message ?? error?.errors?.map((item) => item.message).filter(Boolean).join("; ") ?? detail;
    status = error?.error?.status;
    code = error?.error?.code ?? error?.errors?.[0]?.code;
  } catch { /* provider returned non-JSON error text */ }
  return { detail, status, code };
}

export async function availableLlmModels(provider: LlmProvider = llmProvider()) {
  if (!provider) return [];
  if (provider === "cloudflare") {
    const config = cloudflareConfig();
    const models = parseModels(process.env.CLOUDFLARE_MODELS?.trim() || config.model);
    if (!models.length) throw new Error("Set CLOUDFLARE_MODEL or CLOUDFLARE_MODELS to choose a Cloudflare model.");
    if (!models.includes(config.model)) models.unshift(config.model);
    return models;
  }
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is required to use OpenAI.");
    const configuredModels = process.env.OPENAI_MODELS?.trim();
    if (isOpenRouter() && !configuredModels) return (await openRouterModelCatalog()).map((model) => model.id);
    const defaults = isOpenRouter() ? "openrouter/free" : "gpt-4.1-mini,gpt-4.1,gpt-4o-mini,gpt-4o";
    return parseModels(configuredModels || defaults);
  }

  const manualModels = process.env.GEMINI_MODELS?.trim();
  if (manualModels) return parseModels(manualModels);
  if (cachedGeminiModels && cachedGeminiModels.expiresAt > Date.now()) return cachedGeminiModels.models;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required to discover Gemini models.");

  const models = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message ?? ""; } catch { /* ignore non-JSON provider errors */ }
      throw new Error(`Gemini model discovery failed (${res.status}). ${detail}`);
    }

    const page = await res.json() as {
      models?: { baseModelId?: string; name?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const model of page.models ?? []) {
      if (!model.supportedGenerationMethods?.includes("generateContent")) continue;
      const id = model.baseModelId ?? model.name?.replace(/^models\//, "");
      if (id?.startsWith("gemini-") && !/(?:image|banana|tts|transcribe|robotics|computer-use|omni)/i.test(id)) models.add(id);
    }
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);

  if (models.size === 0) throw new Error("Gemini returned no models that support text generation.");
  const preferred = process.env.GEMINI_MODEL?.trim();
  const available = [...models];
  if (preferred && models.has(preferred)) {
    available.splice(available.indexOf(preferred), 1);
    available.unshift(preferred);
  }
  cachedGeminiModels = { models: available, expiresAt: Date.now() + 5 * 60_000 };
  return available;
};

export async function availableLlmModelOptions(provider: LlmProvider = llmProvider()): Promise<LlmModelOption[]> {
  if (provider === "openai" && isOpenRouter() && !process.env.OPENAI_MODELS?.trim()) {
    return openRouterModelCatalog();
  }
  return (await availableLlmModels(provider)).map((id) => ({ id, label: id }));
}

function cloudflareConfig() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const model = process.env.CLOUDFLARE_MODEL?.trim();
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();

  if (!apiToken || !accountId || !model) {
    throw new Error("Cloudflare AI requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_MODEL.");
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID.");
  }
  if (model.startsWith("@cf/") && !gatewayId) {
    throw new Error("Set CLOUDFLARE_AI_GATEWAY_ID when using a Cloudflare Workers AI (@cf/...) model.");
  }

  return { apiToken, accountId, model, gatewayId };
}

type CompletionOptions = {
  provider?: Exclude<LlmProvider, null>;
  model: string; messages: ChatMsg[]; tools: readonly { name: string; description: string; parameters: unknown }[];
  onText: (delta: string) => void; signal?: AbortSignal;
};

async function streamCompletionOnce(opts: CompletionOptions) {
  const provider = opts.provider ?? llmProvider();
  if (!provider) throw new Error("No language-model provider is configured.");
  const isGemini = provider === "gemini";
  const isOpenRouterRequest = provider === "openai" && isOpenRouter();
  const cloudflare = provider === "cloudflare" ? cloudflareConfig() : null;
  const apiKey = isGemini ? process.env.GEMINI_API_KEY
    : cloudflare ? cloudflare.apiToken : process.env.OPENAI_API_KEY;
  const base = isGemini
    ? "https://generativelanguage.googleapis.com/v1beta/openai"
    : cloudflare
      ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflare.accountId)}/ai/v1`
      : process.env.OPENAI_BASE_URL?.trim() || (isOpenRouterRequest ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  const messages = isGemini
    ? opts.messages.map((message) =>
        message.role === "assistant" && message.content === null ? { ...message, content: "" } : message,
      )
    : opts.messages;
  const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST", signal: opts.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(cloudflare?.gatewayId ? { "cf-aig-gateway-id": cloudflare.gatewayId } : {}),
    },
    body: JSON.stringify({
      model: opts.model, messages, stream: true,
      ...(isGemini ? {} : { stream_options: { include_usage: true } }),
      temperature: 0.2,
      ...(opts.tools.length ? {
        tools: opts.tools.map((t) => ({ type: "function", function: t })),
        tool_choice: "auto",
      } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    const parsedError = readProviderError(body);
    throw providerError(res.status, parsedError.detail, provider, parsedError.status);
  }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = ""; let content = ""; const calls: Record<number, {
    id: string; name: string; args: string; extra_content?: { google?: { thought_signature?: string } };
  }> = {};
  let usage = { prompt: 0, completion: 0 };
  let outputStarted = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new ModelProviderError("Model provider stream ended unexpectedly.", true, outputStarted);
    }
    const { value, done } = chunk; if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        await reader.cancel();
        return { content, toolCalls: Object.values(calls).filter((c) => c.name), usage, model: opts.model };
      }
      try {
        const j = JSON.parse(data);
        if (j.error) {
          const error = j.error as { message?: string; status?: string; code?: number };
          const status = typeof error.code === "number" ? error.code : 502;
          const providerErrorResponse = providerError(status, error.message ?? "Provider stream error.", provider, error.status);
          throw new ModelProviderError(providerErrorResponse.message, providerErrorResponse.retryable, outputStarted);
        }
        if (j.usage) usage = { prompt: j.usage.prompt_tokens ?? 0, completion: j.usage.completion_tokens ?? 0 };
        const d = j.choices?.[0]?.delta; if (!d) continue;
        if (d.content) { outputStarted = true; content += d.content; opts.onText(d.content); }
        if (d.tool_calls?.length) outputStarted = true;
        for (const tc of d.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += tc.function.name; if (tc.function?.arguments) c.args += tc.function.arguments;
          if (tc.extra_content?.google?.thought_signature) {
            c.extra_content = tc.extra_content;
          }
        }
      } catch (e) {
        if (e instanceof ModelProviderError) throw e;
        /* ignore incomplete or malformed stream frames */
      }
    }
  }
  return { content, toolCalls: Object.values(calls).filter((c) => c.name), usage, model: opts.model };
}

/** Streams a completion and tries configured alternatives only before any output is emitted. */
export async function streamCompletion(opts: CompletionOptions & {
  fallbackModels?: readonly string[];
  onFallback?: (from: string, to: string) => void;
}) {
  const candidates = [...new Set([opts.model, ...(opts.fallbackModels ?? [])])];
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      return await streamCompletionOnce({ ...opts, model });
    } catch (e) {
      if (!(e instanceof ModelProviderError) || !e.retryable || e.outputStarted || i === candidates.length - 1) throw e;
      opts.onFallback?.(model, candidates[i + 1]);
    }
  }
  throw new Error("No language-model candidates were available.");
}
