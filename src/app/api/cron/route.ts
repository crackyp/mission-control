import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CRON_PATH = runtimeConfig.cronJobsFile;

async function loadJobs() {
  const raw = await readFile(CRON_PATH, "utf-8");
  const data = JSON.parse(raw);
  return { data, jobs: Array.isArray(data.jobs) ? data.jobs : [] };
}

async function saveJobs(data: any) {
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
    const { jobs } = await loadJobs();
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to load cron jobs", error);
    return NextResponse.json({ error: "Failed to load cron jobs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { data, jobs } = await loadJobs();
    const now = Date.now();
    const newJob = {
      ...body,
      id: body.id || randomUUID(),
      createdAtMs: body.createdAtMs || now,
      updatedAtMs: now,
    };
    data.jobs = [...jobs, newJob];
    await saveJobs(data);
    return NextResponse.json({ job: newJob });
  } catch (error) {
    console.error("Failed to create cron job", error);
    return NextResponse.json({ error: "Failed to create cron job" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "Job id required" }, { status: 400 });
    }

    const { data, jobs } = await loadJobs();
    const now = Date.now();

    const updated = jobs.map((job: any) => {
      if (job.id !== body.id) return job;

      const wasEnabled = job.enabled !== false;
      const requestedEnabled = typeof body.enabled === "boolean" ? body.enabled : wasEnabled;
      const isReenable = !wasEnabled && requestedEnabled;
      const scheduleChanged = !!body.schedule;

      const merged = { ...job, ...body, updatedAtMs: now } as any;

      // IMPORTANT:
      // If a disabled job is re-enabled, stale scheduler state can cause
      // immediate or duplicate runs. Clear volatile runtime fields so the
      // scheduler recomputes from schedule cleanly.
      if ((isReenable || scheduleChanged) && merged.state) {
        const restState = { ...merged.state };
        delete restState.nextRunAtMs;
        delete restState.runningAtMs;
        // Prevent catch-up logic from treating this as long-overdue right away.
        if (isReenable) {
          restState.lastRunAtMs = now;
        }
        merged.state = restState;
      }

      // Re-enable guardrail for recurring interval jobs:
      // if an `every` job was paused, make the next run happen on the next
      // interval boundary rather than immediately on resume.
      if (isReenable && merged?.schedule?.kind === "every") {
        const everyMs = Number(merged?.schedule?.everyMs || 0);
        if (Number.isFinite(everyMs) && everyMs > 0) {
          merged.schedule = {
            ...merged.schedule,
            anchorMs: now + everyMs,
          };
        }
      }

      // Guardrail:
      // Some jobs carry wakeMode:"now" (one-shot wake flows). Re-enabling should
      // not force immediate execution unless explicitly intended.
      if (isReenable && merged.wakeMode === "now") {
        merged.wakeMode = "next-heartbeat";
      }

      // One-shot guardrail:
      // If an `at` job is already in the past, re-enabling it should NOT run now.
      // Keep it disabled and require an explicit new time to run again.
      if (isReenable && merged?.schedule?.kind === "at") {
        const atMs = Number(new Date(merged?.schedule?.at || 0).getTime());
        if (Number.isFinite(atMs) && atMs > 0 && atMs <= now) {
          merged.enabled = false;
          merged.state = {
            ...(merged.state || {}),
            lastError: "Refused to re-enable past one-shot job; set a new Run At time to execute again.",
          };
        }
      }

      return merged;
    });

    data.jobs = updated;
    await saveJobs(data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update cron job", error);
    return NextResponse.json({ error: "Failed to update cron job" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "Job id required" }, { status: 400 });
    }
    const { data, jobs } = await loadJobs();
    data.jobs = jobs.filter((job: any) => job.id !== body.id);
    await saveJobs(data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete cron job", error);
    return NextResponse.json({ error: "Failed to delete cron job" }, { status: 500 });
  }
}
