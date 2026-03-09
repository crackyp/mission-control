import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CRON_PATH = runtimeConfig.cronJobsFile;

export async function GET() {
  try {
    const raw = await readFile(CRON_PATH, "utf-8");
    const data = JSON.parse(raw);
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    const scheduleData: Record<string, Array<{
      id: string;
      name: string;
      enabled: boolean;
      nextRun: number | null;
      lastRun: number | null;
      lastStatus: string | null;
    }>> = {};

    const now = Date.now();
    const horizon = now + 30 * 24 * 60 * 60 * 1000;

    for (const job of jobs) {
      if (!job.schedule) continue;

      const occurrences = getOccurrences(job.schedule, now, horizon);
      if (occurrences.length === 0) continue;

      for (const ts of occurrences) {
        const dateKey = new Date(ts).toISOString().split("T")[0];
        if (!scheduleData[dateKey]) scheduleData[dateKey] = [];
        scheduleData[dateKey].push({
          id: job.id,
          name: job.name,
          enabled: job.enabled !== false,
          nextRun: ts,
          lastRun: job.state?.lastRunAtMs || null,
          lastStatus: job.state?.lastStatus || null,
        });
      }
    }

    return NextResponse.json(scheduleData);
  } catch (error) {
    console.error("Failed to read cron jobs", error);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}

function getOccurrences(schedule: any, startMs: number, endMs: number): number[] {
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

  // step minute-by-minute across the window (<= 30 days)
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
