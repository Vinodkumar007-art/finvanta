import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildGstDraft, type FilingInvoice } from "@/engines/gst-filing";
import {
  canRequestOtp,
  createGstFilingService,
  evaluateOtpAttempt,
  isGstApprovalFresh,
  type GstFilingRepository,
} from "@/services/gst-filing";
import type { GstFilingDraft, GstFilingOtpChallenge } from "@/services/gst-filing-store";
import type { GstReviewNotes } from "@/services/gst-filing-review";
import { createGspClient } from "@/services/gsp/client";
import type { GstOtpMessage } from "@/services/gst-otp-delivery";

vi.mock("server-only", () => ({}));

const serverPath = fileURLToPath(new URL("../mock-gsp/server.mjs", import.meta.url));
const gstin = "27AAPFU0939F1ZV";
const fixedNow = new Date("2025-06-01T10:00:00Z");
const sourceInvoice: FilingInvoice = {
  id: "invoice-1",
  kind: "sales",
  number: "INV-001",
  date: "2025-05-10",
  placeOfSupply: "27",
  supplierState: "29",
  partyGstin: gstin,
  status: "approved",
  items: [{ hsn: "1001", qty: 1, rate: "1000", gstRate: 18 }],
  taxable: "1000.00",
  cgst: "90.00",
  sgst: "90.00",
  igst: "0.00",
};

let server: ChildProcessWithoutNullStreams;
let gspBaseUrl: string;

function startMockGsp() {
  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", GST_ENV: "sandbox", GSP_ENV: "sandbox", GSP_MOCK_PORT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`Mock GSP did not start. ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/MOCK_GSP_LISTENING (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Mock GSP exited before listening (${code}). ${stderr}`));
    });
  });
  return { child, ready };
}

