import "server-only";
import {
  GspAuthTokenSchema,
  GspDraftRequestSchema,
  GspDraftResponseSchema,
  GspStatusResponseSchema,
  GspSubmitResponseSchema,
  type GspAuthToken,
  type GspClient,
  type GspDraftRequest,
  type GspDraftResponse,
  type GspStatusResponse,
  type GspSubmitResponse,
} from "./types";

export class GspClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "GspClientError";
  }
}

function baseUrl() {
  const raw = process.env.GSP_BASE_URL?.trim() || "http://127.0.0.1:4000";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("GSP_BASE_URL must be an absolute URL.");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("The mock GSP client only permits an HTTP loopback GSP_BASE_URL.");
  }
  return url.toString().replace(/\/+$/, "");
}

function assertMockEnvironment() {
  if (process.env.NODE_ENV === "production" || process.env.GSP_ENV === "production" || process.env.GST_ENV === "production") {
    throw new Error("GSP_PROVIDER=mock is disabled when NODE_ENV, GST_ENV, or GSP_ENV is production.");
  }
  if (process.env.GST_ENV !== "sandbox") {
    throw new Error("GST_ENV=sandbox is required for the mock GSP client.");
  }
  if (process.env.GSP_ENV && process.env.GSP_ENV !== "sandbox") {
    throw new Error("GSP_ENV must be sandbox while GSP_PROVIDER=mock.");
  }
}

class MockGspClient implements GspClient {
  readonly provider = "mock" as const;
  private accessToken: string | null = null;
  private readonly url: string;

  constructor() {
    assertMockEnvironment();
    this.url = baseUrl();
  }

  async authenticate(): Promise<GspAuthToken> {
    const clientId = process.env.GSP_CLIENT_ID?.trim();
    const clientSecret = process.env.GSP_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error("GSP_CLIENT_ID and GSP_CLIENT_SECRET must be set for mock authentication.");
    }
    const payload = await this.request("/auth/token", {
      method: "POST",
      body: { clientId, clientSecret },
    });
    const token = GspAuthTokenSchema.parse(payload);
    this.accessToken = token.access_token;
    return token;
  }

  async createDraft(draft: GspDraftRequest): Promise<GspDraftResponse> {
    const validated = GspDraftRequestSchema.parse(draft);
    const payload = await this.request("/returns/draft", {
      method: "POST",
      body: validated,
      authenticated: true,
    });
    return GspDraftResponseSchema.parse(payload);
  }

  async getStatus(draftId: string): Promise<GspStatusResponse> {
    const payload = await this.request(`/returns/${encodeURIComponent(draftId)}/status`, {
      method: "GET",
      authenticated: true,
    });
    return GspStatusResponseSchema.parse(payload);
  }

  async submitReturn(draftId: string): Promise<GspSubmitResponse> {
    const configuredTestOutcome = process.env.NODE_ENV === "test" ? process.env.GSP_MOCK_FORCE_OUTCOME : undefined;
    const forceOutcome = ["success", "error", "timeout"].includes(configuredTestOutcome ?? "") ? configuredTestOutcome : undefined;
    const payload = await this.request(`/returns/${encodeURIComponent(draftId)}/submit`, {
      method: "POST",
      body: forceOutcome ? { forceOutcome } : {},
      authenticated: true,
    });
    return GspSubmitResponseSchema.parse(payload);
  }

  private async request(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown; authenticated?: boolean },
  ): Promise<unknown> {
    if (options.authenticated && !this.accessToken) {
      throw new Error("Call authenticate() before using the mock GSP.");
    }
    const response = await fetch(`${this.url}${path}`, {
      method: options.method,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.authenticated && this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Mock GSP returned an invalid JSON response.");
    }
    if (!payload || typeof payload !== "object" || !("mock" in payload) || payload.mock !== true) {
      throw new Error("Mock GSP response did not include mock: true; refusing to treat it as a mock response.");
    }
    if (!response.ok) {
      const detail = payload as { error?: { message?: string }; errors?: { message?: string }[] };
      throw new GspClientError(
        detail.error?.message ?? detail.errors?.map((error) => error.message).join("; ") ?? `Mock GSP request failed (${response.status}).`,
        response.status,
        payload,
      );
    }
    return payload;
  }
}

export function createGspClient(): GspClient {
  const provider = process.env.GSP_PROVIDER?.trim().toLowerCase();
  if (provider === "mock") return new MockGspClient();
  if (provider === "cleartax") {
    throw new Error("ClearTax GSP is not enabled: its request/response contract must be confirmed before calls can be made.");
  }
  throw new Error("Set GSP_PROVIDER to mock or cleartax.");
}

export type {
  GspAuthToken,
  GspClient,
  GspDraftRequest,
  GspDraftResponse,
  GspStatusResponse,
  GspSubmitResponse,
};
