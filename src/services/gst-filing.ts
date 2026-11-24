import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { FilingInvoice, GstDraft } from "@/engines/gst-filing";
import { buildGstDraft } from "@/engines/gst-filing";
import type { GstFilingDraft, GstFilingOtpChallenge } from "@/services/gst-filing-store";
import { reviewGstDraft, type GstReviewNotes } from "@/services/gst-filing-review";
import type { GstOtpDelivery } from "@/services/gst-otp-delivery";
import type { GspClient, GspDraftRequest } from "@/services/gsp/types";

const OTP_BYTES = 64;
export const OTP_EXPIRY_MS = 5 * 60_000;
export const OTP_REQUEST_WINDOW_MS = 10 * 60_000;
const GST_APPROVAL_WINDOW_MS = 10 * 60_000;
const OTP_MAX_REQUESTS_IN_WINDOW = 3;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60_000;

export type OtpChallengeState = {
  attempts: number;
  expiresAt: Date;
  lockedUntil: Date | null;
  verifiedAt: Date | null;
};

export type OtpRequestState = {
  requestCountInWindow: number;
  latestRequestedAt: Date | null;
  latestLockedUntil: Date | null;
};

export function createOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(code: string, salt = randomBytes(16)) {
  return {
    salt: salt.toString("hex"),
    codeHash: scryptSync(code, salt, OTP_BYTES).toString("hex"),
  };
}

export function matchesOtpCode(code: string, saltHex: string, hashHex: string) {
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== OTP_BYTES) return false;
  const candidate = scryptSync(code, Buffer.from(saltHex, "hex"), OTP_BYTES);
  return timingSafeEqual(candidate, expected);
}

export function canRequestOtp(state: OtpRequestState, now: Date) {
  if (state.latestLockedUntil && state.latestLockedUntil > now) {
    return { allowed: false, reason: "locked" as const, retryAt: state.latestLockedUntil };
  }
  if (state.requestCountInWindow >= OTP_MAX_REQUESTS_IN_WINDOW && state.latestRequestedAt) {
    return { allowed: false, reason: "rate_limited" as const, retryAt: new Date(state.latestRequestedAt.getTime() + OTP_REQUEST_WINDOW_MS) };
  }
  if (state.latestRequestedAt && now.getTime() - state.latestRequestedAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return { allowed: false, reason: "cooldown" as const, retryAt: new Date(state.latestRequestedAt.getTime() + OTP_RESEND_COOLDOWN_MS) };
  }
  return { allowed: true as const };
}

export function evaluateOtpAttempt(input: {
  challenge: OtpChallengeState;
  now: Date;
  matches: boolean;
}) {
  const { challenge, now, matches } = input;
  if (challenge.verifiedAt) return { status: "already_verified" as const, attempts: challenge.attempts, lockedUntil: challenge.lockedUntil };
  if (challenge.lockedUntil && challenge.lockedUntil > now) {
    return { status: "locked" as const, attempts: challenge.attempts, lockedUntil: challenge.lockedUntil };
  }
  if (challenge.expiresAt <= now) return { status: "expired" as const, attempts: challenge.attempts, lockedUntil: challenge.lockedUntil };
  if (matches) return { status: "approved" as const, attempts: challenge.attempts, lockedUntil: challenge.lockedUntil };
  const attempts = challenge.attempts + 1;
  const lockedUntil = attempts >= OTP_MAX_ATTEMPTS ? new Date(now.getTime() + OTP_LOCKOUT_MS) : null;
  return { status: lockedUntil ? "locked" as const : "invalid" as const, attempts, lockedUntil };
}

export function isGstApprovalFresh(approvedAt: Date | null, now: Date) {
  if (!approvedAt) return false;
  const ageMs = now.getTime() - approvedAt.getTime();
  return ageMs >= 0 && ageMs <= GST_APPROVAL_WINDOW_MS;
}

export function assertGstSandboxEnvironment() {
  if (process.env.NODE_ENV === "production" || process.env.GST_ENV !== "sandbox" || process.env.GSP_ENV === "production") {
    throw new Error("GST filing workflow is disabled unless GST_ENV=sandbox in a non-production environment.");
  }
  if (process.env.GSP_ENV && process.env.GSP_ENV !== "sandbox") {
    throw new Error("GST filing workflow requires GSP_ENV=sandbox.");
  }
  if (process.env.GSP_PROVIDER !== "mock") {
    throw new Error("GST filing workflow requires GSP_PROVIDER=mock; other providers are disabled.");
  }
}

