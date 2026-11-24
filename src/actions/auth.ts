"use server";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, organisations, passwordResets, userPreferences, users, sessions } from "@/db/schema";
import { createSession, destroySession, hashPassword, sha256, verifyPassword, verifyTotp, totpSecret } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { getCtx, requireCtx } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { createCompanyWithDefaults } from "@/services/company";
import { seedDemoData } from "@/services/demo";
import { GSTIN_RE, PAN_RE } from "@/engines/tax";

export type FormState = { error?: string; ok?: string; needMfa?: boolean; secret?: string } | undefined;

const clientKey = async () => {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "local").split(",")[0].trim();
};

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  orgName: z.string().trim().min(2, "Enter an organisation name").max(100),
});

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const p = signupSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const rl = rateLimit(`signup:${await clientKey()}`, 8, 3600_000);
  if (!rl.ok) return { error: `Too many sign-ups from this network. Try again in ${rl.retryAfter}s.` };
  const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, p.data.email)).limit(1);
  if (exists.length) return { error: "An account with this email already exists." };
  const userId = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: p.data.email, name: p.data.name, passwordHash: hashPassword(p.data.password) }).returning();
    const [o] = await tx.insert(organisations).values({ name: p.data.orgName }).returning();
    await tx.insert(memberships).values({ orgId: o.id, userId: u.id, role: "owner" });
    await tx.insert(userPreferences).values({ userId: u.id });
    return u.id;
  });
  await createSession(userId);
  redirect("/onboarding");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const code = String(fd.get("code") ?? "");
  const rl = rateLimit(`login:${email}:${await clientKey()}`, 8, 15 * 60_000);
  if (!rl.ok) return { error: `Too many attempts. Try again in ${rl.retryAfter}s.` };
  const [u] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
  if (!u || !verifyPassword(password, u.passwordHash)) return { error: "Invalid email or password." };
  if (u.mfaEnabled && u.mfaSecret) {
    if (!code) return { needMfa: true, error: undefined };
    if (!verifyTotp(u.mfaSecret, code)) return { needMfa: true, error: "Invalid authentication code." };
  }
  await createSession(u.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function forgotPassword(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const rl = rateLimit(`forgot:${await clientKey()}`, 5, 3600_000);
  if (!rl.ok) return { error: "Too many requests. Try again later." };
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const generic = "If that account exists, a reset link has been issued.";
  if (!u) return { ok: generic };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) {
    console.error("[finvanta] Password reset email delivery is not configured.");
    return { ok: generic };
  }

  const h = await headers();
  const configuredOrigin = process.env.APP_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredOrigin) {
    console.error("[finvanta] Password reset origin is not configured.");
    return { ok: generic };
  }
  let origin: string;
  try {
    const url = new URL(configuredOrigin ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("HTTPS is required in production.");
    }
    origin = url.origin;
  } catch {
    console.error("[finvanta] Password reset origin is invalid.");
    return { ok: generic };
  }

  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(passwordResets).values({ id: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + 3600_000) });
  const link = `${origin}/reset-password?token=${token}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Reset your FINVANTA password", html: `<p>Reset your password (valid 1 hour):</p><p><a href="${link}">${link}</a></p>` }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) console.error(`[finvanta] Password reset email delivery failed (HTTP ${response.status}).`);
  } catch {
    console.error("[finvanta] Password reset email delivery failed.");
  }
  return { ok: generic };
}

export async function resetPassword(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? ""); const pw = String(fd.get("password") ?? "");
  if (pw.length < 10) return { error: "Password must be at least 10 characters." };
  const [r] = await db.select().from(passwordResets).where(and(eq(passwordResets.id, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date()))).limit(1);
  if (!r) return { error: "This reset link is invalid or has expired." };
  await db.update(users).set({ passwordHash: hashPassword(pw) }).where(eq(users.id, r.userId));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, r.id));
  await db.delete(sessions).where(eq(sessions.userId, r.userId));
  redirect("/login?reset=1");
}

export async function setupCompany(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "accountant"].includes(ctx.role)) return { error: "Your role cannot create companies." };
  const gstin = String(fd.get("gstin") ?? "").trim().toUpperCase(); const pan = String(fd.get("pan") ?? "").trim().toUpperCase();
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Enter the company name." };
  if (gstin && !GSTIN_RE.test(gstin)) return { error: "GSTIN format is invalid (15 characters)." };
  if (pan && !PAN_RE.test(pan)) return { error: "PAN format is invalid (e.g. ABCDE1234F)." };
  const { company } = await createCompanyWithDefaults({
    orgId: ctx.org.id, name, gstin, pan, tan: String(fd.get("tan") ?? "").toUpperCase(), stateCode: String(fd.get("stateCode") ?? "27"),
    baseCurrency: String(fd.get("currency") ?? "INR"), fyStartMonth: Number(fd.get("fyStart") ?? 4),
  });
  (await cookies()).set("fv_company", company.id, { path: "/", httpOnly: true, sameSite: "lax" });
  await audit({ ...ctx, company }, "company.create", "company", company.id, { name });
  if (fd.get("demo") === "on") await seedDemoData({ org: ctx.org, user: ctx.user, company }, company.id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function setCompany(id: string) {
  const ctx = await requireCtx();
  if (!ctx.companies.some((c) => c.id === id)) return;
  const jar = await cookies(); jar.set("fv_company", id, { path: "/", httpOnly: true, sameSite: "lax" }); jar.delete("fv_fy");
  revalidatePath("/", "layout");
}
export async function setFy(id: string) {
  const ctx = await requireCtx();
  if (!ctx.fys.some((f) => f.id === id)) return;
  (await cookies()).set("fv_fy", id, { path: "/", httpOnly: true, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function startMfa(): Promise<FormState> {
  const ctx = await requireCtx();
  const secret = totpSecret();
  await db.update(users).set({ mfaSecret: secret, mfaEnabled: false }).where(eq(users.id, ctx.user.id));
  return { secret };
}
export async function confirmMfa(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.user.id));
  if (!u?.mfaSecret) return { error: "Start setup first." };
  if (!verifyTotp(u.mfaSecret, String(fd.get("code") ?? ""))) return { error: "Code did not match. Check your authenticator app clock." };
  await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, u.id));
  await audit(ctx, "mfa.enable", "user", u.id);
  revalidatePath("/settings");
  return { ok: "Multi-factor authentication is now enabled." };
}
export async function disableMfa(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.user.id));
  if (!u || !verifyPassword(String(fd.get("password") ?? ""), u.passwordHash)) return { error: "Password incorrect." };
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.id, u.id));
  await audit(ctx, "mfa.disable", "user", u.id);
  revalidatePath("/settings");
  return { ok: "MFA disabled." };
}
export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.user.id));
  const np = String(fd.get("next") ?? "");
  if (!u || !verifyPassword(String(fd.get("current") ?? ""), u.passwordHash)) return { error: "Current password incorrect." };
  if (np.length < 10) return { error: "New password must be at least 10 characters." };
  await db.update(users).set({ passwordHash: hashPassword(np) }).where(eq(users.id, u.id));
  await audit(ctx, "password.change", "user", u.id);
  return { ok: "Password updated." };
}
export async function whoami() { return getCtx(); }
