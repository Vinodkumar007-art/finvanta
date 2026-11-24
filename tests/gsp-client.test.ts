import { afterEach, describe, expect, it, vi } from "vitest";
import { createGspClient } from "@/services/gsp/client";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GSP provider selection", () => {
  it("uses the mock transport and refuses any response without the mock marker", async () => {
    vi.stubEnv("GSP_PROVIDER", "mock");
    vi.stubEnv("GST_ENV", "sandbox");
    vi.stubEnv("GSP_ENV", "sandbox");
    vi.stubEnv("GSP_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("GSP_CLIENT_ID", "test-client");
    vi.stubEnv("GSP_CLIENT_SECRET", "test-secret");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "mock_token", token_type: "Bearer", expires_in: 3600, mock: true }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetcher);

    const client = createGspClient();
    await expect(client.authenticate()).resolves.toMatchObject({ mock: true });
    await expect(client.createDraft({
      period: "2026-10",
      gstin: "27AABCU9603R1ZM",
      lineItems: [{ description: "Supply", taxableValue: 1000, taxRate: 18, igst: 180 }],
    })).rejects.toThrow("did not include mock: true");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("surfaces provider validation failures without retrying", async () => {
    vi.stubEnv("GSP_PROVIDER", "mock");
    vi.stubEnv("GST_ENV", "sandbox");
    vi.stubEnv("GSP_ENV", "sandbox");
    vi.stubEnv("GSP_CLIENT_ID", "test-client");
    vi.stubEnv("GSP_CLIENT_SECRET", "test-secret");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({
      access_token: "mock_token",
      token_type: "Bearer",
      expires_in: 3600,
      mock: true,
    })).mockResolvedValueOnce(Response.json({
      mock: true,
      error: { code: "MOCK_INVALID_DRAFT", message: "Draft payload failed validation." },
    }, { status: 400 }));
    vi.stubGlobal("fetch", fetcher);

    const client = createGspClient();
    await client.authenticate();
    await expect(client.createDraft({
      period: "2026-10",
      gstin: "27AABCU9603R1ZM",
      lineItems: [{ description: "Supply", taxableValue: 1000, taxRate: 18, igst: 180 }],
    })).rejects.toMatchObject({
      name: "GspClientError",
      status: 400,
      message: "Draft payload failed validation.",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("disables ClearTax selection until its documented contract is implemented", () => {
    vi.stubEnv("GSP_PROVIDER", "cleartax");
    expect(() => createGspClient()).toThrow("request/response contract must be confirmed");
  });

  it("blocks mock provider use outside sandbox development", () => {
    vi.stubEnv("GSP_PROVIDER", "mock");
    vi.stubEnv("GSP_ENV", "production");
    vi.stubEnv("GST_ENV", "sandbox");
    expect(() => createGspClient()).toThrow("disabled when NODE_ENV, GST_ENV, or GSP_ENV is production");
  });
});