function createMemoryRepository(): { repository: GstFilingRepository; drafts: Map<string, GstFilingDraft>; events: Record<string, unknown>[] } {
  const drafts = new Map<string, GstFilingDraft>();
  const challenges: GstFilingOtpChallenge[] = [];
  const events: Record<string, unknown>[] = [];
  const addEvent = (draftId: string, companyId: string, actorUserId: string, eventType: string, detail: Record<string, unknown>, now: Date) => {
    events.push({ id: randomUUID(), draftId, companyId, actorUserId, eventType, detail, createdAt: now });
  };
  const repository: GstFilingRepository = {
    async getCompanyFilingProfile(companyId) {
      return { id: companyId, gstin, stateCode: "27", name: "Test Co" };
    },
    async getInvoicesForGstPeriod() {
      return [sourceInvoice];
    },
    async createDraft({ companyId, actorUserId, payload, now }) {
      const draft: GstFilingDraft = {
        id: randomUUID(),
        companyId,
        period: payload.period,
        gstin: payload.gstin,
        payload,
        reviewNotes: null,
        status: "DRAFT",
        createdBy: actorUserId,
        approvedBy: null,
        approvedAt: null,
        gspDraftId: null,
        gspResponse: null,
        arn: null,
        filedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      drafts.set(draft.id, draft);
      addEvent(draft.id, companyId, actorUserId, "draft_created", { period: draft.period }, now);
      return draft;
    },
    async getDraft(companyId, draftId) {
      const draft = drafts.get(draftId);
      return draft?.companyId === companyId ? draft : null;
    },
    async listDrafts(companyId) {
      return [...drafts.values()].filter((draft) => draft.companyId === companyId);
    },
    async listEvents(companyId, draftId) {
      return events.filter((event) => event.companyId === companyId && event.draftId === draftId);
    },
    async saveReview({ companyId, draftId, actorUserId, notes, now }) {
      const draft = drafts.get(draftId);
      if (!draft || draft.companyId !== companyId || draft.status !== "DRAFT") throw new Error("GST filing draft not found.");
      const updated = { ...draft, reviewNotes: notes, status: "REVIEWED", updatedAt: now };
      drafts.set(draftId, updated);
      addEvent(draftId, companyId, actorUserId, "ai_review_created", { reviewNotes: notes }, now);
      return updated;
    },
    async requestOtp({ companyId, draftId, actorUserId, salt, codeHash, now }) {
      const draft = drafts.get(draftId);
      if (!draft || draft.companyId !== companyId || !draft.reviewNotes) throw new Error("Complete the AI review before requesting an approval code.");
      const latest = challenges.filter((challenge) => challenge.draftId === draftId).at(-1) ?? null;
      const recent = challenges.filter((challenge) => challenge.draftId === draftId && now.getTime() - challenge.createdAt.getTime() < 10 * 60_000);
      const allowed = canRequestOtp({
        requestCountInWindow: recent.length,
        latestRequestedAt: latest?.createdAt ?? null,
        latestLockedUntil: latest?.lockedUntil ?? null,
      }, now);
      if (!allowed.allowed) throw new Error(`Approval code request is ${allowed.reason}.`);
      const challenge: GstFilingOtpChallenge = {
        id: randomUUID(),
        draftId,
        companyId,
        requestedBy: actorUserId,
        salt,
        codeHash,
        attempts: 0,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        lockedUntil: null,
        verifiedAt: null,
        createdAt: now,
      };
      challenges.push(challenge);
      drafts.set(draftId, { ...draft, status: "OTP_PENDING", updatedAt: now });
      addEvent(draftId, companyId, actorUserId, "otp_requested", { challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString() }, now);
      return { challengeId: challenge.id, period: draft.period, expiresAt: challenge.expiresAt };
    },
    async getLatestOtp(companyId, draftId) {
      return challenges.filter((challenge) => challenge.companyId === companyId && challenge.draftId === draftId).at(-1) ?? null;
    },
    async recordOtpAttempt({ companyId, draftId, actorUserId, matches, now }) {
      const challenge = challenges.filter((row) => row.companyId === companyId && row.draftId === draftId).at(-1);
      const draft = drafts.get(draftId);
      if (!challenge || !draft) throw new Error("Request an approval code before verifying it.");
      const result = evaluateOtpAttempt({ challenge, now, matches });
      if (result.status === "invalid" || result.status === "locked") {
        Object.assign(challenge, { attempts: result.attempts, lockedUntil: result.lockedUntil });
      }
      if (result.status === "approved") {
        Object.assign(challenge, { verifiedAt: now });
        drafts.set(draftId, { ...draft, status: "APPROVED", approvedAt: now, approvedBy: actorUserId, updatedAt: now });
        addEvent(draftId, companyId, actorUserId, "approval_granted", { approvedAt: now.toISOString() }, now);
      }
      addEvent(draftId, companyId, actorUserId, "otp_attempt", { outcome: result.status, attempt: result.attempts }, now);
      return { ...result, success: result.status === "approved" };
    },
    async recordOtpDeliveryFailure({ companyId, draftId, actorUserId, challengeId, now }) {
      addEvent(draftId, companyId, actorUserId, "otp_delivery_failed", { challengeId }, now);
    },
    async claimSubmission({ companyId, draftId, actorUserId, now }) {
      const draft = drafts.get(draftId);
      if (!draft || draft.companyId !== companyId) throw new Error("GST filing draft not found.");
      if (draft.status !== "APPROVED" || !draft.approvedAt || draft.approvedBy !== actorUserId
        || !isGstApprovalFresh(draft.approvedAt, now)) {
        throw new Error("A verified OTP approval is required before mock submission.");
      }
      const updated = { ...draft, status: "SUBMITTING", updatedAt: now };
      drafts.set(draftId, updated);
      addEvent(draftId, companyId, actorUserId, "submit_started", {}, now);
      return updated;
    },
    async recordGspResponse({ companyId, draftId, actorUserId, eventType, detail, createdAt }) {
      addEvent(draftId, companyId, actorUserId, eventType, detail, createdAt);
    },
    async saveGspDraft({ companyId, draftId, actorUserId, gspDraftId, response, now }) {
      const draft = drafts.get(draftId);
      if (!draft) throw new Error("GST filing draft not found.");
      const updated = { ...draft, gspDraftId, gspResponse: response, updatedAt: now };
      drafts.set(draftId, updated);
      addEvent(draftId, companyId, actorUserId, "gsp_draft_created", response, now);
      return updated;
    },
    async completeSubmission({ companyId, draftId, actorUserId, response, arn, filedAt, now }) {
      const draft = drafts.get(draftId);
      if (!draft) throw new Error("GST filing draft not found.");
      const updated = { ...draft, status: "FILED", gspResponse: response, arn, filedAt, updatedAt: now };
      drafts.set(draftId, updated);
      addEvent(draftId, companyId, actorUserId, "gsp_submit_response", response, now);
      return updated;
    },
    async failSubmission({ companyId, draftId, actorUserId, status, response, now }) {
      const draft = drafts.get(draftId);
      if (!draft) throw new Error("GST filing draft not found.");
      const updated = { ...draft, status, gspResponse: response, updatedAt: now };
      drafts.set(draftId, updated);
      addEvent(draftId, companyId, actorUserId, "gsp_submit_response", response, now);
      return updated;
    },
  };
  return { repository, drafts, events };
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("GST_ENV", "sandbox");
  vi.stubEnv("GSP_ENV", "sandbox");
  vi.stubEnv("GSP_PROVIDER", "mock");
  vi.stubEnv("GSP_CLIENT_ID", "test-client");
  vi.stubEnv("GSP_CLIENT_SECRET", "test-secret");
  const started = startMockGsp();
  server = started.child;
  gspBaseUrl = await started.ready;
  vi.stubEnv("GSP_BASE_URL", gspBaseUrl);
}, 15_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
});

