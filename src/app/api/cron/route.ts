import { NextResponse } from "next/server";
import { callCronGateway, readCronJobs, toGatewaySchedule } from "@/lib/openclaw-cron";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fields cron.update accepts. The Cron editor posts the whole job back
// (id, state, timestamps, ...), which the gateway rejects, so PUT sends only
// the fields that actually changed.
const PATCH_KEYS = [
  "name",
  "description",
  "enabled",
  "deleteAfterRun",
  "agentId",
  "sessionKey",
  "schedule",
  "trigger",
  "sessionTarget",
  "wakeMode",
  "payload",
  "delivery",
  "failureAlert",
];

// The gateway rejects blank delivery strings; the editor sends "" for empty fields.
function withoutBlankStrings(obj: any) {
  if (!obj || typeof obj !== "object") return obj;
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== ""));
}

export async function GET() {
  try {
    const jobs = readCronJobs();
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to load cron jobs", error);
    return NextResponse.json({ error: "Failed to load cron jobs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const create = await req.json();
    // The gateway assigns id, timestamps and state.
    delete create.id;
    delete create.createdAtMs;
    delete create.updatedAtMs;
    delete create.state;
    const job = await callCronGateway("cron.add", {
      ...create,
      schedule: toGatewaySchedule(create.schedule),
      ...(create.delivery ? { delivery: withoutBlankStrings(create.delivery) } : {}),
    });
    return NextResponse.json({ job });
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

    const job = readCronJobs().find((j) => j.id === body.id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const now = Date.now();

    const patch: Record<string, any> = {};
    for (const key of PATCH_KEYS) {
      if (key in body && JSON.stringify(body[key]) !== JSON.stringify(job[key])) patch[key] = body[key];
    }
    if (patch.schedule) patch.schedule = toGatewaySchedule(patch.schedule);
    if (patch.delivery) patch.delivery = withoutBlankStrings(patch.delivery);
    // Patches merge, so an emptied Model field has to clear the override explicitly.
    if (patch.payload && job.payload?.model && !("model" in patch.payload)) {
      patch.payload = { ...patch.payload, model: null };
    }

    const wasEnabled = job.enabled !== false;
    const requestedEnabled = typeof body.enabled === "boolean" ? body.enabled : wasEnabled;
    const isReenable = !wasEnabled && requestedEnabled;
    const schedule = patch.schedule || job.schedule;

    // The gateway recomputes nextRunAtMs itself on enable/schedule changes.
    // These guardrails keep MC's re-enable behavior on top of that.

    // Re-enable guardrail for recurring interval jobs:
    // if an `every` job was paused, make the next run happen one full interval
    // from now rather than immediately on resume.
    if (isReenable && schedule?.kind === "every") {
      const everyMs = Number(schedule.everyMs || 0);
      if (Number.isFinite(everyMs) && everyMs > 0) {
        patch.schedule = { ...schedule, anchorMs: now + everyMs };
      }
    }

    // Guardrail:
    // Some jobs carry wakeMode:"now" (one-shot wake flows). Re-enabling should
    // not force immediate execution unless explicitly intended.
    if (isReenable && (patch.wakeMode ?? job.wakeMode) === "now") {
      patch.wakeMode = "next-heartbeat";
    }

    // One-shot guardrail:
    // If an `at` job is already in the past, re-enabling it should NOT run now.
    // Keep it disabled and require an explicit new time to run again.
    if (isReenable && schedule?.kind === "at") {
      const atMs = Number(new Date(schedule.at || 0).getTime());
      if (Number.isFinite(atMs) && atMs > 0 && atMs <= now) {
        patch.enabled = false;
        patch.state = {
          lastError: "Refused to re-enable past one-shot job; set a new Run At time to execute again.",
        };
      }
    }

    if (Object.keys(patch).length > 0) {
      await callCronGateway("cron.update", { id: body.id, patch });
    }
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
    await callCronGateway("cron.remove", { id: body.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete cron job", error);
    return NextResponse.json({ error: "Failed to delete cron job" }, { status: 500 });
  }
}
