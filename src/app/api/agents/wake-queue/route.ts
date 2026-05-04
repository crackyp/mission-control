import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";
import { runtimeConfig } from "@/lib/runtime-config";

const CRON_PATH = runtimeConfig.cronJobsFile;

function toAtMs(schedule: any): number | undefined {
  if (!schedule) return undefined;
  if (typeof schedule.atMs === "number") return schedule.atMs;
  if (typeof schedule.at === "string") {
    const ms = new Date(schedule.at).getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

function isManualWake(job: any) {
  return typeof job?.name === "string" && job.name.startsWith("manual-wake-");
}

function isStuck(job: any, now: number) {
  if (!isManualWake(job)) return false;
  if (job?.enabled !== true) return false;

  const state = job?.state || {};
  const runningAtMs = typeof state.runningAtMs === "number" ? state.runningAtMs : undefined;
  const nextRunAtMs = typeof state.nextRunAtMs === "number" ? state.nextRunAtMs : undefined;
  const atMs = toAtMs(job?.schedule);

  if (runningAtMs && now - runningAtMs > 10 * 60 * 1000) return true;
  if (nextRunAtMs && now - nextRunAtMs > 2 * 60 * 1000) return true;
  if (atMs && now - atMs > 2 * 60 * 1000) return true;

  return false;
}

async function save(data: any) {
  await writeFile(CRON_PATH, JSON.stringify(data, null, 2));
  try {
    const pid = execSync("pgrep -f openclaw-gateway").toString().trim().split("\n")[0];
    if (pid) process.kill(Number(pid), "SIGUSR1");
  } catch {
    // ignore
  }
}

export async function GET() {
  try {
    const raw = await readFile(CRON_PATH, "utf-8");
    const data = JSON.parse(raw);
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const now = Date.now();

    const wakeJobs = jobs
      .filter((j: any) => isManualWake(j))
      .map((j: any) => ({
        id: j.id,
        name: j.name,
        enabled: j.enabled !== false,
        at: j?.schedule?.at,
        nextRunAtMs: j?.state?.nextRunAtMs,
        runningAtMs: j?.state?.runningAtMs,
        lastStatus: j?.state?.lastStatus,
        stuck: isStuck(j, now),
      }))
      .sort((a: any, b: any) => {
        const aMs = Number(new Date(a.at || 0).getTime() || a.nextRunAtMs || 0);
        const bMs = Number(new Date(b.at || 0).getTime() || b.nextRunAtMs || 0);
        return bMs - aMs;
      });

    return NextResponse.json({ wakeJobs });
  } catch (error) {
    console.error("Failed to load wake queue", error);
    return NextResponse.json({ error: "Failed to load wake queue" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const raw = await readFile(CRON_PATH, "utf-8");
    const data = JSON.parse(raw);
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const now = Date.now();

    let changed = false;

    if (body?.action === "clearStuck") {
      for (const job of jobs) {
        if (isStuck(job, now)) {
          job.enabled = false;
          job.updatedAtMs = now;
          const state = job.state || {};
          delete state.nextRunAtMs;
          delete state.runningAtMs;
          job.state = state;
          changed = true;
        }
      }
    } else if (body?.action === "clearById" && body?.id) {
      for (const job of jobs) {
        if (job?.id === body.id && isManualWake(job)) {
          job.enabled = false;
          job.updatedAtMs = now;
          const state = job.state || {};
          delete state.nextRunAtMs;
          delete state.runningAtMs;
          job.state = state;
          changed = true;
          break;
        }
      }
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (changed) await save(data);

    return NextResponse.json({ ok: true, changed });
  } catch (error) {
    console.error("Failed to clear wake queue", error);
    return NextResponse.json({ error: "Failed to clear wake queue" }, { status: 500 });
  }
}
