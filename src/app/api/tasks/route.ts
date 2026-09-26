import { NextResponse } from "next/server";
import {
  actorFrom,
  applyHistory,
  ApiError,
  findHeldViolations,
  mutateTasks,
  newTaskId,
  normalizeStatus,
  readTasksFile,
  STATUS_LABEL,
  type Task,
  type TaskStatus,
} from "@/lib/tasks-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const data = await readTasksFile();
  return NextResponse.json(data, { headers: NO_STORE });
}

// Legacy whole-file replace. Kept for: the web UI (until its call-sites migrate),
// the agent read-modify-write pattern in the mission-control-kanban skill, and
// older scripts. Retains the On Hold guard and history attribution.
export async function PUT(request: Request) {
  const actor = actorFrom(request);
  let body: { tasks?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const tasks = Array.isArray(body?.tasks) ? (body.tasks as Task[]) : [];

  try {
    const ok = await mutateTasks((file, now) => {
      // Agent writes must not modify On Hold cards — Kev's parking lot is off
      // limits (the UI writes without an actor header, so Kev is unaffected).
      const violations = findHeldViolations(file.tasks, tasks, actor);
      if (violations.length > 0) {
        throw new ApiError(
          403,
          "On Hold cards are agent-protected — Kev moves them off hold himself",
          { violations }
        );
      }
      const withHistory = applyHistory(file.tasks, tasks, actor, now);
      return { tasks: withHistory, result: true };
    });
    return NextResponse.json({ ok }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status, headers: NO_STORE });
    }
    console.error("PUT /api/tasks failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500, headers: NO_STORE });
  }
}

// Create one task server-side. Body: all fields optional except title/status;
// the server assigns the id and records "Task created" history.
export async function POST(request: Request) {
  const actor = actorFrom(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400, headers: NO_STORE });
  }
  const status = normalizeStatus(body.status) ?? "todo";

  try {
    const task = await mutateTasks((file, now) => {
      if (status === "onhold" && actor !== "Kevin") {
        throw new ApiError(403, "On Hold cards are agent-protected — Kev moves them off hold himself");
      }
      const task: Task = {
        ...body,
        id: newTaskId(),
        title,
        status,
        createdAt: now,
        history: [{ at: now, to: status, by: actor, note: "Task created" }],
      };
      return { tasks: [...file.tasks, task], result: task };
    });
    return NextResponse.json({ ok: true, task }, { status: 201, headers: NO_STORE });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    }
    console.error("POST /api/tasks failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500, headers: NO_STORE });
  }
}

// Patch one task by id (server does the read-modify-write). Body: any subset of
// { status, title, description, assignee, notes, completedAt, order } — unknown
// fields are rejected so clients can't smuggle whole-file semantics through.
export async function PATCH(request: Request) {
  const actor = actorFrom(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const { id } = body as { id?: unknown };
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400, headers: NO_STORE });
  }

  const ALLOWED = ["status", "title", "description", "assignee", "notes", "completedAt", "order", "attachments"];
  const unknown = Object.keys(body).filter((k) => k !== "id" && !ALLOWED.includes(k));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `unknown field(s): ${unknown.join(", ")} — PATCH takes per-task deltas only` },
      { status: 400, headers: NO_STORE }
    );
  }

  const nextStatus = body.status === undefined ? undefined : normalizeStatus(body.status);
  if (body.status !== undefined && nextStatus === null) {
    return NextResponse.json({ error: "invalid status" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await mutateTasks<{ task: Task; transition?: string }>((file, now) => {
      const idx = file.tasks.findIndex((t) => t.id === id);
      if (idx < 0) throw new ApiError(404, `task not found: ${id}`);

      const prev = file.tasks[idx];
      if (prev.status === "onhold" && actor !== "Kevin") {
        throw new ApiError(403, "On Hold cards are agent-protected — Kev moves them off hold himself");
      }

      const updated: Task = { ...prev };

      if (typeof body.title === "string" && body.title.trim()) updated.title = body.title.trim();
      if (typeof body.description === "string") updated.description = body.description;
      if (typeof body.assignee === "string") {
        updated.assignee = body.assignee.trim() ? body.assignee.trim() : undefined;
      }
      if (typeof body.notes === "string") updated.notes = body.notes;
      if (typeof body.completedAt === "string") updated.completedAt = body.completedAt;
      if (Array.isArray(body.attachments)) updated.attachments = body.attachments;
      if (nextStatus) updated.status = nextStatus;
      if (typeof body.order === "number" && Number.isFinite(body.order)) {
        // Move within the file array; UI derives column order from position.
        const [moved] = file.tasks.splice(idx, 1);
        const target = Math.max(0, Math.min(file.tasks.length, Math.round(body.order)));
        file.tasks.splice(target, 0, { ...moved, ...updated });
        return { tasks: file.tasks, result: { task: updated } };
      }

      const withHistory = applyHistory(file.tasks, [updated], actor, now);
      const merged = withHistory[0];
      file.tasks[idx] = merged;
      // Status transition label for the response.
      const label =
        nextStatus && nextStatus !== prev.status
          ? `${STATUS_LABEL[prev.status]} → ${STATUS_LABEL[nextStatus]}`
          : undefined;
      return { tasks: file.tasks, result: { task: merged, transition: label } };
    });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    }
    console.error("PATCH /api/tasks failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500, headers: NO_STORE });
  }
}