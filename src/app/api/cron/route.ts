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
  } catch (e) {
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
      const willBeEnabled = typeof body.enabled === "boolean" ? body.enabled : wasEnabled;
      const isReenable = !wasEnabled && willBeEnabled;
      const scheduleChanged = !!body.schedule;

      const merged = { ...job, ...body, updatedAtMs: now } as any;

      // IMPORTANT:
      // If a disabled job is re-enabled, stale nextRunAtMs can be in the past,
      // causing an immediate run. Clear nextRunAtMs so scheduler recomputes
      // from the schedule instead of treating it as overdue.
      if ((isReenable || scheduleChanged) && merged.state) {
        const { nextRunAtMs, ...restState } = merged.state;
        merged.state = restState;
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
