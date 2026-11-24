import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { CompanyCtx } from "@/lib/ctx";
import {
  closeJobQueues,
  createWorkerConnection,
  getDeadLetterQueue,
  getJobsQueue,
  jobPayloadSchema,
  QUEUE_NAME,
  scheduleUploadCleanup,
  type JobPayload,
  type JobResult,
} from "@/services/jobs/queue";

async function getCompanyContext(input: {
  requestedBy: string;
  companyId: string;
  financialYearId: string;
}): Promise<CompanyCtx> {
  const [{ and, eq, isNull }, { db }, schema] = await Promise.all([
    import("drizzle-orm"),
    import("@/db"),
    import("@/db/schema"),
  ]);
  const [record] = await db.select({
    company: schema.companies,
    org: {
      id: schema.organisations.id,
      name: schema.organisations.name,
      plan: schema.organisations.plan,
    },
    user: {
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      mfaEnabled: schema.users.mfaEnabled,
    },
    role: schema.memberships.role,
  })
    .from(schema.companies)
    .innerJoin(schema.organisations, eq(schema.organisations.id, schema.companies.orgId))
    .innerJoin(schema.memberships, eq(schema.memberships.orgId, schema.organisations.id))
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(
      eq(schema.companies.id, input.companyId),
      eq(schema.memberships.userId, input.requestedBy),
      isNull(schema.companies.deletedAt),
      isNull(schema.organisations.deletedAt),
      isNull(schema.users.deletedAt),
    ))
    .limit(1);

  const allowedRoles = ["owner", "admin", "accountant", "analyst", "viewer"] as const;
  if (!record || !allowedRoles.includes(record.role as typeof allowedRoles[number])) {
    throw new Error("The requesting user no longer has access to this company.");
  }
  const [fy] = await db.select().from(schema.financialYears).where(and(
    eq(schema.financialYears.id, input.financialYearId),
    eq(schema.financialYears.companyId, record.company.id),
  )).limit(1);
  if (!fy) throw new Error("The requested financial year does not belong to this company.");
  const fys = await db.select().from(schema.financialYears).where(eq(schema.financialYears.companyId, record.company.id));
  const [prefs] = await db.select().from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, input.requestedBy)).limit(1);

  return {
    user: record.user,
    org: record.org,
    role: record.role as CompanyCtx["role"],
    companies: [record.company],
    company: record.company,
    fys,
    fy,
    prefs: prefs ?? null,
  };
}

async function processEmail(payload: Extract<JobPayload, { type: "send-email" }>): Promise<JobResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and an email sender address are required to send email jobs.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": createHash("sha256").update(payload.idempotencyKey).digest("hex"),
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
  const result: unknown = await response.json();
  const messageId = typeof result === "object" && result !== null && "id" in result && typeof result.id === "string"
    ? result.id
    : undefined;
  return { messageId };
}

async function processReport(payload: Extract<JobPayload, { type: "generate-report" }>): Promise<JobResult> {
  const [{ REPORTS, buildReport }, { createUploadReadUrl, putUploadObject }] = await Promise.all([
    import("@/services/reports"),
    import("@/services/upload-storage"),
  ]);
  const ctx = await getCompanyContext({
    requestedBy: payload.requestedBy,
    companyId: payload.companyId,
    financialYearId: payload.financialYearId,
  });
  if (!REPORTS.some((report) => report.key === payload.reportKey)) {
    throw new Error("The requested report type is not supported.");
  }
  const report = await buildReport(ctx, payload.reportKey);
  if (!report) throw new Error("The requested report could not be generated.");

  const hash = createHash("sha256").update(payload.idempotencyKey).digest("hex");
  const key = `reports/${payload.companyId}/${hash}.json`;
  const bytes = Buffer.from(JSON.stringify(report));
  await putUploadObject(key, bytes, "application/json", bytes.byteLength);
  const filename = `${payload.reportKey}.json`;
  const downloadUrl = await createUploadReadUrl(key, "application/json", filename);
  return { downloadUrl, filename, rowCount: report.rows.length };
}

