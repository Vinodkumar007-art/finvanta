import { and, asc, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  companies,
  gstFilingDrafts,
  gstFilingEvents,
  gstFilingOtpChallenges,
  invoices,
  parties,
  users,
} from "@/db/schema";
import type { GstDraft } from "@/engines/gst-filing";
import {
  canRequestOtp,
  evaluateOtpAttempt,
  isGstApprovalFresh,
  OTP_EXPIRY_MS,
  OTP_REQUEST_WINDOW_MS,
  type OtpChallengeState,
} from "@/services/gst-filing";
import type { GstReviewNotes } from "@/services/gst-filing-review";

type EventInput = {
  draftId: string;
  companyId: string;
  actorUserId: string;
  eventType: string;
  detail?: Record<string, unknown>;
  createdAt?: Date;
};

function nextMonth(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export async function getCompanyFilingProfile(companyId: string) {
  const [company] = await db.select({
    id: companies.id,
    gstin: companies.gstin,
    stateCode: companies.stateCode,
    name: companies.name,
  }).from(companies).where(and(eq(companies.id, companyId), isNull(companies.deletedAt)));
  if (!company) throw new Error("Company not found.");
  return company;
}

export async function getInvoicesForGstPeriod(companyId: string, period: string) {
  const start = `${period}-01`;
  const end = nextMonth(period);
  const rows = await db.select({
    id: invoices.id,
    kind: invoices.kind,
    number: invoices.number,
    date: invoices.date,
    placeOfSupply: invoices.placeOfSupply,
    supplierState: parties.stateCode,
    partyGstin: parties.gstin,
    status: invoices.status,
    items: invoices.items,
    taxable: invoices.taxable,
    cgst: invoices.cgst,
    sgst: invoices.sgst,
    igst: invoices.igst,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.companyId, companyId),
      gte(invoices.date, start),
      lt(invoices.date, end),
      isNull(invoices.deletedAt),
      ne(invoices.status, "cancelled"),
    ))
    .orderBy(asc(invoices.date), asc(invoices.number));
  return rows.map((row) => {
    const kind: "sales" | "purchase" | null = row.kind === "sales" ? "sales" : row.kind === "purchase" ? "purchase" : null;
    if (!kind) throw new Error(`Invoice ${row.id} has an unsupported kind.`);
    return { ...row, kind };
  });
}

export async function createGstFilingDraft(input: {
  companyId: string;
  actorUserId: string;
  payload: GstDraft;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.insert(gstFilingDrafts).values({
      companyId: input.companyId,
      period: input.payload.period,
      gstin: input.payload.gstin,
      payload: input.payload,
      status: "DRAFT",
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await tx.insert(gstFilingEvents).values({
      draftId: draft.id,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "draft_created",
      detail: { period: draft.period, sourceInvoiceIds: input.payload.sourceInvoiceIds },
      createdAt: now,
    });
    return draft;
  });
}

export async function getGstFilingDraft(companyId: string, draftId: string) {
  const [draft] = await db.select().from(gstFilingDrafts)
    .where(and(eq(gstFilingDrafts.companyId, companyId), eq(gstFilingDrafts.id, draftId)));
  return draft ?? null;
}

export async function listGstFilingDrafts(companyId: string) {
  return db.select().from(gstFilingDrafts)
    .where(eq(gstFilingDrafts.companyId, companyId))
    .orderBy(desc(gstFilingDrafts.createdAt))
    .limit(20);
}

export async function listGstFilingEvents(companyId: string, draftId: string) {
  return db.select({
    id: gstFilingEvents.id,
    draftId: gstFilingEvents.draftId,
    companyId: gstFilingEvents.companyId,
    actorUserId: gstFilingEvents.actorUserId,
    actorName: users.name,
    eventType: gstFilingEvents.eventType,
    detail: gstFilingEvents.detail,
    createdAt: gstFilingEvents.createdAt,
  }).from(gstFilingEvents)
    .innerJoin(users, eq(users.id, gstFilingEvents.actorUserId))
    .where(and(eq(gstFilingEvents.companyId, companyId), eq(gstFilingEvents.draftId, draftId)))
    .orderBy(asc(gstFilingEvents.createdAt), asc(gstFilingEvents.id));
}

export async function saveGstFilingReview(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  notes: GstReviewNotes;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(gstFilingDrafts)
      .where(and(eq(gstFilingDrafts.companyId, input.companyId), eq(gstFilingDrafts.id, input.draftId)))
      .for("update");
    if (!draft) throw new Error("GST filing draft not found.");
    if (draft.reviewNotes) throw new Error("This draft already has an AI review; create a new draft to review changed source data.");
    if (draft.status !== "DRAFT") throw new Error("Only a new GST filing draft can be reviewed.");
    const [updated] = await tx.update(gstFilingDrafts).set({
      reviewNotes: input.notes,
      status: "REVIEWED",
      updatedAt: now,
    }).where(eq(gstFilingDrafts.id, draft.id)).returning();
    await tx.insert(gstFilingEvents).values({
      draftId: draft.id,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "ai_review_created",
      detail: { reviewNotes: input.notes },
      createdAt: now,
    });
    return updated;
  });
}

