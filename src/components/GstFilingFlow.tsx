"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { Badge, Card, Notice } from "@/components/ui";

const TaxTotalsSchema = z.object({
  taxable: z.string(),
  cgst: z.string(),
  sgst: z.string(),
  igst: z.string(),
  totalTax: z.string(),
});

const DraftPayloadSchema = z.object({
  period: z.string(),
  gstin: z.string(),
  sourceInvoiceIds: z.array(z.string()),
  lineItems: z.array(z.object({
    direction: z.enum(["outward", "purchase"]),
    gstRate: z.number(),
    taxType: z.enum(["intrastate", "interstate"]),
    taxable: z.string(),
    cgst: z.string(),
    sgst: z.string(),
    igst: z.string(),
    totalTax: z.string(),
    invoiceCount: z.number(),
    invoiceNumbers: z.array(z.string()),
  })),
  totals: z.object({
    outward: TaxTotalsSchema,
    purchasesFromBooks: TaxTotalsSchema,
    inputTaxCredit: z.object({ claimed: TaxTotalsSchema, note: z.string() }),
    netTaxPayable: z.object({ igst: z.string(), cgst: z.string(), sgst: z.string(), total: z.string() }),
    lateFeeInterest: z.object({
      status: z.enum(["overdue_review_required", "not_configured"]),
      amount: z.null(),
      message: z.string(),
    }),
  }),
  checks: z.array(z.object({
    code: z.string(),
    status: z.enum(["pass", "fail", "not_configured"]),
    message: z.string(),
  })),
});

const ReviewNotesSchema = z.object({
  summary: z.string(),
  filingSummary: z.string(),
  anomalies: z.array(z.object({
    checkCode: z.string().optional(),
    lineIndex: z.number().optional(),
    note: z.string(),
  })),
  safetyNote: z.string().optional(),
  model: z.string(),
});

const EventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  actorUserId: z.string(),
  actorName: z.string().optional(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const DraftSchema = z.object({
  id: z.string(),
  period: z.string(),
  gstin: z.string(),
  status: z.string(),
  payload: DraftPayloadSchema,
  reviewNotes: ReviewNotesSchema.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  arn: z.string().nullable(),
  filedAt: z.string().nullable(),
  gspResponse: z.unknown().nullable(),
  createdAt: z.string(),
  otp: z.object({
    requestedAt: z.string(),
    expiresAt: z.string(),
    lockedUntil: z.string().nullable(),
    verifiedAt: z.string().nullable(),
  }).nullable().optional(),
  events: z.array(EventSchema).optional(),
});

const DraftListSchema = z.object({ drafts: z.array(DraftSchema) });
const DraftResponseSchema = z.object({ draft: DraftSchema });
const OtpRequestResponseSchema = z.object({ message: z.string(), expiresAt: z.string() });
const OtpVerifyResponseSchema = z.object({ approved: z.literal(true), message: z.string() });

type FilingDraft = z.infer<typeof DraftSchema>;

async function apiRequest(url: string, method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The filing API returned an invalid response.");
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(error.success ? error.data.error : `GST filing request failed (${response.status}).`);
  }
  return payload;
}

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function remaining(target: string | null | undefined, now: number) {
  if (!target) return 0;
  return Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000));
}

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function responseError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.error && typeof record.error === "object" && "message" in record.error && typeof record.error.message === "string") {
    return record.error.message;
  }
  if (Array.isArray(record.errors)) {
    const messages = record.errors.flatMap((item) =>
      item && typeof item === "object" && "message" in item && typeof item.message === "string" ? [item.message] : [],
    );
    return messages.join("; ") || null;
  }
  return null;
}

