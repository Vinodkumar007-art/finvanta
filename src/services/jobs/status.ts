import { getJobsQueue } from "./queue";

async function countRecent(state: "completed" | "failed", cutoff: number): Promise<number> {
  const queue = getJobsQueue();
  const pageSize = 500;
  const maxPages = 200;
  let start = 0;
  let count = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const jobs = await queue.getJobs([state], start, start + pageSize - 1, false);
    if (jobs.length === 0) break;
    let foundOlderJob = false;
    for (const job of jobs) {
      if (job.finishedOn && job.finishedOn >= cutoff) count += 1;
      else foundOlderJob = true;
    }
    if (foundOlderJob || jobs.length < pageSize) break;
    start += jobs.length;
  }
  return count;
}

export async function getJobQueueStatus() {
  const queue = getJobsQueue();
  const cutoff = Date.now() - 60 * 60 * 1000;
  const [counts, completedLastHour, failedLastHour, paused] = await Promise.all([
    queue.getJobCounts("wait", "active", "completed", "failed", "delayed"),
    countRecent("completed", cutoff),
    countRecent("failed", cutoff),
    queue.isPaused(),
  ]);
  const terminalCount = completedLastHour + failedLastHour;
  return {
    waiting: counts.wait ?? 0,
    delayed: counts.delayed ?? 0,
    active: counts.active ?? 0,
    completedLastHour,
    failedCount: counts.failed ?? 0,
    failedLastHour,
    failureRate: terminalCount === 0 ? 0 : failedLastHour / terminalCount,
    paused,
  };
}
