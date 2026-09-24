import { NextResponse } from "next/server";
import { collectScheduleJobs, expandByDay } from "@/lib/schedule-jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isHeartbeatJob(job: any) {
  return job?.name === "heartbeat-main" ||
    (job?.agentId === "main" && typeof job?.name === "string" && job.name.toLowerCase().includes("heartbeat")) ||
    (typeof job?.name === "string" && job.name.toLowerCase().startsWith("heartbeat-"));
}

export async function GET() {
  try {
    const jobs = await collectScheduleJobs();

    const scheduleData: Record<string, Array<{
      id: string;
      name: string;
      enabled: boolean;
      nextRun: number | null;
      lastRun: number | null;
      lastStatus: string | null;
      source: string;
    }>> = {};

    const now = Date.now();
    const horizon = now + 30 * 24 * 60 * 60 * 1000;

    for (const job of jobs) {
      // Disabled jobs are INCLUDED so paused jobs stay visible on the
      // schedule (rendered faded/off in the UI); only heartbeats are skipped.
      if (!job.schedule) continue;
      if (isHeartbeatJob(job)) continue;

      const byDay = expandByDay(job.schedule, now, horizon);
      if (byDay.size === 0) continue;

      for (const [dateKey, tsList] of byDay) {
        if (!scheduleData[dateKey]) scheduleData[dateKey] = [];
        for (const ts of tsList) {
          scheduleData[dateKey].push({
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            nextRun: ts,
            lastRun: job.state?.lastRunAtMs || null,
            lastStatus: job.state?.lastStatus || null,
            source: job.source,
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