export async function requestGstOtpChallenge(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  salt: string;
  codeHash: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(gstFilingDrafts)
      .where(and(eq(gstFilingDrafts.companyId, input.companyId), eq(gstFilingDrafts.id, input.draftId)))
      .for("update");
    if (!draft) throw new Error("GST filing draft not found.");
    const expiredApproval = draft.status === "APPROVED" && !isGstApprovalFresh(draft.approvedAt, now);
    if (!draft.reviewNotes || (!["REVIEWED", "OTP_PENDING", "SUBMIT_FAILED", "REJECTED"].includes(draft.status) && !expiredApproval)) {
      throw new Error("Complete the AI review before requesting an approval code.");
    }
    const payload = draft.payload as GstDraft;
    if (payload.checks.some((check) => check.status === "fail")) {
      throw new Error("Resolve failed draft checks and create a new draft before requesting approval.");
    }

    const [latest] = await tx.select().from(gstFilingOtpChallenges)
      .where(and(eq(gstFilingOtpChallenges.companyId, input.companyId), eq(gstFilingOtpChallenges.draftId, input.draftId)))
      .orderBy(desc(gstFilingOtpChallenges.createdAt))
      .limit(1);
    const requests = await tx.select({ id: gstFilingOtpChallenges.id, createdAt: gstFilingOtpChallenges.createdAt })
      .from(gstFilingOtpChallenges)
      .where(and(
        eq(gstFilingOtpChallenges.companyId, input.companyId),
        eq(gstFilingOtpChallenges.draftId, input.draftId),
        gte(gstFilingOtpChallenges.createdAt, new Date(now.getTime() - OTP_REQUEST_WINDOW_MS)),
      ));
    const requestState = canRequestOtp({
      requestCountInWindow: requests.length,
      latestRequestedAt: latest?.createdAt ?? null,
      latestLockedUntil: latest?.lockedUntil ?? null,
    }, now);
    if (!requestState.allowed) {
      const seconds = Math.max(1, Math.ceil((requestState.retryAt.getTime() - now.getTime()) / 1000));
      throw new Error(`Approval code request is ${requestState.reason}; try again in ${seconds} seconds.`);
    }

    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);
    const [challenge] = await tx.insert(gstFilingOtpChallenges).values({
      draftId: draft.id,
      companyId: input.companyId,
      requestedBy: input.actorUserId,
      salt: input.salt,
      codeHash: input.codeHash,
      attempts: 0,
      expiresAt,
      createdAt: now,
    }).returning();
    await tx.update(gstFilingDrafts).set({ status: "OTP_PENDING", updatedAt: now }).where(eq(gstFilingDrafts.id, draft.id));
    await tx.insert(gstFilingEvents).values({
      draftId: draft.id,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "otp_requested",
      detail: { challengeId: challenge.id, expiresAt: expiresAt.toISOString(), sendCount: requests.length + 1 },
      createdAt: now,
    });
    return { challengeId: challenge.id, period: draft.period, expiresAt };
  });
}