export default function GstFilingFlow(props: {
  companyName: string;
  canWrite: boolean;
  canApprove: boolean;
  gstEnv: string;
  gspProvider: string;
  initialPeriod: string;
}) {
  const enabled = props.gstEnv === "sandbox" && props.gspProvider === "mock";
  const [period, setPeriod] = useState(props.initialPeriod);
  const [drafts, setDrafts] = useState<FilingDraft[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<FilingDraft | null>(null);
  const [code, setCode] = useState("");
  const [resendAfter, setResendAfter] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDraft = useCallback(async (draftId: string) => {
    const response = DraftResponseSchema.parse(await apiRequest(`/api/tax/filings/${encodeURIComponent(draftId)}`));
    setSelectedId(draftId);
    setDraft(response.draft);
    setCode("");
    setResendAfter(response.draft.otp?.requestedAt
      ? new Date(new Date(response.draft.otp.requestedAt).getTime() + 60_000).toISOString()
      : null);
  }, []);

  const refresh = useCallback(async (preferredId?: string) => {
    const response = DraftListSchema.parse(await apiRequest("/api/tax/filings"));
    setDrafts(response.drafts);
    const id = preferredId ?? selectedId;
    const next = id && response.drafts.some((item) => item.id === id) ? id : response.drafts[0]?.id ?? "";
    if (next) await loadDraft(next);
    else {
      setSelectedId("");
      setDraft(null);
    }
  }, [loadDraft, selectedId]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load GST drafts."));
    }, 0);
    return () => clearTimeout(timer);
  }, [enabled, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiredIn = clock === 0 ? 0 : remaining(draft?.otp?.expiresAt, clock);
  const lockRemaining = clock === 0 ? 0 : remaining(draft?.otp?.lockedUntil, clock);
  const resendRemaining = clock === 0 ? 0 : remaining(resendAfter, clock);
  const approvalExpiresAt = draft?.approvedAt ? new Date(new Date(draft.approvedAt).getTime() + 10 * 60_000).toISOString() : null;
  const approvalRemaining = clock === 0 ? 0 : remaining(approvalExpiresAt, clock);
  const needsNewApproval = draft
    ? ["REVIEWED", "OTP_PENDING", "SUBMIT_FAILED", "REJECTED"].includes(draft.status) || (draft.status === "APPROVED" && approvalRemaining === 0)
    : false;
  const canRequestCode = Boolean(clock && draft?.reviewNotes && needsNewApproval && lockRemaining === 0 && resendRemaining === 0);
  const canVerifyCode = Boolean(clock && draft?.status === "OTP_PENDING" && expiredIn > 0 && lockRemaining === 0 && /^\d{6}$/.test(code));
  const hasFailedChecks = draft?.payload.checks.some((check) => check.status === "fail") ?? false;
  const apiUrl = useMemo(() => selectedId ? `/api/tax/filings/${encodeURIComponent(selectedId)}` : "", [selectedId]);

  async function runAction(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GST filing operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const response = DraftResponseSchema.parse(await apiRequest("/api/tax/filings", "POST", { period }));
      setNotice("Monthly draft created from approved invoice data.");
      await refresh(response.draft.id);
    });
  }

  async function reviewDraft() {
    if (!draft) return;
    await runAction(async () => {
      await apiRequest(`${apiUrl}/review`, "POST");
      setNotice("AI review saved. Read the notes and verify the figures independently.");
      await refresh(draft.id);
    });
  }

  async function requestCode() {
    if (!draft) return;
    await runAction(async () => {
      const response = OtpRequestResponseSchema.parse(await apiRequest(`${apiUrl}/otp`, "POST", { action: "request" }));
      setResendAfter(new Date(Date.now() + 60_000).toISOString());
      setNotice(response.message);
      await refresh(draft.id);
    });
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    await runAction(async () => {
      const response = OtpVerifyResponseSchema.parse(await apiRequest(`${apiUrl}/otp`, "POST", { action: "verify", code }));
      setCode("");
      setNotice(response.message);
      await refresh(draft.id);
    });
  }

  async function submitDraft() {
    if (!draft) return;
    await runAction(async () => {
      await apiRequest(`${apiUrl}/submit`, "POST");
      setNotice("Mock GSP response received. No real GST filing was made.");
      await refresh(draft.id);
    });
  }

  return (
    <div className="space-y-4">
      <div role="alert" className={`rounded-lg border px-4 py-3 text-sm font-bold ${enabled ? "border-amber-500 bg-amber-950 text-amber-100" : "border-down/40 bg-down/5 text-down"}`}>
        GST ENV: {props.gstEnv.toUpperCase() || "NOT SET"} · {props.gspProvider.toUpperCase() || "GSP NOT SET"}
        {enabled ? " — MOCK GSP — no real filing is happening" : " — filing workflow disabled; configure sandbox and mock mode"}
      </div>

      <Notice tone="warn" title="Development-only GST filing flow">
        This workflow can only create a fabricated filing result from the local mock GSP. It cannot submit to GSTN. OTP delivery is a development-console stub; the labeled code appears only in the server console.
      </Notice>
      <Notice tone="info" title="Professional review required">
        This tool assists with GST return preparation. It does not replace professional advice. {props.companyName} is responsible for the accuracy and timeliness of its own filings.
      </Notice>

      {!enabled ? (
        <Card title="GST filing workflow unavailable">
          <p className="text-sm text-muted">The workflow requires <code>GST_ENV=sandbox</code>, <code>GSP_PROVIDER=mock</code>, and a non-production server.</p>
        </Card>
      ) : (
        <>
          {error && <Notice tone="error" title="Operation could not be completed">{error}</Notice>}
          {notice && <Notice tone="ok">{notice}</Notice>}

          <Card title="Monthly filing drafts" subtitle="Only approved sales and purchase invoices for the selected period are included.">
            <div className="flex flex-wrap items-end gap-3">
              <form className="flex flex-wrap items-end gap-2" onSubmit={createDraft}>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted">Return period</span>
                  <input className="inp" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} required />
                </label>
                <button className="btn btn-sm" type="submit" disabled={!props.canWrite || busy}>
                  {busy ? "Working…" : "Build draft"}
                </button>
              </form>
              {drafts.length > 0 && (
                <label className="block min-w-56 text-xs">
                  <span className="mb-1 block text-muted">Existing draft</span>
                  <select className="inp" value={selectedId} onChange={(event) => {
                    setError("");
                    void loadDraft(event.target.value).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load draft."));
                  }}>
                    {drafts.map((item) => <option key={item.id} value={item.id}>{item.period} · {item.status}</option>)}
                  </select>
                </label>
              )}
            </div>
            {!props.canWrite && <p className="mt-2 text-xs text-muted">Your role can view GST drafts but cannot create them.</p>}
          </Card>

          {draft && (
            <Card title={`GST return draft · ${draft.period}`} subtitle={`${props.companyName} · GSTIN ${draft.gstin}`} action={<Badge tone={draft.status === "FILED" ? "up" : draft.status === "REJECTED" || draft.status === "SUBMIT_FAILED" ? "down" : "warn"}>{draft.status}</Badge>}>
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-line p-3"><div className="text-[11px] uppercase text-muted">Outward taxable supplies</div><div className="num mt-1 text-lg font-semibold">{money(draft.payload.totals.outward.taxable)}</div></div>
                  <div className="rounded-lg border border-line p-3"><div className="text-[11px] uppercase text-muted">Output tax</div><div className="num mt-1 text-lg font-semibold">{money(draft.payload.totals.outward.totalTax)}</div></div>
                  <div className="rounded-lg border border-line p-3"><div className="text-[11px] uppercase text-muted">Net tax payable</div><div className="num mt-1 text-lg font-semibold">{money(draft.payload.totals.netTaxPayable.total)}</div></div>
                </div>

                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>Line</th><th>Rate</th><th>Tax type</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th></tr></thead>
                    <tbody>
                      {draft.payload.lineItems.map((line, index) => (
                        <tr key={`${line.direction}-${line.gstRate}-${line.taxType}`}>
                          <td>{line.direction === "outward" ? "Outward supply" : "Purchase"} · {line.invoiceCount} invoice(s)</td>
                          <td className="num">{line.gstRate}%</td><td>{line.taxType}</td>
                          <td className="r num">{money(line.taxable)}</td><td className="r num">{money(line.cgst)}</td><td className="r num">{money(line.sgst)}</td><td className="r num">{money(line.igst)}</td>
                        </tr>
                      ))}
                      {draft.payload.lineItems.length === 0 && <tr><td colSpan={7} className="text-center text-muted">No approved invoices were found for this period.</td></tr>}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-1">
                  <h3 className="text-xs font-semibold">Draft checks</h3>
                  {draft.payload.checks.map((check) => (
                    <div key={check.code} className="flex flex-wrap items-start gap-2 text-xs">
                      <Badge tone={check.status === "pass" ? "up" : check.status === "fail" ? "down" : "warn"}>{check.status.replace("_", " ")}</Badge>
                      <span>{check.message}</span>
                    </div>
                  ))}
                </div>

                <Notice tone="warn" title="ITC and late fee/interest">
                  Purchase tax in the books: {money(draft.payload.totals.purchasesFromBooks.totalTax)}. Claimed ITC: {money(draft.payload.totals.inputTaxCredit.claimed.totalTax)}. {draft.payload.totals.inputTaxCredit.note} {draft.payload.totals.lateFeeInterest.message}
                </Notice>

                {draft.reviewNotes ? (
                  <section className="rounded-xl border border-accent/40 bg-accent/5 p-3">
                    <h3 className="text-sm font-semibold">AI-generated review — verify independently.</h3>
                    <p className="mt-1 text-sm">{draft.reviewNotes.summary}</p>
                    <p className="mt-2 text-xs font-medium">{draft.reviewNotes.filingSummary}</p>
                    {draft.reviewNotes.safetyNote && <p className="mt-2 text-xs text-warn">{draft.reviewNotes.safetyNote}</p>}
                    {draft.reviewNotes.anomalies.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {draft.reviewNotes.anomalies.map((item, index) => <li key={`${item.checkCode ?? item.lineIndex}-${index}`}>{item.note} <span className="text-muted">({item.checkCode ? `check: ${item.checkCode}` : `line ${Number(item.lineIndex) + 1}`})</span></li>)}
                      </ul>
                    )}
                  </section>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
                    <p className="text-xs text-muted">AI review is read-only and uses structured filing values and check results.</p>
                    <button className="btn btn-sm" onClick={() => void reviewDraft()} disabled={!props.canApprove || busy || draft.status !== "DRAFT"}>
                      {busy ? "Working…" : "Run AI review"}
                    </button>
                  </div>
                )}

                {draft.status === "DRAFT" && draft.reviewNotes && (
                  <button className="btn btn-sm" onClick={() => void reviewDraft()} disabled={!props.canApprove || busy}>Review draft</button>
                )}

                {draft.reviewNotes && needsNewApproval && (
                  <div className="space-y-3 rounded-lg border border-line p-3">
                    <p className="text-sm font-medium">Request an approval code only after reading the draft and AI review.</p>
                    {draft.status === "OTP_PENDING" && (
                      <form className="flex flex-wrap items-end gap-2" onSubmit={verifyCode}>
                        <label className="block text-xs">
                          <span className="mb-1 block text-muted">Six-digit approval code</span>
                          <input className="inp num w-40" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                        </label>
                        <button className="btn btn-sm" type="submit" disabled={!props.canApprove || !canVerifyCode || busy}>Verify code</button>
                        <span className="text-xs text-muted">{expiredIn > 0 ? `Code expires in ${formatCountdown(expiredIn)}.` : "Code expired; request a new code."}</span>
                      </form>
                    )}
                    {lockRemaining > 0 && <p className="text-xs text-down">Approval is locked for {formatCountdown(lockRemaining)}.</p>}
                    <button className="btn btn-sm" onClick={() => void requestCode()} disabled={!props.canApprove || !canRequestCode || busy || hasFailedChecks}>
                      {draft.status === "OTP_PENDING" ? "Resend approval code" : draft.status === "APPROVED" ? "Request new approval code" : "Request approval code"}
                    </button>
                    {resendRemaining > 0 && <p className="text-xs text-muted">Resend available in {formatCountdown(resendRemaining)}.</p>}
                    {hasFailedChecks && <p className="text-xs text-down">Resolve failed checks in the source records and build a new draft before approval.</p>}
                    <p className="text-xs font-semibold text-warn">This will submit a MOCK filing for {draft.period}. No real filing will occur.</p>
                  </div>
                )}

                {draft.status === "APPROVED" && approvalRemaining > 0 && (
                  <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/5 p-3">
                    <p className="text-xs font-semibold text-warn">This will submit a MOCK filing for {draft.period}. No real filing will occur.</p>
                    <p className="text-xs text-muted">Approval expires in {formatCountdown(approvalRemaining)}. Only the user who verified the code may submit.</p>
                    <button className="btn btn-sm" onClick={() => void submitDraft()} disabled={!props.canApprove || busy}>Submit mock filing</button>
                  </div>
                )}
                {draft.status === "APPROVED" && approvalRemaining === 0 && (
                  <Notice tone="warn">Approval expired. Request and verify a new code before submitting.</Notice>
                )}

                {["FILED", "REJECTED", "SUBMIT_FAILED"].includes(draft.status) && (
                  <Notice tone={draft.status === "FILED" ? "ok" : "error"} title={`Mock GSP status: ${draft.status}`}>
                    {draft.arn && <span>Mock ARN: <code>{draft.arn}</code>. </span>}
                    {draft.filedAt && <span>Mock timestamp: {new Date(draft.filedAt).toLocaleString()}. </span>}
                    {responseError(draft.gspResponse)}
                    {draft.status !== "FILED" && " A fresh OTP approval is required before another attempt."}
                    {" "}<a className="underline" href="#filing-audit">View audit log</a>
                  </Notice>
                )}

                <section id="filing-audit" className="border-t border-line pt-3">
                  <h3 className="text-xs font-semibold">Immutable filing audit log</h3>
                  <ol className="mt-2 space-y-2">
                    {(draft.events ?? []).map((event) => (
                      <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                        <span><b className="text-fg">{event.eventType.replaceAll("_", " ")}</b> · {event.actorName ?? event.actorUserId}</span>
                        <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                      </li>
                    ))}
                    {(draft.events ?? []).length === 0 && <li className="text-[11px] text-muted">No audit events are available.</li>}
                  </ol>
                </section>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
