import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gt, ilike, isNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { memberships, oauthAccounts, oauthStates, organisations, userPreferences, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { getCtx } from "@/lib/ctx";
import { decodeOAuthEncryptionKey } from "@/lib/oauth-config";

export type OAuthProvider = "google" | "github";

export class OAuthFlowError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OAuthFlowError";
  }
}

const STATE_TTL_MS = 10 * 60 * 1000;
const COOKIE_NAME = (provider: OAuthProvider) => `fv_oauth_state_${provider}`;
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

type ProviderToken = z.infer<typeof tokenResponseSchema>;
type ProviderIdentity = {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
};

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

function providerCredentials(provider: OAuthProvider) {
  const prefix = provider === "google" ? "GOOGLE" : "GITHUB";
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) {
    throw new OAuthFlowError("provider_unavailable", `${provider} sign-in is not configured.`);
  }
  return { clientId, clientSecret };
}

export function appOrigin(request: Request): string {
  const configured = process.env.OAUTH_REDIRECT_BASE_URL?.trim() || process.env.APP_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new OAuthFlowError("provider_unavailable", "A canonical HTTPS application URL must be configured for OAuth in production.");
  }
  let url: URL;
  try {
    url = new URL(configured || request.url);
  } catch {
    throw new OAuthFlowError("provider_unavailable", "OAuth redirect URL is invalid.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new OAuthFlowError("provider_unavailable", "OAuth requires an HTTPS redirect URL in production.");
  }
  return url.origin;
}

function callbackUrl(provider: OAuthProvider, request: Request): string {
  return `${appOrigin(request)}/api/auth/oauth/${provider}/callback`;
}

function encryptionKey(): Buffer {
  const value = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!value) throw new OAuthFlowError("provider_unavailable", "OAuth token encryption is not configured.");
  const key = decodeOAuthEncryptionKey(value);
  if (!key) throw new OAuthFlowError("provider_unavailable", "OAuth token encryption key must decode to 32 bytes.");
  return key;
}

export function encryptOAuthSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptOAuthSecret(value: string): string {
  const [ivPart, tagPart, ciphertextPart, extra] = value.split(".");
  if (!ivPart || !tagPart || !ciphertextPart || extra !== undefined) {
    throw new Error("Stored OAuth token has an invalid encrypted format.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new Error("Stored OAuth token could not be decrypted.", { cause: error });
  }
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function canAutoLinkProviderEmail(input: {
  providerEmail: string | null;
  providerEmailVerified: boolean;
  existingEmail: string | null;
}): boolean {
  return Boolean(
    input.providerEmail &&
    input.existingEmail &&
    input.providerEmailVerified &&
    input.providerEmail.trim().toLowerCase() === input.existingEmail.trim().toLowerCase(),
  );
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function startOAuth(provider: OAuthProvider, request: Request) {
  const { clientId } = providerCredentials(provider);
  encryptionKey();
  const state = randomBytes(32).toString("base64url");
  const pkce = createPkcePair();
  const app = await getCtx();
  const now = new Date();
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  await db.insert(oauthStates).values({
    stateHash: stateHash(state),
    provider,
    verifierEncrypted: encryptOAuthSecret(pkce.verifier),
    userId: app?.user.id ?? null,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });

  const authorizationUrl = new URL(
    provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://github.com/login/oauth/authorize",
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(provider, request),
    response_type: "code",
    scope: provider === "google" ? "openid email profile" : "read:user user:email",
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    ...(provider === "google" ? { access_type: "offline", prompt: "consent" } : {}),
  }).toString();
  return { state, authorizationUrl: authorizationUrl.toString() };
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function matchesOAuthState(state: string | null, stateCookie: string | null): boolean {
  return Boolean(state && stateCookie && safeEqual(state, stateCookie));
}

async function exchangeCode(provider: OAuthProvider, code: string, verifier: string, request: Request): Promise<ProviderToken> {
  const { clientId, clientSecret } = providerCredentials(provider);
  const endpoint = provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : "https://github.com/login/oauth/access_token";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(provider === "github" ? { "User-Agent": "FINVANTA" } : {}),
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl(provider, request),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new OAuthFlowError("provider_error", "The identity provider could not complete sign-in.");
  const result: unknown = await response.json();
  const token = tokenResponseSchema.safeParse(result);
  if (!token.success) throw new OAuthFlowError("provider_error", "The identity provider returned an invalid token response.");
  return token.data;
}

async function fetchIdentity(provider: OAuthProvider, accessToken: string): Promise<ProviderIdentity> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...(provider === "github" ? { "User-Agent": "FINVANTA", "X-GitHub-Api-Version": "2022-11-28" } : {}),
  };
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new OAuthFlowError("provider_error", "Could not read the Google account profile.");
    const data: unknown = await response.json();
    const profile = z.object({
      sub: z.string().min(1),
      email: z.string().email().optional(),
      email_verified: z.boolean().optional(),
      name: z.string().optional(),
    }).safeParse(data);
    if (!profile.success) throw new OAuthFlowError("provider_error", "Google returned an invalid account profile.");
    return {
      subject: profile.data.sub,
      email: profile.data.email?.toLowerCase() ?? null,
      emailVerified: profile.data.email_verified === true,
      name: profile.data.name?.trim().slice(0, 120) || profile.data.email?.split("@")[0] || "FINVANTA user",
    };
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new OAuthFlowError("provider_error", "Could not read the GitHub account profile.");
  const userData: unknown = await userResponse.json();
  const profile = z.object({
    id: z.union([z.number(), z.string()]),
    login: z.string().min(1),
    name: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
  }).safeParse(userData);
  if (!profile.success) throw new OAuthFlowError("provider_error", "GitHub returned an invalid account profile.");

  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!emailResponse.ok) throw new OAuthFlowError("provider_error", "Could not verify the GitHub account email.");
  const emails = z.array(z.object({
    email: z.string().email(),
    primary: z.boolean(),
    verified: z.boolean(),
  })).safeParse(await emailResponse.json());
  if (!emails.success) throw new OAuthFlowError("provider_error", "GitHub returned an invalid email list.");
  const verified = emails.data.find((entry) => entry.primary && entry.verified)
    ?? emails.data.find((entry) => entry.verified);
  const profileEmail = profile.data.email?.toLowerCase() ?? null;
  return {
    subject: String(profile.data.id),
    email: verified?.email.toLowerCase() ?? profileEmail,
    emailVerified: Boolean(verified),
    name: profile.data.name?.trim().slice(0, 120) || profile.data.login,
  };
}

