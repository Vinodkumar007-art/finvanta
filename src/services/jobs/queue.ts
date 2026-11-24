import { createHash, randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";

const QUEUE_NAME = "finvanta-jobs";
const COMPLETED_RETENTION_SECONDS = 30 * 24 * 60 * 60;

const shared = globalThis as typeof globalThis & {
  __finvantaJobConnection?: IORedis;
  __finvantaJobQueue?: Queue<JobPayload>;
  __finvantaDeadLetterQueue?: Queue<DeadLetterPayload>;
};

const idempotencyKey = z.string().trim().min(1).max(128);
const emailSchema = z.object({
  type: z.literal("send-email"),
  requestedBy: z.string().uuid(),
  idempotencyKey,
  to: z.string().email().max(254),
  subject: z.string().trim().min(1).max(200),
  text: z.string().max(100_000).optional(),
  html: z.string().max(100_000).optional(),
  correlationId: z.string().uuid().default(() => randomUUID()),
}).refine((value) => Boolean(value.text || value.html), "Email text or HTML content is required.");

const reportSchema = z.object({
  type: z.literal("generate-report"),
  requestedBy: z.string().uuid(),
  idempotencyKey,
  companyId: z.string().uuid(),
  financialYearId: z.string().uuid(),
  reportKey: z.string().regex(/^[a-z0-9-]{1,64}$/),
  correlationId: z.string().uuid().default(() => randomUUID()),
});

const imageSchema = z.object({
  type: z.literal("process-image"),
  requestedBy: z.string().uuid(),
  idempotencyKey,
  companyId: z.string().uuid(),
  financialYearId: z.string().uuid(),
  documentId: z.string().uuid(),
  correlationId: z.string().uuid().default(() => randomUUID()),
});

const cleanupSchema = z.object({
  type: z.literal("cleanup-upload-orphans"),
  correlationId: z.string().uuid().default(() => randomUUID()),
});

export const jobPayloadSchema = z.discriminatedUnion("type", [
  emailSchema,
  reportSchema,
  imageSchema,
  cleanupSchema,
]);

export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type EmailJobInput = z.input<typeof emailSchema>;
export type ReportJobInput = z.input<typeof reportSchema>;
export type ImageJobInput = z.input<typeof imageSchema>;
export type JobEnqueueOptions = { priority?: number };
export type DeadLetterPayload = {
  originalJobId: string;
  originalName: string;
  payload: JobPayload;
  error: string;
  stack?: string;
  failedAt: string;
  correlationId: string;
};
export type JobResult = { downloadUrl?: string; filename?: string; rowCount?: number; imageUrl?: string; scanned?: number; deleted?: number; messageId?: string };

function redisConnection(): IORedis {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error("REDIS_URL is required for background jobs.");
  if (!shared.__finvantaJobConnection) {
    shared.__finvantaJobConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
    });
  }
  return shared.__finvantaJobConnection;
}

export function createWorkerConnection(): IORedis {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error("REDIS_URL is required for background jobs.");
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
  });
}

export function getJobsQueue(): Queue<JobPayload> {
  shared.__finvantaJobQueue ??= new Queue<JobPayload>(QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000, jitter: 0.5 },
      removeOnComplete: { age: COMPLETED_RETENTION_SECONDS, count: 50_000 },
      removeOnFail: { age: COMPLETED_RETENTION_SECONDS, count: 50_000 },
    },
  });
  return shared.__finvantaJobQueue;
}

export function getDeadLetterQueue(): Queue<DeadLetterPayload> {
  shared.__finvantaDeadLetterQueue ??= new Queue<DeadLetterPayload>("finvanta-jobs-dead-letter", {
    connection: redisConnection(),
    defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
  });
  return shared.__finvantaDeadLetterQueue;
}

function stableJobId(type: string, key: string): string {
  return `${type}-${createHash("sha256").update(key).digest("hex")}`;
}

async function enqueue<T extends JobPayload>(payload: T, options: JobEnqueueOptions = {}) {
  const queue = getJobsQueue();
  const priority = options.priority === undefined
    ? undefined
    : z.number().int().min(1).max(10).parse(options.priority);
  const job = await queue.add(payload.type, payload, {
    jobId: "idempotencyKey" in payload
      ? stableJobId(payload.type, payload.idempotencyKey)
      : undefined,
    priority,
  });
  return { id: job.id!, correlationId: payload.correlationId };
}

export async function enqueueEmail(input: EmailJobInput, options?: JobEnqueueOptions) {
  return enqueue(emailSchema.parse(input), options);
}

export async function enqueueReport(input: ReportJobInput, options?: JobEnqueueOptions) {
  return enqueue(reportSchema.parse(input), options);
}

export async function enqueueImageProcessing(input: ImageJobInput, options?: JobEnqueueOptions) {
  return enqueue(imageSchema.parse(input), options);
}

export async function scheduleUploadCleanup() {
  const queue = getJobsQueue();
  await queue.upsertJobScheduler(
    "hourly-upload-cleanup",
    { pattern: "0 * * * *" },
    {
      name: "cleanup-upload-orphans",
      data: cleanupSchema.parse({ type: "cleanup-upload-orphans" }),
    },
  );
}

export async function closeJobQueues() {
  await Promise.all([
    shared.__finvantaJobQueue?.close(),
    shared.__finvantaDeadLetterQueue?.close(),
    shared.__finvantaJobConnection?.quit(),
  ]);
  shared.__finvantaJobQueue = undefined;
  shared.__finvantaDeadLetterQueue = undefined;
  shared.__finvantaJobConnection = undefined;
}

export { COMPLETED_RETENTION_SECONDS, QUEUE_NAME };
