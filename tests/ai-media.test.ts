import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateOpenRouterImage, listOpenRouterMediaModels, startOpenRouterVideo } from "@/services/ai/openrouter-media";

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "openrouter");
  vi.stubEnv("OPENAI_API_KEY", "test-openrouter-key");
  vi.stubEnv("OPENAI_BASE_URL", "");
  vi.stubEnv("AI_MEDIA_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenRouter media", () => {
  it("does not call OpenRouter while media generation is disabled", async () => {
    vi.stubEnv("AI_MEDIA_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOpenRouterMediaModels("image")).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("Image/video generation is paused"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an insufficient-credit response as an actionable 402 error", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "This account never purchased credits." },
    }), { status: 402, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOpenRouterMediaModels("image")).rejects.toMatchObject({
      name: "OpenRouterMediaError",
      status: 402,
      message: expect.stringContaining("https://openrouter.ai/settings/credits"),
    });
  });

  it("generates an image through the dedicated image endpoint and returns the provider cost", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "image/test", name: "Image test" }],
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ url: "https://storage.openrouter.ai/generated-media/test.png" }],
        usage: { cost: 0.02 },
      }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateOpenRouterImage("image/test", "A watercolor landscape")).resolves.toEqual({
      url: "https://storage.openrouter.ai/generated-media/test.png",
      cost: 0.02,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://openrouter.ai/api/v1/images/models");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://openrouter.ai/api/v1/images");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      model: "image/test",
      prompt: "A watercolor landscape",
      response_format: "url",
    });
  });

  it("uses the current video catalog and rejects unsupported generation settings before submitting", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: "google/veo-test",
          name: "Veo test",
          supported_durations: [4, 6],
          supported_resolutions: ["720p"],
          supported_aspect_ratios: ["16:9"],
        }],
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gen-vid-test_1" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const models = await listOpenRouterMediaModels("video");
    expect(models[0]).toMatchObject({ id: "google/veo-test", durations: [4, 6], resolutions: ["720p"] });
    await expect(startOpenRouterVideo({ model: "google/veo-test", prompt: "A landscape", duration: 8 }))
      .rejects.toThrow("does not support that duration");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(startOpenRouterVideo({
      model: "google/veo-test",
      prompt: "A landscape",
      duration: 6,
      resolution: "720p",
      aspectRatio: "16:9",
    })).resolves.toEqual({ id: "gen-vid-test_1" });
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://openrouter.ai/api/v1/videos");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      model: "google/veo-test",
      prompt: "A landscape",
      duration: 6,
      resolution: "720p",
      aspect_ratio: "16:9",
    });
  });
});
