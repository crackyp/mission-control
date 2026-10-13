import { NextResponse } from "next/server";
import { readCronRuns } from "@/lib/openclaw-cron";
import {
  collectScheduleJobs,
  expandByDay,
  fetchHermesRunsSince,
  formatYmdLocal,
  type HermesRun,
  type SourceJob,
} from "@/lib/schedule-jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isHeartbeatJob(job: any) {
  return job?.name === "heartbeat-main" ||
    (job?.agentId === "main" && typeof job?.name === "string" && job.name.toLowerCase().includes("heartbeat")) ||
    (typeof job?.name === "string" && job.name.toLowerCase().startsWith("heartbeat-"));
}

// Runs since `sinceMs`, used to mark today's already-passed occurrences.
// OpenClaw keeps a full run log; Hermes runs come from its per-run output
// files (hermesRuns). If those couldn't be read, fall back to the job's most
// recent run (last_run_at/last_status), which covers its daily jobs.
function runsSince(
  job: SourceJob,
  sinceMs: number,
  hermesRuns: Map<string, HermesRun[]>,
): Array<{ atMs: number; status: string | null }> {
  if (job.source === "openclaw") {
    try {
      return readCronRuns(job.id, 100)
        .map((evt: any) => ({ atMs: Number(evt?.runAtMs || evt?.ts || 0), status: evt?.status || null }))
        .filter((r) => r.atMs >= sinceMs);
    } catch {
      return [];
    }
  }
  const fromFiles = hermesRuns.get(job.id);
  if (fromFiles) return fromFiles.filter((r) => r.atMs >= sinceMs);
  const atMs = job.state?.lastRunAtMs || 0;
  return atMs >= sinceMs ? [{ atMs, status: job.state?.lastStatus || null }] : [];
}

export async function GET() {
  try {
    const now = Date.now();
    const horizon = now + 30 * 24 * 60 * 60 * 1000;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const [jobs, hermesRuns] = await Promise.all([
      collectScheduleJobs(),
      fetchHermesRunsSince(formatYmdLocal(dayStart)),
    ]);

    const scheduleData: Record<string, Array<{
      id: string;
      name: string;
      enabled: boolean;
      nextRun: number | null;
      lastRun: number | null;
      lastStatus: string | null;
      source: string;
      runStatus?: string | null; // past occurrences only; null = no run recorded
    }>> = {};

    for (const job of jobs) {
      // Disabled jobs are INCLUDED so paused jobs stay visible on the
      // schedule (rendered faded/off in the UI); only heartbeats are skipped.
      if (!job.schedule) continue;
      if (isHeartbeatJob(job)) continue;

      // Cron/at jobs expand from midnight so today's earlier occurrences stay
      // on the week view with their run result. Interval jobs still start at
      // now: they're capped to one chip a day, which would otherwise always
      // land just after midnight.
      const isInterval = job.schedule.kind === "every" || job.schedule.kind === "interval";
      const byDay = expandByDay(job.schedule, isInterval ? now : dayStart.getTime(), horizon);
      if (byDay.size === 0) continue;

      const allTs = Array.from(byDay.values()).flat().sort((a, b) => a - b);
      const runs = !isInterval && allTs[0] <= now ? runsSince(job, dayStart.getTime(), hermesRuns) : [];

      for (const [dateKey, tsList] of byDay) {
        if (!scheduleData[dateKey]) scheduleData[dateKey] = [];
        for (const ts of tsList) {
          // A past occurrence owns the runs between it and the next one;
          // the latest of those decides its status.
          let runStatus: string | null | undefined;
          if (!isInterval && ts <= now) {
            const nextTs = allTs.find((t) => t > ts) ?? Infinity;
            const owned = runs.filter((r) => r.atMs >= ts && r.atMs < nextTs).sort((a, b) => b.atMs - a.atMs);
            runStatus = owned.length ? owned[0].status : null;
          }
          scheduleData[dateKey].push({
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            nextRun: ts,
            lastRun: job.state?.lastRunAtMs || null,
            lastStatus: job.state?.lastStatus || null,
            source: job.source,
            ...(runStatus !== undefined ? { runStatus } : {}),
          });
        }
      }
    }

    // Chronological within each day. expandByDay walks one job at a time, so
    // without this the day's entries come out grouped by job, not by clock.
    for (const dateKey of Object.keys(scheduleData)) {
      scheduleData[dateKey].sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0));
    }

    return NextResponse.json(scheduleData);
  } catch (error) {
    console.error("Failed to build schedule", error);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}