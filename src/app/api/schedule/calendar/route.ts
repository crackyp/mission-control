import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CRON_PATH = runtimeConfig.cronJobsFile;

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

    const raw = await readFile(CRON_PATH, "utf-8");
    const data = JSON.parse(raw);
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    const days: Record<string, { scheduled: any[]; runs: any[] }> = {};

    for (const job of jobs) {
      if (!job?.id || !job?.name || isHeartbeatJob(job)) continue;

      if (job.enabled !== false) {
        const occurrences = getOccurrences(job.schedule, startMs, endMs);
        for (const ts of occurrences) {
          const key = formatYmd(new Date(ts));
          if (!days[key]) days[key] = { scheduled: [], runs: [] };
          days[key].scheduled.push({
            id: job.id,
            name: job.name,
            timeMs: ts,
            enabled: true,
            status: job.state?.lastStatus || null,
          });
        }
      }

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
          const key = formatYmd(new Date(runAtMs));
          if (!days[key]) days[key] = { scheduled: [], runs: [] };
          days[key].runs.push({
            id: job.id,
            name: job.name,
            timeMs: runAtMs,
            status: evt?.status || evt?.action || null,
            summary: evt?.summary || null,
            durationMs: evt?.durationMs || null,
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

function getOccurrences(schedule: any, startMs: number, endMs: number): number[] {
  if (!schedule || !schedule.kind) return [];

  if (schedule.kind === "at") {
    const at = new Date(schedule.at).getTime();
    return at >= startMs && at <= endMs ? [at] : [];
  }

  if (schedule.kind === "every" && schedule.everyMs) {
    const occurrences: number[] = [];
    let t = typeof schedule.anchorMs === "number" ? schedule.anchorMs : startMs;
    if (t < startMs) {
      const steps = Math.ceil((startMs - t) / schedule.everyMs);
      t = t + steps * schedule.everyMs;
    }
    while (t <= endMs) {
      occurrences.push(t);
      t += schedule.everyMs;
    }
    return occurrences;
  }

  if (schedule.kind === "cron" && typeof schedule.expr === "string") {
    return expandCron(schedule.expr, startMs, endMs);
  }

  return [];
}

function expandCron(expr: string, startMs: number, endMs: number): number[] {
  const parts = expr.trim().split(" ");
  if (parts.length !== 5) return [];
  const [minField, hourField, domField, monthField, dowField] = parts;

  const mins = parseCronField(minField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 6);

  const out: number[] = [];
  let current = new Date(startMs);
  current.setSeconds(0, 0);

  while (current.getTime() <= endMs) {
    const m = current.getMinutes();
    const h = current.getHours();
    const d = current.getDate();
    const mo = current.getMonth() + 1;
    const dow = current.getDay();

    if (mins.has(m) && hours.has(h) && doms.has(d) && months.has(mo) && dows.has(dow)) {
      out.push(current.getTime());
    }

    current = new Date(current.getTime() + 60 * 1000);
  }

  return out;
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  if (field === "*") {
    return new Set(range(min, max));
  }
  const values = field.split(",").map((v) => v.trim()).filter(Boolean);
  const nums = values.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n));
  return new Set(nums.filter((n) => n >= min && n <= max));
}

function range(min: number, max: number) {
  const arr: number[] = [];
  for (let i = min; i <= max; i++) arr.push(i);
  return arr;
}
