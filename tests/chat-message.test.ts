import { describe, expect, it } from "vitest";
import { encodeChatCursor, parseChatCursor, sanitizeChatMessage } from "@/services/chat-message";

describe("chat message helpers", () => {
  it("normalizes plain text and removes markup delimiters and control characters", () => {
    expect(sanitizeChatMessage("  <script>alert(1)</script>\u0000  ")).toBe("scriptalert(1)/script");
    expect(sanitizeChatMessage(" \u0000 \t ")).toBeNull();
    expect(sanitizeChatMessage("x".repeat(4001))).toBeNull();
  });

  it("round-trips stable history cursors and rejects malformed cursors", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseChatCursor(encodeChatCursor(date, id))).toEqual({ createdAt: date, id });
    expect(parseChatCursor("not-a-cursor")).toBeNull();
  });
});