export type GstFilingRepository = {
  getCompanyFilingProfile(companyId: string): Promise<{ id: string; gstin: string | null; stateCode: string; name: string }>;
  getInvoicesForGstPeriod(companyId: string, period: string): Promise<FilingInvoice[]>;
  createDraft(input: { companyId: string; actorUserId: string; payload: GstDraft; now: Date }): Promise<GstFilingDraft>;
  getDraft(companyId: string, draftId: string): Promise<GstFilingDraft | null>;
  listDrafts(companyId: string): Promise<GstFilingDraft[]>;
  listEvents(companyId: string, draftId: string): Promise<unknown[]>;
  saveReview(input: { companyId: string; draftId: string; actorUserId: string; notes: GstReviewNotes; now: Date }): Promise<GstFilingDraft>;
  requestOtp(input: { companyId: string; draftId: string; actorUserId: string; salt: string; codeHash: string; now: Date }): Promise<{ challengeId: string; period: string; expiresAt: Date }>;
  getLatestOtp(companyId: string, draftId: string): Promise<GstFilingOtpChallenge | null>;
  recordOtpAttempt(input: { companyId: string; draftId: string; actorUserId: string; matches: boolean; now: Date }): Promise<{ status: string; attempts: number; lockedUntil: Date | null; success: boolean }>;
  recordOtpDeliveryFailure(input: { companyId: string; draftId: string; actorUserId: string; challengeId: string; now: Date }): Promise<void>;
  claimSubmission(input: { companyId: string; draftId: string; actorUserId: string; now: Date }): Promise<GstFilingDraft>;
  recordGspResponse(input: { draftId: string; companyId: string; actorUserId: string; eventType: string; detail: Record<string, unknown>; createdAt: Date }): Promise<void>;
  saveGspDraft(input: { companyId: string; draftId: string; actorUserId: string; gspDraftId: string; response: Record<string, unknown>; now: Date }): Promise<GstFilingDraft>;
  completeSubmission(input: { companyId: string; draftId: string; actorUserId: string; response: Record<string, unknown>; arn: string; filedAt: Date; now: Date }): Promise<GstFilingDraft>;
  failSubmission(input: { companyId: string; draftId: string; actorUserId: string; status: "REJECTED" | "SUBMIT_FAILED"; response: Record<string, unknown>; now: Date }): Promise<GstFilingDraft>;
};

