// Shared schedule expansion for Mission Control's schedule views.
//
// Merges cron jobs from two sources into one occurrence stream:
//   1. OpenClaw (Pi-local): runtimeConfig.cronJobsFile — schedule kinds
//      "at" | "every" (everyMs) | "cron" (expr).
//   2. Hermes (Mac + PC): fetched over SSH via the mc-cron.sh helper —
//      schedule kinds "at" | "interval" (minutes) | "cron" (expr).
//
// Cron field parsing supports lists, ranges (1-5), and steps (*/15, 1-5/2).
// The previous per-route parser dropped ranges silently, so jobs like
// "0 11 * * 1-5" or "0 3-6 * * *" never appeared on the calendar at all.
//
// Interval jobs are capped to one occurrence per day (the first) so an
// every-1m job can't flood the week view with 1440 chips.

import { readFile } from "fs/promises";
import { execFile } from "child_process";
import { runtimeConfig } from "./runtime-config";

const CRON_PATH = runtimeConfig.cronJobsFile;

// Same helper/env as /api/cron/hermes — MC runs on the Pi; Hermes lives on
// the Mac (ssh target) with the PC reached via the Mac-side helper hop.
const SSH_TARGET = process.env.MC_HERMES_SSH_TARGET || "kev@192.168.4.38";
const HELPER = process.env.MC_HERMES_CRON_HELPER || "/Users/kev/.hermes/scripts/mc-cron.sh";

const HERMES_INSTANCES = [
  { id: "mac", label: "Mac" },
  { id: "pc", label: "PC" },
] as const;

const HERMES_CACHE_TTL_MS = 60_000;

export type SourceJob = {
  id: string; // globally unique across sources (hermes ids are prefixed)
  name: string;
  enabled: boolean;
  source: "openclaw" | "mac" | "pc";
  schedule: any; // normalized: at | every(everyMs) | cron(expr)
  state?: any; // raw job state (openclaw: lastRunAtMs/lastStatus)
};

// --- cron expression expansion ---------------------------------------------

export function parseCronField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const v = part.trim();
    if (!v) continue;

    // step forms: "*\/N" or "A-B/N"
    let body = v;
    let step = 1;
    const slash = v.indexOf("/");
    if (slash !== -1) {
      body = v.slice(0, slash);
      step = parseInt(v.slice(slash + 1), 10);
      if (Number.isNaN(step) || step < 1) continue;
    }

    // range "A-B", star "*", or single value
    let lo = min;
    let hi = max;
    if (body !== "*") {
      const dash = body.indexOf("-");
      if (dash !== -1) {
        lo = parseInt(body.slice(0, dash), 10);
        hi = parseInt(body.slice(dash + 1), 10);
      } else {
        const n = parseInt(body, 10);
        if (Number.isNaN(n)) continue;
        if (slash !== -1) {
          lo = n;
          hi = max;
        } else {
          if (n < min || n > max) continue;
          out.add(n);
          continue;
        }
      }
      if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    }

    for (let n = Math.max(lo, min); n <= Math.min(hi, max); n += step) out.add(n);
  }
  return out;
}

