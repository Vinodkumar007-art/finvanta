import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai/attach/route";

vi.mock("@/lib/http", () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}));

describe("AI file attachment route", () => {
  it("rejects attachments until secure storage and scanning are integrated", async () => {
    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "File attachments are disabled until secure storage and antivirus scanning are configured and integrated.",
    });
  });
});