async function createOrLinkAccount(
  provider: OAuthProvider,
  identity: ProviderIdentity,
  token: ProviderToken,
  targetUserId: string | null,
): Promise<{ userId: string; isNewUser: boolean; requiresMfa: boolean }> {
  const accessTokenEncrypted = encryptOAuthSecret(token.access_token);
  const refreshTokenEncrypted = token.refresh_token
    ? encryptOAuthSecret(token.refresh_token)
    : null;
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const scope = token.scope ?? null;
  const normalizedEmail = identity.email?.trim().toLowerCase() ?? null;

  return db.transaction(async (tx) => {
    const [existingAccount] = await tx.select().from(oauthAccounts).where(and(
      eq(oauthAccounts.provider, provider),
      eq(oauthAccounts.providerUserId, identity.subject),
    )).for("update").limit(1);
    let userId: string;
    let isNewUser = false;

    if (existingAccount) {
      if (targetUserId && existingAccount.userId !== targetUserId) {
        throw new OAuthFlowError("account_already_linked", "This provider account is already linked to a different FINVANTA account.");
      }
      userId = existingAccount.userId;
    } else if (targetUserId) {
      const [target] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.id, targetUserId),
        isNull(users.deletedAt),
      )).limit(1);
      if (!target) throw new OAuthFlowError("account_unavailable", "The FINVANTA account for this link no longer exists.");
      userId = target.id;
    } else {
      if (!identity.email || !identity.emailVerified) {
        throw new OAuthFlowError(
          "email_verification_required",
          "This provider has not verified an email address. Sign in to FINVANTA first, then explicitly link the provider from your account.",
        );
      }
      const emailPattern = normalizedEmail!.replace(/[\\%_]/g, "\\$&");
      const [existingUser] = await tx.select({ id: users.id, email: users.email }).from(users).where(and(
        ilike(users.email, emailPattern),
        isNull(users.deletedAt),
      )).limit(1);

      if (existingUser) {
        if (!canAutoLinkProviderEmail({
          providerEmail: identity.email,
          providerEmailVerified: identity.emailVerified,
          existingEmail: existingUser.email,
        })) {
          throw new OAuthFlowError("email_verification_required", "Account linking requires a verified matching email.");
        }
        userId = existingUser.id;
      } else {
        const name = identity.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "FINVANTA user";
        const [created] = await tx.insert(users).values({
          email: normalizedEmail!,
          name,
          passwordHash: `oauth$${randomUUID()}`,
        }).onConflictDoNothing({ target: users.email }).returning({ id: users.id });
        if (created) {
          userId = created.id;
          isNewUser = true;
          const [organisation] = await tx.insert(organisations).values({
            name: `${name}'s workspace`.slice(0, 100),
          }).returning({ id: organisations.id });
          await tx.insert(memberships).values({
            orgId: organisation.id,
            userId,
            role: "owner",
          });
          await tx.insert(userPreferences).values({ userId });
        } else {
          const [racedUser] = await tx.select({ id: users.id, email: users.email }).from(users).where(and(
            eq(users.email, normalizedEmail!),
            isNull(users.deletedAt),
          )).limit(1);
          if (!racedUser) throw new OAuthFlowError("account_creation_failed", "The FINVANTA account could not be created.");
          userId = racedUser.id;
        }
      }
    }

    const [user] = await tx.select({ id: users.id, mfaEnabled: users.mfaEnabled }).from(users).where(and(
      eq(users.id, userId),
      isNull(users.deletedAt),
    )).limit(1);
    if (!user) throw new OAuthFlowError("account_unavailable", "This FINVANTA account is no longer available.");

    const [sameProviderAccount] = await tx.select({ id: oauthAccounts.id, providerUserId: oauthAccounts.providerUserId })
      .from(oauthAccounts).where(and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.userId, userId),
      )).limit(1);
    if (sameProviderAccount && sameProviderAccount.providerUserId !== identity.subject) {
      throw new OAuthFlowError("provider_already_linked", "A different account from this provider is already linked.");
    }

    if (existingAccount) {
      await tx.update(oauthAccounts).set({
        providerEmail: normalizedEmail,
        emailVerified: identity.emailVerified,
        accessTokenEncrypted,
        refreshTokenEncrypted: refreshTokenEncrypted ?? existingAccount.refreshTokenEncrypted,
        expiresAt,
        tokenType: token.token_type ?? existingAccount.tokenType,
        scope: scope ?? existingAccount.scope,
        updatedAt: new Date(),
      }).where(eq(oauthAccounts.id, existingAccount.id));
    } else {
      const [inserted] = await tx.insert(oauthAccounts).values({
        userId,
        provider,
        providerUserId: identity.subject,
        providerEmail: normalizedEmail,
        emailVerified: identity.emailVerified,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        tokenType: token.token_type ?? null,
        scope,
      }).onConflictDoNothing({
        target: [oauthAccounts.provider, oauthAccounts.providerUserId],
      }).returning({ id: oauthAccounts.id, userId: oauthAccounts.userId });
      if (!inserted) {
        const [raced] = await tx.select({ userId: oauthAccounts.userId }).from(oauthAccounts).where(and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerUserId, identity.subject),
        )).limit(1);
        if (!raced || raced.userId !== userId) {
          throw new OAuthFlowError("account_already_linked", "This provider account is already linked to a different FINVANTA account.");
        }
        await tx.update(oauthAccounts).set({
          providerEmail: normalizedEmail,
          emailVerified: identity.emailVerified,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          expiresAt,
          tokenType: token.token_type ?? null,
          scope,
          updatedAt: new Date(),
        }).where(and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerUserId, identity.subject),
        ));
      }
    }
    return {
      userId,
      isNewUser,
      requiresMfa: user.mfaEnabled && !targetUserId,
    };
  });
}

