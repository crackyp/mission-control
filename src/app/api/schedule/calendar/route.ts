import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";
import { collectScheduleJobs, expandByDay, formatYmdLocal } from "@/lib/schedule-jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toMs(dateStr: string, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  return new Date(`${dateStr}${suffix}`).getTime();
}

function isHeartbeatJob(job: any) {
  return job?.name === "heartbeat-main" ||
    (job?.agentId === "main" && typeof job?.name === "string" && job.name.toLowerCase().includes("heartbeat")) ||
    (typeof job?.name === "string" && job.name.toLowerCase().startsWith("heartbeat-"));
}

export async function GET(req: NextRequest) {
  try {
    const startQ = req.nextUrl.searchParams.get("start");
    const endQ = req.nextUrl.searchParams.get("end");
    const now = new Date();
    const start = startQ || formatYmd(new Date(now.getFullYear(), now.getMonth(), 1));
    const end = endQ || formatYmd(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const startMs = toMs(start, false);
    const endMs = toMs(end, true);

    const jobs = await collectScheduleJobs();

    const days: Record<string, { scheduled: any[]; runs: any[] }> = {};

    for (const job of jobs) {
      if (!job.id || !job.name || isHeartbeatJob(job)) continue;

      // Disabled jobs are expanded too so paused jobs stay visible on the
      // calendar; items carry enabled:false and the UI renders them faded/off.
      {
        const byDay = expandByDay(job.schedule, startMs, endMs);
        for (const [key, tsList] of byDay) {
          if (!days[key]) days[key] = { scheduled: [], runs: [] };
          for (const ts of tsList) {
            days[key].scheduled.push({
              id: job.id,
              name: job.name,
              timeMs: ts,
              enabled: job.enabled,
              status: job.state?.lastStatus || null,
              source: job.source,
            });
          }
        }
      }

      // Run history is Pi-local (OpenClaw) — Hermes run logs live on the
      // Mac/PC and aren't fetched here; scheduled occurrences still render.
      if (job.source !== "openclaw") continue;
      const runPath = join(runtimeConfig.openclawDir, "cron", "runs", `${job.id}.jsonl`);
      try {
        const runRaw = await readFile(runPath, "utf-8");
        const lines = runRaw.split("\n").filter(Boolean).slice(-300);
        for (const line of lines) {
          let evt: any = null;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          const runAtMs = Number(evt?.runAtMs || evt?.ts || 0);
          if (!runAtMs || runAtMs < startMs || runAtMs > endMs) continue;
          const key = formatYmdLocal(new Date(runAtMs));
          if (!days[key]) days[key] = { scheduled: [], runs: [] };
          days[key].runs.push({
            id: job.id,
            name: job.name,
            timeMs: runAtMs,
            status: evt?.status || evt?.action || null,
            summary: evt?.summary || null,
            durationMs: evt?.durationMs || null,
            source: job.source,
          });
        }
      } catch {
        // no runs yet for this job
      }
    }

    return NextResponse.json({ start, end, days });
  } catch (error) {
    console.error("Failed to build calendar schedule", error);
    return NextResponse.json({ error: "Failed to build calendar schedule" }, { status: 500 });
  }
}