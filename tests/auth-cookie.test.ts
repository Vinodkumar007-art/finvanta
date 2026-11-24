import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  delete: vi.fn(),
  headers: vi.fn(),
  transaction: vi.fn(),
  cookieStore: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));

vi.mock("@/db", () => ({
  db: { delete: mocks.delete, transaction: mocks.transaction },
}));

import { createSession, destroySession, sessionCookieOptions, SESSION_COOKIE, sha256 } from "../src/lib/auth";
import { sessions } from "../src/db/schema";

describe("session cookie options", () => {
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");

  it("uses a persistent, HttpOnly cookie with a lifetime matching the server session", () => {
    expect(sessionCookieOptions(expiresAt, "production", null)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: expiresAt,
      maxAge: 14 * 24 * 60 * 60,
    });
  });

  it("recognizes the first HTTPS proxy protocol value outside production", () => {
    expect(sessionCookieOptions(expiresAt, "development", "https, http").secure).toBe(true);
    expect(sessionCookieOptions(expiresAt, "development", "http").secure).toBe(false);
  });
});

describe("session creation", () => {
  const where = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockResolvedValue(undefined);
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const transaction = {
    delete: vi.fn(() => ({ where })),
    insert: vi.fn(() => ({ values })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieStore.get.mockReturnValue({ value: "previous-session-token" });
    mocks.cookies.mockResolvedValue(mocks.cookieStore);
    mocks.delete.mockReturnValue({ where: deleteWhere });
    mocks.headers.mockResolvedValue(new Headers({
      "user-agent": "test browser",
      "x-forwarded-proto": "https, http",
    }));
    mocks.transaction.mockImplementation((operation: (tx: typeof transaction) => Promise<void>) => operation(transaction));
  });

  it("atomically replaces the previous session and sets a persistent secure cookie", async () => {
    await createSession("user-id");

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(transaction.delete).toHaveBeenCalledOnce();
    expect(transaction.insert).toHaveBeenCalledWith(sessions);
    expect(values).toHaveBeenCalledOnce();

    const [cookieName, token, options] = mocks.cookieStore.set.mock.calls[0];
    expect(cookieName).toBe(SESSION_COOKIE);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 14 * 24 * 60 * 60,
    });

    const inserted = values.mock.calls[0][0];
    expect(inserted.id).toBe(sha256(token));
    expect(inserted.userId).toBe("user-id");
    expect(inserted.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("attaches OAuth sessions to the redirect response", async () => {
    const response = NextResponse.redirect(new URL("https://finvanta.example/dashboard"));
    await createSession("user-id", response);

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it("deletes the database session and expires the browser cookie on logout", async () => {
    await destroySession();

    expect(mocks.delete).toHaveBeenCalledWith(sessions);
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(SESSION_COOKIE, "", expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }));
  });
});