async function processImage(payload: Extract<JobPayload, { type: "process-image" }>): Promise<JobResult> {
  const [{ and, eq, isNull }, { db }, schema, sharpModule, storage] = await Promise.all([
    import("drizzle-orm"),
    import("@/db"),
    import("@/db/schema"),
    import("sharp"),
    import("@/services/upload-storage"),
  ]);
  const [document] = await db.select().from(schema.documents).where(and(
    eq(schema.documents.id, payload.documentId),
    eq(schema.documents.companyId, payload.companyId),
    isNull(schema.documents.deletedAt),
  )).limit(1);
  if (!document || !document.storagePath.startsWith("s3://") || !document.mime.startsWith("image/")) {
    throw new Error("The requested image document is unavailable.");
  }
  const ctx = await getCompanyContext({
    requestedBy: payload.requestedBy,
    companyId: payload.companyId,
    financialYearId: payload.financialYearId,
  });
  if (!ctx || document.orgId !== ctx.org.id) throw new Error("The image does not belong to the requested organization.");

  const sourceKey = document.storagePath.slice("s3://".length);
  const source = await storage.getUploadObjectBytes(sourceKey, 10 * 1024 * 1024);
  const sharp = sharpModule.default;
  const output = await sharp(source, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const hash = createHash("sha256").update(payload.idempotencyKey).digest("hex");
  const key = `processed/${payload.companyId}/${document.id}/${hash}.webp`;
  await storage.putUploadObject(key, output, "image/webp", output.byteLength);
  return {
    imageUrl: await storage.createUploadReadUrl(key, "image/webp", `${document.id}.webp`, true),
  };
}

async function processCleanup(): Promise<JobResult> {
  const { cleanupOrphanedUploadObjects } = await import("@/services/upload-cleanup");
  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  do {
    const result = await cleanupOrphanedUploadObjects(cursor);
    scanned += result.scanned;
    deleted += result.deleted;
    cursor = result.continuationToken ?? undefined;
  } while (cursor);
  return { scanned, deleted };
}

async function processJob(job: Job<JobPayload>): Promise<JobResult> {
  const payload = jobPayloadSchema.parse(job.data);
  switch (payload.type) {
    case "send-email": return processEmail(payload);
    case "generate-report": return processReport(payload);
    case "process-image": return processImage(payload);
    case "cleanup-upload-orphans": return processCleanup();
  }
}

function log(level: "info" | "error", event: string, data: Record<string, unknown>) {
  const output = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...data });
  if (level === "error") console.error(output);
  else console.log(output);
}

async function start() {
  const concurrency = Number.parseInt(process.env.JOBS_CONCURRENCY ?? "4", 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("JOBS_CONCURRENCY must be an integer from 1 to 32.");
  }
  await scheduleUploadCleanup();
  const connection: IORedis = createWorkerConnection();
  const worker = new Worker<JobPayload, JobResult>(QUEUE_NAME, async (job) => {
    const startedAt = Date.now();
    try {
      const result = await processJob(job);
      log("info", "job.completed", {
        jobId: job.id,
        type: job.data.type,
        correlationId: job.data.correlationId,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      log("error", "job.attempt_failed", {
        jobId: job.id,
        type: job.data.type,
        correlationId: job.data.correlationId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown job failure",
      });
      throw error;
    }
  }, {
    connection,
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });

  const pendingDeadLetters = new Set<Promise<void>>();
  worker.on("failed", (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;

    const transfer = Promise.resolve().then(() => getDeadLetterQueue().add("terminal-failure", {
      originalJobId: job.id ?? "unknown",
      originalName: job.name,
      payload: job.data,
      error: error.message,
      stack: error.stack,
      failedAt: new Date().toISOString(),
      correlationId: typeof job.data?.correlationId === "string" ? job.data.correlationId : randomUUID(),
    }, {
      jobId: `dead-${createHash("sha256").update(job.id ?? randomUUID()).digest("hex")}`,
    })).then(() => undefined).catch((dlqError: unknown) => {
      log("error", "job.dead_letter_write_failed", {
        jobId: job.id,
        correlationId: typeof job.data?.correlationId === "string" ? job.data.correlationId : undefined,
        error: dlqError instanceof Error ? dlqError.message : "Unknown dead-letter failure",
      });
    });
    pendingDeadLetters.add(transfer);
    void transfer.then(() => pendingDeadLetters.delete(transfer));
  });
  worker.on("stalled", (jobId) => log("error", "job.stalled", { jobId }));
  worker.on("error", (error) => log("error", "worker.error", { error: error.message }));
  log("info", "worker.started", { concurrency });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log("info", "worker.shutdown_started", { signal });
    try {
      await worker.close();
      await Promise.all(pendingDeadLetters);
      await closeJobQueues();
      await connection.quit();
      log("info", "worker.shutdown_complete", { signal });
    } catch (error) {
      log("error", "worker.shutdown_failed", {
        signal,
        error: error instanceof Error ? error.message : "Unknown shutdown failure",
      });
      connection.disconnect();
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });
}

start().catch((error: unknown) => {
  log("error", "worker.start_failed", {
    error: error instanceof Error ? error.message : "Unknown startup failure",
  });
  process.exitCode = 1;
});
