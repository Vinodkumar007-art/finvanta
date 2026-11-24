import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appOrigin,
  canAutoLinkProviderEmail,
  createPkcePair,
  decryptOAuthSecret,
  encryptOAuthSecret,
} from "../src/services/oauth";

const originalKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
const originalAppUrl = process.env.APP_URL;
const originalRedirectBaseUrl = process.env.OAUTH_REDIRECT_BASE_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  else process.env.OAUTH_TOKEN_ENCRYPTION_KEY = originalKey;
  vi.unstubAllEnvs();
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  if (originalRedirectBaseUrl === undefined) delete process.env.OAUTH_REDIRECT_BASE_URL;
  else process.env.OAUTH_REDIRECT_BASE_URL = originalRedirectBaseUrl;
});

describe("OAuth security helpers", () => {
  it("uses a 256-bit PKCE verifier and S256 challenge", () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("encrypts tokens with authenticated encryption and rejects tampering", () => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");
    const encrypted = encryptOAuthSecret("provider-token");
    expect(encrypted).not.toContain("provider-token");
    expect(decryptOAuthSecret(encrypted)).toBe("provider-token");
    const [iv, tag, ciphertext] = encrypted.split(".");
    const changedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    expect(() => decryptOAuthSecret(`${iv}.${changedTag}.${ciphertext}`)).toThrow();
  });

  it("auto-links only a verified exact email match", () => {
    expect(canAutoLinkProviderEmail({
      providerEmail: "Finance@Example.com",
      providerEmailVerified: true,
      existingEmail: "finance@example.com",
    })).toBe(true);
    expect(canAutoLinkProviderEmail({
      providerEmail: "finance@example.com",
      providerEmailVerified: false,
      existingEmail: "finance@example.com",
    })).toBe(false);
    expect(canAutoLinkProviderEmail({
      providerEmail: "other@example.com",
      providerEmailVerified: true,
      existingEmail: "finance@example.com",
    })).toBe(false);
  });

  it("requires a configured HTTPS origin for production OAuth", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.APP_URL;
    delete process.env.OAUTH_REDIRECT_BASE_URL;

    expect(() => appOrigin(new Request("https://untrusted.example/auth"))).toThrow(
      "A canonical HTTPS application URL must be configured for OAuth in production.",
    );

    process.env.APP_URL = "https://finvanta.example";
    expect(appOrigin(new Request("https://untrusted.example/auth"))).toBe("https://finvanta.example");

    process.env.APP_URL = "http://finvanta.example";
    expect(() => appOrigin(new Request("https://untrusted.example/auth"))).toThrow(
      "OAuth requires an HTTPS redirect URL in production.",
    );
  });
});
