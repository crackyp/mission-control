import { NextResponse } from "next/server";
import { callCronGateway, readCronJobs } from "@/lib/openclaw-cron";

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

export async function GET() {
  try {
    const jobs = readCronJobs();
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
    const jobs = readCronJobs();
    const now = Date.now();

    let toClear: any[];
    if (body?.action === "clearStuck") {
      toClear = jobs.filter((job: any) => isStuck(job, now));
    } else if (body?.action === "clearById" && body?.id) {
      toClear = jobs.filter((job: any) => job?.id === body.id && isManualWake(job)).slice(0, 1);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Disabling through the gateway also clears nextRunAtMs/runningAtMs.
    for (const job of toClear) {
      await callCronGateway("cron.update", { id: job.id, patch: { enabled: false } });
    }
    const changed = toClear.length > 0;

    return NextResponse.json({ ok: true, changed });
  } catch (error) {
    console.error("Failed to clear wake queue", error);
    return NextResponse.json({ error: "Failed to clear wake queue" }, { status: 500 });
  }
}
