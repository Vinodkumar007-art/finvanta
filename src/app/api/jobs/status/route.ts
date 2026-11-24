import { apiCtx, json } from "@/lib/http";
import { can } from "@/lib/ctx";
import { getJobsQueue } from "@/services/jobs/queue";
import { getJobQueueStatus } from "@/services/jobs/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await apiCtx(request);
  if ("error" in auth) return auth.error;

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    if (!can(auth.ctx.role, "admin")) return json({ error: "Administrator access is required." }, 403);
    try {
      return json(await getJobQueueStatus());
    } catch (error) {
      console.error("[finvanta] job queue status failed", error);
      return json({ error: "Job queue status is currently unavailable." }, 503);
    }
  }

  try {
    const job = await getJobsQueue().getJob(jobId);
    if (!job) return json({ error: "Job not found." }, 404);
    const data = job.data;
    const administrator = can(auth.ctx.role, "admin");
    if (!administrator && (!("requestedBy" in data) || data.requestedBy !== auth.ctx.user.id)) {
      return json({ error: "Job not found." }, 404);
    }
    if (!administrator && "companyId" in data && !auth.ctx.companies.some((company) => company.id === data.companyId)) {
      return json({ error: "Job not found." }, 404);
    }

    return json({
      id: job.id,
      type: data.type,
      correlationId: data.correlationId,
      state: await job.getState(),
      progress: job.progress,
      createdAt: job.timestamp,
      processedAt: job.processedOn ?? null,
      finishedAt: job.finishedOn ?? null,
      result: job.returnvalue ?? null,
      error: administrator ? job.failedReason ?? null : undefined,
    });
  } catch (error) {
    console.error("[finvanta] job status lookup failed", error);
    return json({ error: "Job status is currently unavailable." }, 503);
  }
}