export async function recordGstOtpAttempt(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  matches: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(gstFilingDrafts)
      .where(and(eq(gstFilingDrafts.companyId, input.companyId), eq(gstFilingDrafts.id, input.draftId)))
      .for("update");
    if (!draft) throw new Error("GST filing draft not found.");
    const [challenge] = await tx.select().from(gstFilingOtpChallenges)
      .where(and(eq(gstFilingOtpChallenges.companyId, input.companyId), eq(gstFilingOtpChallenges.draftId, input.draftId)))
      .orderBy(desc(gstFilingOtpChallenges.createdAt))
      .limit(1)
      .for("update");
    if (!challenge) throw new Error("Request an approval code before verifying it.");

    const result = evaluateOtpAttempt({
      challenge: {
        attempts: challenge.attempts,
        expiresAt: challenge.expiresAt,
        lockedUntil: challenge.lockedUntil,
        verifiedAt: challenge.verifiedAt,
      } satisfies OtpChallengeState,
      now,
      matches: input.matches,
    });
    const success = result.status === "approved";
    if (result.status === "invalid" || result.status === "locked") {
      await tx.update(gstFilingOtpChallenges).set({
        attempts: result.attempts,
        lockedUntil: result.lockedUntil,
      }).where(eq(gstFilingOtpChallenges.id, challenge.id));
    } else if (success) {
      await tx.update(gstFilingOtpChallenges).set({ verifiedAt: now })
        .where(eq(gstFilingOtpChallenges.id, challenge.id));
      await tx.update(gstFilingDrafts).set({
        status: "APPROVED",
        approvedAt: now,
        approvedBy: input.actorUserId,
        updatedAt: now,
      }).where(eq(gstFilingDrafts.id, draft.id));
    }

    await tx.insert(gstFilingEvents).values({
      draftId: draft.id,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "otp_attempt",
      detail: { success, outcome: result.status, attempt: result.attempts, lockedUntil: result.lockedUntil?.toISOString() ?? null },
      createdAt: now,
    });
    if (success) {
      await tx.insert(gstFilingEvents).values({
        draftId: draft.id,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        eventType: "approval_granted",
        detail: { approvedAt: now.toISOString() },
        createdAt: now,
      });
    }
    return { ...result, success };
  });
}

export async function recordGstOtpDeliveryFailure(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  challengeId: string;
  now?: Date;
}) {
  await db.insert(gstFilingEvents).values({
    draftId: input.draftId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    eventType: "otp_delivery_failed",
    detail: { challengeId: input.challengeId },
    createdAt: input.now ?? new Date(),
  });
}

export async function claimGstFilingSubmission(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(gstFilingDrafts)
      .where(and(eq(gstFilingDrafts.companyId, input.companyId), eq(gstFilingDrafts.id, input.draftId)))
      .for("update");
    if (!draft) throw new Error("GST filing draft not found.");
    if (draft.status !== "APPROVED" || !draft.approvedAt || !draft.approvedBy) {
      throw new Error("A verified OTP approval is required before mock submission.");
    }
    if (draft.approvedBy !== input.actorUserId) throw new Error("Only the user who verified the approval code may submit this draft.");
    const ageMs = now.getTime() - draft.approvedAt.getTime();
    if (!isGstApprovalFresh(draft.approvedAt, now)) throw new Error("Approval expired; request and verify a new approval code.");
    const payload = draft.payload as GstDraft;
    if (payload.checks.some((check) => check.status === "fail")) throw new Error("Draft checks failed; submission is blocked.");
    const [updated] = await tx.update(gstFilingDrafts).set({ status: "SUBMITTING", updatedAt: now })
      .where(eq(gstFilingDrafts.id, draft.id)).returning();
    await tx.insert(gstFilingEvents).values({
      draftId: draft.id,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "submit_started",
      detail: { approvedAt: draft.approvedAt.toISOString(), approvalAgeMs: ageMs },
      createdAt: now,
    });
    return updated;
  });
}