export function expandCron(expr: string, startMs: number, endMs: number): number[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [minField, hourField, domField, monthField, dowField] = parts;

  const mins = parseCronField(minField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 6);
  if (mins.size === 0 || hours.size === 0 || doms.size === 0 || months.size === 0 || dows.size === 0) return [];

  const out: number[] = [];
  let current = new Date(startMs);
  current.setSeconds(0, 0);

  // step minute-by-minute across the window (callers keep windows small;
  // the calendar route passes one month, the schedule route 30 days)
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

// Normalize a job schedule (both source dialects) into at/every/cron.
function normalizeSchedule(schedule: any): any | null {
  if (!schedule || typeof schedule !== "object") return null;
  if (schedule.kind === "interval" && (schedule.minutes > 0 || schedule.everyMs > 0)) {
    const ms = schedule.minutes > 0 ? schedule.minutes * 60_000 : schedule.everyMs;
    return { kind: "every", everyMs: ms };
  }
  if (schedule.kind === "at" || schedule.kind === "every" || schedule.kind === "cron") return schedule;
  return null;
}

export function getOccurrences(schedule: any, startMs: number, endMs: number): number[] {
  const s = normalizeSchedule(schedule);
  if (!s) return [];

  if (s.kind === "at") {
    const at = new Date(s.at).getTime();
    return Number.isFinite(at) && at >= startMs && at <= endMs ? [at] : [];
  }

  if (s.kind === "every" && s.everyMs > 0) {
    const occurrences: number[] = [];
    let t = typeof s.anchorMs === "number" ? s.anchorMs : startMs;
    if (t < startMs) {
      const steps = Math.ceil((startMs - t) / s.everyMs);
      t = t + steps * s.everyMs;
    }
    while (t <= endMs) {
      occurrences.push(t);
      t += s.everyMs;
    }
    return occurrences;
  }

  if (s.kind === "cron" && typeof s.expr === "string") {
    return expandCron(s.expr, startMs, endMs);
  }

  return [];
}

const MAX_CRON_OCCURRENCES_PER_DAY = 50; // safety cap for pathological exprs

// Local-time YYYY-MM-DD. The client's week grid and calendar both look days
// up by LOCAL date keys; the old schedule route keyed occurrences by UTC
// date, which shifted evening runs onto the next day's column.
export function formatYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Expand into occurrences grouped by local YYYY-MM-DD, with per-day caps:
// interval ("every") jobs get ONE occurrence per day (the first); cron/at
// jobs get at most MAX_CRON_OCCURRENCES_PER_DAY.
export function expandByDay(schedule: any, startMs: number, endMs: number): Map<string, number[]> {
  const s = normalizeSchedule(schedule);
  const capped = !!s && s.kind === "every";
  const byDay = new Map<string, number[]>();
  const occurrences = getOccurrences(s, startMs, endMs);
  for (const ts of occurrences) {
    const key = formatYmdLocal(new Date(ts));
    const list = byDay.get(key);
    if (list) {
      if (capped) continue;
      if (list.length >= MAX_CRON_OCCURRENCES_PER_DAY) continue;
      list.push(ts);
    } else {
      byDay.set(key, [ts]);
    }
  }
  return byDay;
}

// --- source readers ---------------------------------------------------------

export async function readOpenClawJobs(): Promise<SourceJob[]> {
  try {
    const raw = await readFile(CRON_PATH, "utf-8");
    const data = JSON.parse(raw);
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs
      .filter((j: any) => j?.id && j?.name)
      .map((j: any) => ({
        ...j,
        id: String(j.id),
        name: String(j.name),
        enabled: j.enabled !== false,
        source: "openclaw" as const,
      }));
  } catch {
    return [];
  }
}

function runHelper(args: string[], timeoutMs: number): Promise<string | null> {
  // ssh re-parses the remote command with a shell, so quote every arg.
  const shq = (s: string) => "'" + s.replace(/'/g, `'\\''`) + "'";
  const remoteCmd = [HELPER, ...args].map(shq).join(" ");
  return new Promise((resolve) => {
    execFile(
      "ssh",
      [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new",
        SSH_TARGET,
        remoteCmd,
      ],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve((stdout || "").toString());
      }
    );
  });
}

// Hermes jobs with a 60s TTL cache — /api/schedule is polled every minute by
// every open MC tab and the calendar route needs the same data, so without a
// cache each poll would spawn fresh SSH sessions to the Mac (and Mac→PC hop).
let hermesCache: { at: number; jobs: SourceJob[] } | null = null;

async function fetchHermesJobsUncached(): Promise<SourceJob[]> {
  const results = await Promise.all(
    HERMES_INSTANCES.map(async (inst) => {
      const out = await runHelper([inst.id, "read"], 30000);
      if (!out) return [];
      try {
        const data = JSON.parse(out.trim());
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        return jobs
          .filter((j: any) => j?.id && j?.name)
          .map((j: any) => ({
            ...j,
            id: `${inst.id}:${j.id}`,
            name: String(j.name),
            enabled: j.enabled !== false,
            source: inst.id as "mac" | "pc",
          }));
      } catch {
        return [];
      }
    })
  );
  return results.flat();
}

export async function fetchHermesJobs(): Promise<SourceJob[]> {
  if (hermesCache && Date.now() - hermesCache.at < HERMES_CACHE_TTL_MS) {
    return hermesCache.jobs;
  }
  const jobs = await fetchHermesJobsUncached();
  hermesCache = { at: Date.now(), jobs };
  return jobs;
}

export async function collectScheduleJobs(): Promise<SourceJob[]> {
  const [openclaw, hermes] = await Promise.all([readOpenClawJobs(), fetchHermesJobs()]);
  return [...openclaw, ...hermes];
}