export function createGstFilingService(deps: {
  repository: GstFilingRepository;
  delivery: GstOtpDelivery;
  gspClient: () => GspClient;
  review?: (draft: GstDraft) => Promise<GstReviewNotes>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const getDraft = async (companyId: string, draftId: string) => {
    const draft = await deps.repository.getDraft(companyId, draftId);
    if (!draft) throw new Error("GST filing draft not found.");
    return draft;
  };

  return {
    async createDraft(companyId: string, actorUserId: string, period: string) {
      assertGstSandboxEnvironment();
      const company = await deps.repository.getCompanyFilingProfile(companyId);
      const sourceInvoices = await deps.repository.getInvoicesForGstPeriod(companyId, period);
      const invoices = sourceInvoices.map((invoice) => ({
        ...invoice,
        supplierState: invoice.kind === "sales" ? company.stateCode : invoice.supplierState,
      }));
      const payload = buildGstDraft({
        period,
        gstin: company.gstin ?? "",
        companyState: company.stateCode,
        invoices,
        today: now().toISOString().slice(0, 10),
      });
      return deps.repository.createDraft({ companyId, actorUserId, payload, now: now() });
    },

    async reviewDraft(companyId: string, draftId: string, actorUserId: string) {
      assertGstSandboxEnvironment();
      const draft = await getDraft(companyId, draftId);
      if (draft.status !== "DRAFT" || draft.reviewNotes) throw new Error("Only an unreviewed GST draft can receive an AI review.");
      const notes = await (deps.review ?? reviewGstDraft)(draft.payload);
      return deps.repository.saveReview({ companyId, draftId, actorUserId, notes, now: now() });
    },

    async requestApprovalCode(companyId: string, draftId: string, actorUserId: string) {
      assertGstSandboxEnvironment();
      const draft = await getDraft(companyId, draftId);
      if (!draft.reviewNotes) throw new Error("Complete the AI review before requesting an approval code.");
      const code = createOtpCode();
      const { salt, codeHash } = hashOtpCode(code);
      const challenge = await deps.repository.requestOtp({
        companyId, draftId, actorUserId, salt, codeHash, now: now(),
      });
      try {
        await deps.delivery.send({ draftId, period: challenge.period, code });
      } catch (error) {
        await deps.repository.recordOtpDeliveryFailure({
          companyId, draftId, actorUserId, challengeId: challenge.challengeId, now: now(),
        });
        throw error;
      }
      return { message: "Approval code requested. It expires in five minutes.", expiresAt: challenge.expiresAt };
    },

    async verifyApprovalCode(companyId: string, draftId: string, actorUserId: string, code: string) {
      assertGstSandboxEnvironment();
      const challenge = await deps.repository.getLatestOtp(companyId, draftId);
      if (!challenge) throw new Error("Request an approval code before verifying it.");
      const matches = matchesOtpCode(code, challenge.salt, challenge.codeHash);
      return deps.repository.recordOtpAttempt({ companyId, draftId, actorUserId, matches, now: now() });
    },

    async submit(companyId: string, draftId: string, actorUserId: string) {
      assertGstSandboxEnvironment();
      const draft = await deps.repository.claimSubmission({ companyId, draftId, actorUserId, now: now() });
      try {
        const client = deps.gspClient();
        const token = await client.authenticate();
        await deps.repository.recordGspResponse({
          companyId, draftId, actorUserId, eventType: "gsp_authentication_response",
          detail: { mock: token.mock, token_type: token.token_type, expires_in: token.expires_in },
          createdAt: now(),
        });
        let gspDraftId = draft.gspDraftId;
        if (!gspDraftId) {
          const payload = toGspDraftRequest(draft.payload);
          const response = await client.createDraft(payload);
          gspDraftId = response.draftId;
          await deps.repository.saveGspDraft({
            companyId, draftId, actorUserId, gspDraftId,
            response: { draftId: response.draftId, status: response.status, mock: response.mock },
            now: now(),
          });
        }
        const response = await client.submitReturn(gspDraftId);
        const filedAt = new Date(response.filedAt);
        return await deps.repository.completeSubmission({
          companyId, draftId, actorUserId,
          response: { draftId: response.draftId, status: response.status, arn: response.arn, filedAt: response.filedAt, mock: response.mock },
          arn: response.arn, filedAt, now: now(),
        });
      } catch (error) {
        const response = safeGspFailure(error);
        const status = response.status === "REJECTED" ? "REJECTED" : "SUBMIT_FAILED";
        try {
          await deps.repository.failSubmission({ companyId, draftId, actorUserId, status, response, now: now() });
        } catch (auditError) {
          throw new AggregateError([error, auditError], "Mock submission failed and its failure audit could not be stored.");
        }
        throw error;
      }
    },

    async getDraft(companyId: string, draftId: string) {
      const draft = await getDraft(companyId, draftId);
      const [events, challenge] = await Promise.all([
        deps.repository.listEvents(companyId, draftId),
        deps.repository.getLatestOtp(companyId, draftId),
      ]);
      return {
        ...draft,
        events,
        otp: challenge ? {
          requestedAt: challenge.createdAt,
          expiresAt: challenge.expiresAt,
          lockedUntil: challenge.lockedUntil,
          verifiedAt: challenge.verifiedAt,
        } : null,
      };
    },

    listDrafts(companyId: string) {
      return deps.repository.listDrafts(companyId);
    },
  };
}

export async function getGstFilingService() {
  const [store, gsp, delivery] = await Promise.all([
    import("@/services/gst-filing-store"),
    import("@/services/gsp/client"),
    import("@/services/gst-otp-delivery"),
  ]);
  return createGstFilingService({
    repository: store.gstFilingRepository,
    delivery: delivery.developmentConsoleOtpDelivery,
    gspClient: gsp.createGspClient,
  });
}

export function gstFilingApiError(error: unknown) {
  if (isGspClientFailure(error)) {
    const status = error.status === 504 ? 504 : error.status === 422 ? 422 : 502;
    return { status, message: error.message };
  }
  if (error instanceof AggregateError) {
    return { status: 500, message: "Submission failed and its audit event could not be stored. Check the filing record before taking further action." };
  }
  if (!(error instanceof Error)) return { status: 500, message: "GST filing operation failed." };
  const message = error.message;
  if (message.includes("GST filing draft not found")) return { status: 404, message };
  if (message.includes("GST_ENV") || message.includes("GSP_PROVIDER") || message.includes("GSP_CLIENT_ID") || message.includes("disabled")) return { status: 503, message };
  if (/^(?:GST AI review is unavailable|LLM_PROVIDER must|(?:GEMINI|OPENAI)_API_KEY is required|Cloudflare AI requires|CLOUDFLARE_)/i.test(message)) {
    return { status: 503, message: safeAiReviewErrorMessage(message) };
  }
  if (/language-model provider|AI review|invalid JSON|model provider error|model discovery failed|credential was rejected|rate limit or quota reached|returned no models/i.test(message)) {
    return { status: 502, message: safeAiReviewErrorMessage(message) };
  }
  if (/approval|OTP|draft checks|Only a new|Only an unreviewed|Complete the AI review|already has an AI review|submission is no longer active/i.test(message)) {
    return { status: 409, message };
  }
  if (/period|state code|GSTIN|No approved invoices/i.test(message)) return { status: 400, message };
  return { status: 500, message: "GST filing operation failed." };
}

function safeAiReviewErrorMessage(message: string) {
  if (/^(?:LLM_PROVIDER|(?:GEMINI|OPENAI)_API_KEY|CLOUDFLARE_)/.test(message)) return message;
  if (/credential was rejected/i.test(message)) {
    return `${message} Verify the API key and account permissions.`;
  }
  const discoveryFailure = message.match(/(Gemini) model discovery failed \((\d{3})\)/i);
  if (discoveryFailure) {
    return `${discoveryFailure[1]} model discovery failed (${discoveryFailure[2]}). Verify API key permissions, API access, and available models.`;
  }
  if (/rate limit or quota reached/i.test(message)) {
    return "The selected AI provider's rate limit or quota was reached. Check its quota and model availability.";
  }
  const validationFailure = message.match(/^GST AI review failed schema validation at ([\w., ]+); no review was stored\.$/);
  if (validationFailure) {
    return `The AI review response did not contain valid values for ${validationFailure[1]}. No review was stored.`;
  }
  const providerFailure = message.match(/Model provider error \((\d{3})\)/i);
  if (providerFailure) {
    const status = Number(providerFailure[1]);
    const reason = status === 401 || status === 403
      ? "Verify the API key and model access."
      : status === 404
        ? "Verify the configured model ID and API endpoint."
        : status === 429
          ? "Check the provider's quota and retry after its limit resets."
          : status >= 500
            ? "The provider is unavailable; check its status and try again later."
            : "Check the model and API compatibility.";
    return `AI provider request failed (${status}). ${reason} No review was stored.`;
  }
  if (/^GST AI review (?:is unavailable because no language-model provider is configured\.|is unavailable because the configured provider returned no models\.|returned invalid JSON; no review was stored\.|failed schema validation; no review was stored\.)$/.test(message)) {
    return message;
  }
  return "The configured AI provider failed during GST review. Check its configuration and server logs; no review was stored.";
}

function toGspDraftRequest(draft: GstDraft): GspDraftRequest {
  return {
    period: draft.period,
    gstin: draft.gstin,
    lineItems: draft.lineItems.map((line) => ({
      description: `${line.direction === "outward" ? "Outward supply" : "Purchase"} ${line.gstRate}% ${line.taxType}`,
      taxableValue: Number(line.taxable),
      taxRate: line.gstRate,
      igst: Number(line.igst),
      cgst: Number(line.cgst),
      sgst: Number(line.sgst),
    })),
  };
}

function safeGspFailure(error: unknown): Record<string, unknown> {
  if (isGspClientFailure(error)) {
    const body = error.responseBody;
    if (body && typeof body === "object" && "mock" in body && body.mock === true) {
      return body as Record<string, unknown>;
    }
    return { mock: true, status: error.status, error: { message: error.message.slice(0, 300) } };
  }
  return {
    mock: true,
    status: "SUBMIT_FAILED",
    error: { message: error instanceof Error ? error.message.slice(0, 300) : "Unknown mock GSP error." },
  };
}

function isGspClientFailure(error: unknown): error is Error & { status: number; responseBody: unknown } {
  return error instanceof Error && "status" in error && typeof error.status === "number" && "responseBody" in error;
}