export async function recordGstGspResponse(input: EventInput) {
  await db.insert(gstFilingEvents).values({
    draftId: input.draftId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    detail: input.detail ?? {},
    createdAt: input.createdAt ?? new Date(),
  });
}

export async function saveGstGspDraft(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  gspDraftId: string;
  response: Record<string, unknown>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.update(gstFilingDrafts).set({
      gspDraftId: input.gspDraftId,
      gspResponse: input.response,
      updatedAt: now,
    }).where(and(
      eq(gstFilingDrafts.companyId, input.companyId),
      eq(gstFilingDrafts.id, input.draftId),
      eq(gstFilingDrafts.status, "SUBMITTING"),
    )).returning();
    if (!draft) throw new Error("GST filing submission is no longer active.");
    await tx.insert(gstFilingEvents).values({
      draftId: input.draftId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "gsp_draft_created",
      detail: input.response,
      createdAt: now,
    });
    return draft;
  });
}

export async function completeGstGspSubmission(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  response: Record<string, unknown>;
  arn: string;
  filedAt: Date;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.update(gstFilingDrafts).set({
      status: "FILED",
      gspResponse: input.response,
      arn: input.arn,
      filedAt: input.filedAt,
      updatedAt: now,
    }).where(and(
      eq(gstFilingDrafts.companyId, input.companyId),
      eq(gstFilingDrafts.id, input.draftId),
      eq(gstFilingDrafts.status, "SUBMITTING"),
    )).returning();
    if (!draft) throw new Error("GST filing submission is no longer active.");
    await tx.insert(gstFilingEvents).values({
      draftId: input.draftId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "gsp_submit_response",
      detail: input.response,
      createdAt: now,
    });
    return draft;
  });
}

export async function failGstGspSubmission(input: {
  companyId: string;
  draftId: string;
  actorUserId: string;
  status: "REJECTED" | "SUBMIT_FAILED";
  response: Record<string, unknown>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [draft] = await tx.update(gstFilingDrafts).set({
      status: input.status,
      gspResponse: input.response,
      updatedAt: now,
    }).where(and(
      eq(gstFilingDrafts.companyId, input.companyId),
      eq(gstFilingDrafts.id, input.draftId),
      eq(gstFilingDrafts.status, "SUBMITTING"),
    )).returning();
    if (!draft) throw new Error("GST filing submission is no longer active.");
    await tx.insert(gstFilingEvents).values({
      draftId: input.draftId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      eventType: "gsp_submit_response",
      detail: input.response,
      createdAt: now,
    });
    return draft;
  });
}

export async function getLatestGstOtpChallenge(companyId: string, draftId: string) {
  const [challenge] = await db.select().from(gstFilingOtpChallenges)
    .where(and(eq(gstFilingOtpChallenges.companyId, companyId), eq(gstFilingOtpChallenges.draftId, draftId)))
    .orderBy(desc(gstFilingOtpChallenges.createdAt))
    .limit(1);
  return challenge ?? null;
}

export type GstFilingDraft = typeof gstFilingDrafts.$inferSelect;
export type GstFilingOtpChallenge = typeof gstFilingOtpChallenges.$inferSelect;

export const gstFilingRepository = {
  getCompanyFilingProfile: getCompanyFilingProfile,
  getInvoicesForGstPeriod: getInvoicesForGstPeriod,
  createDraft: createGstFilingDraft,
  getDraft: getGstFilingDraft,
  listDrafts: listGstFilingDrafts,
  listEvents: listGstFilingEvents,
  saveReview: saveGstFilingReview,
  requestOtp: requestGstOtpChallenge,
  getLatestOtp: getLatestGstOtpChallenge,
  recordOtpAttempt: recordGstOtpAttempt,
  recordOtpDeliveryFailure: recordGstOtpDeliveryFailure,
  claimSubmission: claimGstFilingSubmission,
  recordGspResponse: recordGstGspResponse,
  saveGspDraft: saveGstGspDraft,
  completeSubmission: completeGstGspSubmission,
  failSubmission: failGstGspSubmission,
};
