import { afterEach, describe, expect, it, vi } from "vitest";
import { apiCtx } from "@/lib/http";
import { POST } from "@/app/api/tax/filings/[draftId]/submit/route";
import { createGspClient } from "@/services/gsp/client";

const { claimSubmission, createMockClient } = vi.hoisted(() => ({
  claimSubmission: vi.fn(),
  createMockClient: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  apiCtx: vi.fn(),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}));

vi.mock("@/services/gst-filing-store", () => ({
  gstFilingRepository: { claimSubmission },
}));

vi.mock("@/services/gsp/client", () => ({
  GspClientError: class GspClientError extends Error {},
  createGspClient: createMockClient,
}));

vi.mock("@/services/gst-otp-delivery", () => ({
  developmentConsoleOtpDelivery: { send: vi.fn() },
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("GST filing submission route", () => {
  it("rejects a submit without persisted OTP approval before constructing or calling the GSP client", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GST_ENV", "sandbox");
    vi.stubEnv("GSP_PROVIDER", "mock");
    vi.mocked(apiCtx).mockResolvedValue({
      ctx: { company: { id: "company-1" }, user: { id: "user-1" }, role: "owner" },
    } as never);
    claimSubmission.mockRejectedValue(new Error("A verified OTP approval is required before mock submission."));

    const response = await POST(
      new Request("http://app.test/api/tax/filings/draft-1/submit", { method: "POST" }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    if (!response) throw new Error("Expected an API response.");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "A verified OTP approval is required before mock submission." });
    expect(claimSubmission).toHaveBeenCalledTimes(1);
    expect(createMockClient).not.toHaveBeenCalled();
    expect(createGspClient).not.toHaveBeenCalled();
  });

  it("refuses submission when the configured GSP provider is not mock", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GST_ENV", "sandbox");
    vi.stubEnv("GSP_ENV", "sandbox");
    vi.stubEnv("GSP_PROVIDER", "cleartax");
    vi.mocked(apiCtx).mockResolvedValue({
      ctx: { company: { id: "company-1" }, user: { id: "user-1" }, role: "owner" },
    } as never);

    const response = await POST(
      new Request("http://app.test/api/tax/filings/draft-1/submit", { method: "POST" }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    if (!response) throw new Error("Expected an API response.");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("GSP_PROVIDER=mock") });
    expect(claimSubmission).not.toHaveBeenCalled();
    expect(createMockClient).not.toHaveBeenCalled();
  });
});
