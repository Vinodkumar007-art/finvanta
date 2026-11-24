export type OAuthProvider = "google" | "github";

type OAuthEnvironment = Record<string, string | undefined>;

export function decodeOAuthEncryptionKey(value: string | undefined): Buffer | null {
  const keyValue = value?.trim();
  if (!keyValue) return null;
  const key = /^[\da-f]{64}$/i.test(keyValue)
    ? Buffer.from(keyValue, "hex")
    : Buffer.from(keyValue, "base64");
  return key.length === 32 ? key : null;
}

export function oauthProviderReadiness(
  provider: OAuthProvider,
  env: OAuthEnvironment = process.env,
): { ready: boolean; hasCredentials: boolean; missing: string[] } {
  const prefix = provider === "google" ? "GOOGLE" : "GITHUB";
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  const missing: string[] = [];

  if (!clientId) missing.push(`${prefix}_CLIENT_ID`);
  if (!clientSecret) missing.push(`${prefix}_CLIENT_SECRET`);
  if (!decodeOAuthEncryptionKey(env.OAUTH_TOKEN_ENCRYPTION_KEY)) {
    missing.push("OAUTH_TOKEN_ENCRYPTION_KEY");
  }

  const configuredOrigin = env.OAUTH_REDIRECT_BASE_URL?.trim() || env.APP_URL?.trim();
  if (configuredOrigin) {
    try {
      const origin = new URL(configuredOrigin);
      if (env.NODE_ENV === "production" && origin.protocol !== "https:") {
        missing.push("APP_URL or OAUTH_REDIRECT_BASE_URL (HTTPS)");
      }
    } catch {
      missing.push("APP_URL or OAUTH_REDIRECT_BASE_URL (valid URL)");
    }
  } else if (env.NODE_ENV === "production") {
    missing.push("APP_URL or OAUTH_REDIRECT_BASE_URL");
  }

  return {
    ready: missing.length === 0,
    hasCredentials: Boolean(clientId || clientSecret),
    missing,
  };
}