export async function completeOAuth(
  provider: OAuthProvider,
  request: Request,
): Promise<{ userId: string; isNewUser: boolean; requiresMfa: boolean }> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const stateCookie = cookieValue(request, COOKIE_NAME(provider));
  const providerError = url.searchParams.get("error");
  if (!state || !stateCookie || !matchesOAuthState(state, stateCookie)) {
    throw new OAuthFlowError("invalid_state", "The OAuth state is missing or does not match.");
  }
  const now = new Date();
  const [flow] = await db.delete(oauthStates).where(and(
    eq(oauthStates.stateHash, stateHash(state)),
    eq(oauthStates.provider, provider),
    gt(oauthStates.expiresAt, now),
  )).returning();
  if (!flow) throw new OAuthFlowError("invalid_state", "The OAuth state is expired or has already been used.");

  if (providerError) {
    throw new OAuthFlowError(
      providerError === "access_denied" ? "access_denied" : "provider_error",
      providerError === "access_denied" ? "Sign-in was cancelled." : "The identity provider could not complete sign-in.",
    );
  }

  const code = url.searchParams.get("code");
  if (!code) throw new OAuthFlowError("provider_error", "The identity provider did not return an authorization code.");
  const verifier = decryptOAuthSecret(flow.verifierEncrypted);
  const token = await exchangeCode(provider, code, verifier, request);
  const identity = await fetchIdentity(provider, token.access_token);
  return createOrLinkAccount(provider, identity, token, flow.userId);
}

