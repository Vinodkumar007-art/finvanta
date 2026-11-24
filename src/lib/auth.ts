import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "fv_session";
const SESSION_DAYS = 14;

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}
export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, userAgent: (h.get("user-agent") ?? "").slice(0, 200) });
  const secure = h.get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await db.delete(sessions).where(eq(sessions.id, sha256(t)));
  jar.delete(SESSION_COOKIE);
}

export async function sessionUser() {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, mfaEnabled: users.mfaEnabled })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(t)), gt(sessions.expiresAt, new Date()), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/* ---------- RFC 6238 TOTP ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totpSecret() {
  const bytes = crypto.randomBytes(20); let bits = ""; bytes.forEach((b) => (bits += b.toString(2).padStart(8, "0")));
  return (bits.match(/.{1,5}/g) ?? []).map((c) => B32[parseInt(c.padEnd(5, "0"), 2)]).join("");
}
function b32decode(s: string) {
  let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}
function totpAt(secret: string, counter: number) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string) {
  const c = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((w) => totpAt(secret, c + w) === code.trim());
}
