import { describe, expect, it } from "vitest";
import { jobPayloadSchema } from "../src/services/jobs/queue";

describe("background job payload validation", () => {
  it("adds a correlation id and rejects email jobs without content", () => {
    const result = jobPayloadSchema.safeParse({
      type: "send-email",
      requestedBy: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "welcome-1",
      to: "person@example.com",
      subject: "Welcome",
    });

    expect(result.success).toBe(false);
  });

  it("validates job payloads and supplies a correlation id", () => {
    const result = jobPayloadSchema.parse({
      type: "send-email",
      requestedBy: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "welcome-1",
      to: "person@example.com",
      subject: "Welcome",
      text: "Hello",
    });

    expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rejects image jobs without a valid company/year/document scope", () => {
    const result = jobPayloadSchema.safeParse({
      type: "process-image",
      requestedBy: "not-a-uuid",
      idempotencyKey: "image-1",
      companyId: "also-not-a-uuid",
      financialYearId: "not-a-year",
      documentId: "not-a-document",
    });

    expect(result.success).toBe(false);
  });
});
