import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableLlmModelOptions, availableLlmModels, llmConfigured, llmProvider, llmProviderLabel, llmProvidersForChat, streamCompletion } from "@/services/ai/llm";

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "");
  vi.stubEnv("LLM_Provider", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Provider selection", () => {
  it("honors the OpenRouter preference and routes through its compatible endpoint", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter.ai");
    vi.stubEnv("OPENAI_API_KEY", "test-openrouter-key");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("OPENAI_MODELS", "openrouter/free");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_MODEL", "");
    vi.stubEnv("CLOUDFLARE_MODELS", "");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "");

    expect(llmProvider()).toBe("openai");
    expect(llmProviderLabel("openai")).toBe("OpenRouter");
    expect(llmProvidersForChat()).toEqual(["openai"]);
    expect(await availableLlmModels()).toEqual(["openrouter/free"]);

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\ndata: [DONE]\n\n`,
        ));
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    await streamCompletion({
      model: "openrouter/free",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      onText: vi.fn(),
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("discovers tool-capable OpenRouter models without sending the API key to the catalog", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENAI_API_KEY", "test-openrouter-key");
    vi.stubEnv("OPENAI_MODELS", "");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_MODEL", "");
    vi.stubEnv("CLOUDFLARE_MODELS", "");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: [
        {
          id: "openrouter/free",
          name: "Free Models Router",
          architecture: { output_modalities: ["text"] },
          supported_parameters: ["tools"],
          pricing: { prompt: "0", completion: "0" },
        },
        {
          id: "anthropic/claude-test",
          name: "Anthropic: Claude Test",
          architecture: { output_modalities: ["text"] },
          supported_parameters: ["tools"],
          pricing: { prompt: "0.000001", completion: "0.000004" },
        },
        {
          id: "image/test",
          architecture: { output_modalities: ["image"] },
          supported_parameters: ["tools"],
        },
        {
          id: "no-tools/test",
          architecture: { output_modalities: ["text"] },
          supported_parameters: [],
        },
      ],
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const options = await availableLlmModelOptions();

    expect(options).toEqual([
      { id: "openrouter/free", label: "Free Models Router (openrouter/free) · free" },
      { id: "anthropic/claude-test", label: "Anthropic: Claude Test (anthropic/claude-test) · USD $1 input / $4 output per 1M tokens" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Accept: "application/json" });
  });

  it("prefers Gemini when both provider keys are configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_MODELS", "");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GEMINI_MODELS", "gemini-test-1,gemini-test-2");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_MODEL", "");
    vi.stubEnv("CLOUDFLARE_MODELS", "");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "");

    expect(llmProvider()).toBe("gemini");
    expect(llmConfigured()).toBe(true);
    expect(await availableLlmModels()).toEqual(["gemini-test-1", "gemini-test-2"]);
  });

  it("uses Cloudflare when its configuration is present instead of routing its token to OpenAI", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_MODEL", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    vi.stubEnv("CLOUDFLARE_MODELS", "");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "test-gateway");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    expect(llmProvider()).toBe("cloudflare");
    expect(await availableLlmModels()).toEqual(["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
  });

  it("fails closed on partial Cloudflare configuration rather than falling back to OpenAI", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_MODEL", "");
    vi.stubEnv("CLOUDFLARE_MODELS", "");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("GEMINI_API_KEY", "");

    expect(llmProvider()).toBe("cloudflare");
    await expect(availableLlmModels()).rejects.toThrow("Cloudflare AI requires");
  });
});

describe("Cloudflare provider", () => {
  it("streams to Cloudflare's OpenAI-compatible endpoint with server-side credentials", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_MODEL", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    vi.stubEnv("CLOUDFLARE_MODELS", "");
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "test-gateway");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\ndata: [DONE]\n\n`,
        ));
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamCompletion({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      onText: vi.fn(),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1/chat/completions`);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-cloudflare-token",
      "cf-aig-gateway-id": "test-gateway",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", stream: true });
    expect(result.content).toBe("Hello");
  });
});

describe("Gemini provider", () => {
  it("discovers available text-generation models and prefers the configured model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    vi.stubEnv("GEMINI_MODELS", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [
          { baseModelId: "gemini-4-hydrogen", supportedGenerationMethods: ["generateContent"] },
          { baseModelId: "gemini-embedding", supportedGenerationMethods: ["embedContent"] },
          { baseModelId: "gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] },
          { baseModelId: "gemini-nano-banana-2.1", supportedGenerationMethods: ["generateContent"] },
          { baseModelId: "gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
        ],
        nextPageToken: "page-2",
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ baseModelId: "gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }],
      }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(llmProvider()).toBe("gemini");
    expect(llmConfigured()).toBe(true);
    expect(await availableLlmModels()).toEqual(["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-3.6-flash"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("pageSize")).toBe("1000");
    expect(init?.headers).toEqual({ "x-goog-api-key": "test-gemini-key" });
  });

  it("streams through Google's OpenAI-compatible endpoint", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    let requestBody: Record<string, unknown> | undefined;
    let streamCancelled = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\ndata: [DONE]\n\n`,
          ));
        },
        cancel() { streamCancelled = true; },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();

    const result = await streamCompletion({
      model: "gemini-3.8-flash",
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "calc_emi", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call-1", content: "{}" },
      ],
      tools: [],
      onText,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-gemini-key" }) }),
    );
    expect(requestBody?.stream).toBe(true);
    expect(requestBody).not.toHaveProperty("stream_options");
    expect((requestBody?.messages as { content?: string | null }[])[1].content).toBe("");
    expect(streamCancelled).toBe(true);
    expect(result.content).toBe("Hello");
    expect(onText).toHaveBeenCalledWith("Hello");
  });

  it("preserves Gemini thought signatures across tool follow-ups", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const signature = "synthetic-thought-signature";
    const requestBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const event = requestBodies.length === 1
        ? { choices: [{ delta: { tool_calls: [{
            index: 0,
            id: "call-1",
            function: { name: "get_financial_summary", arguments: "{}" },
            extra_content: { google: { thought_signature: signature } },
          }] } }] }
        : { choices: [{ delta: { content: "MIS report ready." } }] };
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`));
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tools = [{ name: "get_financial_summary", description: "Get ledger summary.", parameters: { type: "object" } }];

    const first = await streamCompletion({
      model: "gemini-flash-lite-latest",
      messages: [{ role: "user", content: "Prepare an MIS report." }],
      tools,
      onText: vi.fn(),
    });
    expect(first.toolCalls[0].extra_content?.google?.thought_signature).toBe(signature);

    await streamCompletion({
      model: "gemini-flash-lite-latest",
      messages: [
        { role: "user", content: "Prepare an MIS report." },
        { role: "assistant", content: null, tool_calls: first.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args },
          ...(call.extra_content ? { extra_content: call.extra_content } : {}),
        })) },
        { role: "tool", tool_call_id: "call-1", content: "{\"revenue\":\"1000.00\"}" },
      ],
      tools,
      onText: vi.fn(),
    });

    const followupMessages = requestBodies[1].messages as { tool_calls?: { extra_content?: { google?: { thought_signature?: string } } }[] }[];
    expect(followupMessages[1].tool_calls?.[0].extra_content?.google?.thought_signature).toBe(signature);
  });

  it("tries the next model after an unavailable response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Model overloaded." } }), { status: 503 }))
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "Recovered" } }] })}\n\ndata: [DONE]\n\n`,
            ));
          },
        }), { headers: { "Content-Type": "text/event-stream", "X-Test-Model": body.model } });
      });
    vi.stubGlobal("fetch", fetchMock);
    const onFallback = vi.fn();

    const result = await streamCompletion({
      model: "gemini-pro",
      fallbackModels: ["gemini-flash"],
      messages: [
        { role: "user", content: "Prepare an MIS report." },
        { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "get_financial_summary", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call-1", content: JSON.stringify({ revenue: "1000.00" }) },
      ],
      tools: [],
      onText: vi.fn(),
      onFallback,
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("gemini-pro");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).model).toBe("gemini-flash");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages).toHaveLength(3);
    expect(onFallback).toHaveBeenCalledWith("gemini-pro", "gemini-flash");
    expect(result.model).toBe("gemini-flash");
    expect(result.content).toBe("Recovered");
  });

  it("does not switch models after streamed text has started", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Partial" } }] })}\n\n` +
          `data: ${JSON.stringify({ error: { code: 503, message: "Service unavailable." } })}\n\n`,
        ));
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamCompletion({
      model: "gemini-pro",
      fallbackModels: ["gemini-flash"],
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      onText: vi.fn(),
    })).rejects.toThrow("Model provider error (503). Service unavailable.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not switch models after a tool call has started", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "calc", arguments: "{" } }] } }] })}\n\n` +
          `data: ${JSON.stringify({ error: { code: 503, message: "Service unavailable." } })}\n\n`,
        ));
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamCompletion({
      model: "gemini-pro",
      fallbackModels: ["gemini-flash"],
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      onText: vi.fn(),
    })).rejects.toThrow("Model provider error (503). Service unavailable.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts Gemini errors returned as an array", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify([{ error: { message: "Invalid tool follow-up message." } }]),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamCompletion({
      model: "gemini-4-hydrogen",
      fallbackModels: ["gemini-3.8-flash"],
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      onText: vi.fn(),
    })).rejects.toThrow("Model provider error (400). Invalid tool follow-up message.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
