import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/tax/filings/[draftId]/otp/route";
import { apiCtx } from "@/lib/http";

const { getGstFilingService } = vi.hoisted(() => ({
  getGstFilingService: vi.fn(),
}));

vi.mock("@/lib/ctx", () => ({ can: () => true }));
vi.mock("@/lib/http", () => ({
  apiCtx: vi.fn(),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock("@/services/gst-filing", () => ({
  getGstFilingService,
  gstFilingApiError: (error: unknown) => ({
    status: 500,
    message: error instanceof Error ? error.message : "GST filing operation failed.",
  }),
}));

afterEach(() => vi.resetAllMocks());

describe("GST filing OTP route", () => {
  it.each(["1", "12345", "1234567", "12a456"])("rejects malformed OTP %s before invoking the service", async (code) => {
    vi.mocked(apiCtx).mockResolvedValue({
      ctx: { company: { id: "company-1" }, user: { id: "user-1" }, role: "owner" },
    } as never);

    const response = await POST(
      new Request("http://app.test/api/tax/filings/draft-1/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    if (!response) throw new Error("Expected an API response.");
    expect(response.status).toBe(400);
    expect(getGstFilingService).not.toHaveBeenCalled();
  });
});
