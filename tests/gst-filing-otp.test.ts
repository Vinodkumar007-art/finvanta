import { describe, expect, it } from "vitest";
import {
  canRequestOtp,
  createOtpCode,
  evaluateOtpAttempt,
  hashOtpCode,
  isGstApprovalFresh,
  matchesOtpCode,
} from "@/services/gst-filing";

describe("GST filing OTP primitives", () => {
  it("generates six-digit codes and verifies salted hashes without retaining the code", () => {
    const code = createOtpCode();
    const first = hashOtpCode(code);
    const second = hashOtpCode(code);

    expect(code).toMatch(/^\d{6}$/);
    expect(first.codeHash).not.toBe(code);
    expect(first.salt).not.toBe(second.salt);
    expect(matchesOtpCode(code, first.salt, first.codeHash)).toBe(true);
    expect(matchesOtpCode(String((Number(code) + 1) % 1_000_000).padStart(6, "0"), first.salt, first.codeHash)).toBe(false);
  });

  it("enforces resend cooldown, the three-per-ten-minute cap, and active lockout", () => {
    const now = new Date("2025-05-01T10:00:00Z");
    expect(canRequestOtp({ requestCountInWindow: 1, latestRequestedAt: new Date(now.getTime() - 10_000), latestLockedUntil: null }, now))
      .toMatchObject({ allowed: false, reason: "cooldown" });
    const latestRequest = new Date(now.getTime() - 61_000);
    expect(canRequestOtp({ requestCountInWindow: 3, latestRequestedAt: latestRequest, latestLockedUntil: null }, now))
      .toMatchObject({
        allowed: false,
        reason: "rate_limited",
        retryAt: new Date(latestRequest.getTime() + 10 * 60_000),
      });
    expect(canRequestOtp({
      requestCountInWindow: 2,
      latestRequestedAt: new Date(now.getTime() - 10 * 60_000 - 1),
      latestLockedUntil: null,
    }, now)).toMatchObject({ allowed: true });
    expect(canRequestOtp({ requestCountInWindow: 0, latestRequestedAt: null, latestLockedUntil: new Date(now.getTime() + 60_000) }, now))
      .toMatchObject({ allowed: false, reason: "locked" });
  });

  it("expires challenges and locks after five failed attempts for fifteen minutes", () => {
    const now = new Date("2025-05-01T10:00:00Z");
    const challenge = { attempts: 4, expiresAt: new Date(now.getTime() + 60_000), lockedUntil: null, verifiedAt: null };
    const fifthFailure = evaluateOtpAttempt({ challenge, now, matches: false });
    expect(fifthFailure.status).toBe("locked");
    expect(fifthFailure.attempts).toBe(5);
    expect(fifthFailure.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60_000);

    const expired = evaluateOtpAttempt({
      challenge: { ...challenge, expiresAt: now },
      now,
      matches: true,
    });
    expect(expired.status).toBe("expired");
  });

  it("accepts approval only within the ten-minute window", () => {
    const approvedAt = new Date("2025-05-01T10:00:00Z");
    expect(isGstApprovalFresh(approvedAt, new Date("2025-05-01T10:10:00Z"))).toBe(true);
    expect(isGstApprovalFresh(approvedAt, new Date("2025-05-01T10:10:00.001Z"))).toBe(false);
    expect(isGstApprovalFresh(new Date("2025-05-01T10:01:00Z"), approvedAt)).toBe(false);
  });
});