describe("GST filing workflow against the local mock GSP", () => {
  it("requires verified OTP, then files a mocked success and records audit events", async () => {
    const memory = createMemoryRepository();
    const codes: GstOtpMessage[] = [];
    const service = createGstFilingService({
      repository: memory.repository,
      delivery: { async send(message) { codes.push(message); } },
      gspClient: createGspClient,
      review: async () => ({
        summary: "Review the outward tax totals and source records before approval.",
        filingSummary: "For 2025-05, outward taxable supplies are ₹1000.00; net tax payable is ₹180.00.",
        anomalies: [],
        model: "test:mock-model",
      }),
      now: () => fixedNow,
    });
    const draft = await service.createDraft("company-1", "user-1", "2025-05");
    const storedDraft = await service.getDraft("company-1", draft.id);
    expect(storedDraft.payload.lineItems[0].taxType).toBe("intrastate");
    await service.reviewDraft("company-1", draft.id, "user-1");

    await expect(service.submit("company-1", draft.id, "user-1")).rejects.toThrow("verified OTP approval");
    expect(draft.gspDraftId).toBeNull();

    await service.requestApprovalCode("company-1", draft.id, "user-1");
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toMatch(/^\d{6}$/);
    expect(await service.verifyApprovalCode("company-1", draft.id, "user-1", codes[0].code)).toMatchObject({ success: true });

    vi.stubEnv("GSP_MOCK_FORCE_OUTCOME", "success");
    const filed = await service.submit("company-1", draft.id, "user-1");
    expect(filed).toMatchObject({ status: "FILED", arn: expect.stringMatching(/^MOCKARN\d{12}$/) });
    expect(memory.events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "draft_created", "ai_review_created", "otp_requested", "otp_attempt", "approval_granted", "submit_started",
      "gsp_authentication_response", "gsp_draft_created", "gsp_submit_response",
    ]));
    expect(JSON.stringify(memory.events)).not.toContain(codes[0].code);
  });

  it("surfaces a forced GSP rejection and requires a fresh OTP approval to retry", async () => {
    const memory = createMemoryRepository();
    const codes: GstOtpMessage[] = [];
    let currentTime = fixedNow;
    const service = createGstFilingService({
      repository: memory.repository,
      delivery: { async send(message) { codes.push(message); } },
      gspClient: createGspClient,
      review: async () => ({
        summary: "Review the filing checks before approval.",
        filingSummary: "For 2025-05, outward taxable supplies are ₹1000.00; net tax payable is ₹180.00.",
        anomalies: [],
        model: "test:mock-model",
      }),
      now: () => currentTime,
    });
    const draft = await service.createDraft("company-1", "user-1", "2025-05");
    await service.reviewDraft("company-1", draft.id, "user-1");
    await service.requestApprovalCode("company-1", draft.id, "user-1");
    await service.verifyApprovalCode("company-1", draft.id, "user-1", codes[0].code);
    vi.stubEnv("GSP_MOCK_FORCE_OUTCOME", "error");

    await expect(service.submit("company-1", draft.id, "user-1")).rejects.toMatchObject({
      name: "GspClientError",
      status: 422,
    });
    expect(memory.drafts.get(draft.id)?.status).toBe("REJECTED");
    expect(memory.events.some((event) => JSON.stringify(event.detail).includes("MOCK_RET_1001"))).toBe(true);
    await expect(service.submit("company-1", draft.id, "user-1")).rejects.toThrow("verified OTP approval");

    currentTime = new Date(fixedNow.getTime() + 61_000);
    await service.requestApprovalCode("company-1", draft.id, "user-1");
    expect(codes).toHaveLength(2);
    expect(await service.verifyApprovalCode("company-1", draft.id, "user-1", codes[1].code)).toMatchObject({ success: true });
  });

  it("rejects an expired approval before any GSP request", async () => {
    const memory = createMemoryRepository();
    const codes: GstOtpMessage[] = [];
    let currentTime = fixedNow;
    const service = createGstFilingService({
      repository: memory.repository,
      delivery: { async send(message) { codes.push(message); } },
      gspClient: createGspClient,
      review: async () => ({
        summary: "Review the filing checks before approval.",
        filingSummary: "For 2025-05, outward taxable supplies are ₹1000.00; net tax payable is ₹180.00.",
        anomalies: [],
        model: "test:mock-model",
      }),
      now: () => currentTime,
    });
    const draft = await service.createDraft("company-1", "user-1", "2025-05");
    await service.reviewDraft("company-1", draft.id, "user-1");
    await service.requestApprovalCode("company-1", draft.id, "user-1");
    await service.verifyApprovalCode("company-1", draft.id, "user-1", codes[0].code);

    currentTime = new Date(fixedNow.getTime() + 10 * 60_000 + 1);
    await expect(service.submit("company-1", draft.id, "user-1")).rejects.toThrow("verified OTP approval");
    expect(memory.drafts.get(draft.id)?.status).toBe("APPROVED");
    expect(memory.events.some((event) => event.eventType === "submit_started")).toBe(false);
    expect(memory.events.some((event) => event.eventType === "gsp_submit_response")).toBe(false);
  });
});