function oauthErrorCode(code: string): string {
  const known = new Set([
    "access_denied",
    "email_verification_required",
    "invalid_state",
    "account_already_linked",
    "provider_already_linked",
    "provider_error",
    "provider_unavailable",
    "mfa_required",
  ]);
  return known.has(code) ? code : "oauth_error";
}

export async function beginOAuthResponse(provider: OAuthProvider, request: Request) {
  let signedIn = false;
  try {
    signedIn = Boolean(await getCtx());
    const { state, authorizationUrl } = await startOAuth(provider, request);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(COOKIE_NAME(provider), state, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureRequest(request),
      path: `/api/auth/oauth/${provider}/callback`,
      maxAge: Math.floor(STATE_TTL_MS / 1000),
    });
    return response;
  } catch (error) {
    console.error("[finvanta] OAuth start failed", error);
    return NextResponse.redirect(new URL(
      signedIn
        ? `/settings?oauth_error=${oauthErrorCode(error instanceof OAuthFlowError ? error.code : "")}`
        : `/login?error=${oauthErrorCode(error instanceof OAuthFlowError ? error.code : "")}`,
      request.url,
    ));
  }
}

export async function finishOAuthResponse(provider: OAuthProvider, request: Request) {
  let response: NextResponse;
  let signedIn = false;
  try {
    signedIn = Boolean(await getCtx());
    const result = await completeOAuth(provider, request);
    if (result.requiresMfa) {
      response = NextResponse.redirect(new URL("/login?error=mfa_required", appOrigin(request)));
    } else {
      response = NextResponse.redirect(new URL(result.isNewUser ? "/onboarding" : "/dashboard", appOrigin(request)));
      await createSession(result.userId, response);
    }
  } catch (error) {
    const code = oauthErrorCode(error instanceof OAuthFlowError ? error.code : "");
    if (!(error instanceof OAuthFlowError)) console.error("[finvanta] OAuth callback failed", error);
    response = NextResponse.redirect(new URL(
      signedIn ? `/settings?oauth_error=${code}` : `/login?error=${code}`,
      appOrigin(request),
    ));
  }
  response.cookies.set(COOKIE_NAME(provider), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureRequest(request),
    path: `/api/auth/oauth/${provider}/callback`,
    maxAge: 0,
  });
  return response;
}

export async function getOAuthAccessToken(accountId: string): Promise<string> {
  const [record] = await db.select({ account: oauthAccounts }).from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(
      eq(oauthAccounts.id, accountId),
      isNull(users.deletedAt),
    )).limit(1);
  const account = record?.account;
  if (!account) throw new Error("OAuth account not found.");
  if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptOAuthSecret(account.accessTokenEncrypted);
  }
  if (!account.refreshTokenEncrypted) throw new Error("OAuth access token expired and no refresh token is available.");

  const providerResult = z.enum(["google", "github"]).safeParse(account.provider);
  if (!providerResult.success) throw new Error("Stored OAuth provider is invalid.");
  const provider = providerResult.data;
  const { clientId, clientSecret } = providerCredentials(provider);
  const endpoint = provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : "https://github.com/login/oauth/access_token";
  const refreshToken = decryptOAuthSecret(account.refreshTokenEncrypted);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(provider === "github" ? { "User-Agent": "FINVANTA" } : {}),
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("OAuth provider token refresh failed.");
  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("OAuth provider returned an invalid refresh response.");

  const token = parsed.data;
  if (account.expiresAt && !token.expires_in) {
    throw new Error("OAuth provider omitted the refreshed token expiration.");
  }
  await db.update(oauthAccounts).set({
    accessTokenEncrypted: encryptOAuthSecret(token.access_token),
    refreshTokenEncrypted: token.refresh_token
      ? encryptOAuthSecret(token.refresh_token)
      : account.refreshTokenEncrypted,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    tokenType: token.token_type ?? account.tokenType,
    scope: token.scope ?? account.scope,
    updatedAt: new Date(),
  }).where(eq(oauthAccounts.id, account.id));
  return token.access_token;
}
