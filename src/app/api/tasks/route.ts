import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

const TASKS_FILE_PATH = runtimeConfig.tasksFilePath;
const TASKS_DIR = path.dirname(TASKS_FILE_PATH);

type TaskStatus = "todo" | "inprogress" | "done" | "onhold";

type TaskHistoryEntry = {
  at: string;          // UTC ISO timestamp of the change
  from?: TaskStatus;   // previous status (undefined for task creation)
  to?: TaskStatus;     // new status (undefined if status didn't change in this write)
  by: string;          // who made the change: "kanban-ui" | agent identifier passed via header
  note?: string;       // short free-text reason (optional)
};

type Task = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  history?: TaskHistoryEntry[];
};

type TaskFile = {
  tasks: Task[];
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  done: "Done",
  onhold: "On Hold",
};

// Cards parked in "onhold" are Kev's — agents must leave them untouched. The
// board's only write is a whole-file PUT, so every write carries every card
// (including held ones riding along unchanged). A naive "reject writes that
// mention held cards" rule would block ALL normal writes; instead we diff the
// incoming array against the stored one and reject only when a HELD card was
// actually modified. Unattributed writes are the web UI (only Kev uses it) and
// are always allowed; agent writes must identify via X-Kanban-Actor.
function isAgentActor(actor: string): boolean {
  return actor !== "Kevin";
}

function sameHeldCard(prev: Task, next: Task): boolean {
  // Comparison is on the card's meaningful fields, not reference identity.
  const comparable = (t: Task) =>
    JSON.stringify({ ...t, history: undefined });
  return comparable(prev) === comparable(next);
}

function findHeldViolations(
  prevTasks: Task[],
  nextTasks: Task[],
  actor: string
): { id: string; title: string; field?: string }[] {
  if (!isAgentActor(actor)) return [];
  const prevById = new Map(prevTasks.map((t) => [t.id, t]));
  const violations: { id: string; title: string; field?: string }[] = [];

  const nextById = new Map(nextTasks.map((t) => [t.id, t]));
  for (const prev of prevTasks) {
    if (prev.status !== "onhold") continue;
    const next = nextById.get(prev.id);
    if (!next) {
      violations.push({ id: prev.id, title: prev.title, field: "deleted" });
    } else if (!sameHeldCard(prev, next)) {
      violations.push({ id: prev.id, title: prev.title });
    }
  }
  // New tasks arriving already in onhold are also agent-created held cards —
  // allowed only if the actor is Kev; agents may not create on-hold cards.
  for (const next of nextTasks) {
    if (next.status === "onhold" && !prevById.has(next.id)) {
      violations.push({ id: next.id, title: next.title, field: "created as onhold" });
    }
  }
  return violations;
}

function normalizeStatus(value: unknown): TaskStatus | null {
  return value === "todo" || value === "inprogress" || value === "done" || value === "onhold" ? value : null;
}

// Extract an actor id from the X-Kanban-Actor header (agents identify themselves
// when they write, e.g. "bernie"). UI writes carry no header — only Kev uses the
// web UI, so unattributed writes are credited to "Kevin" (was "kanban-ui").
function actorFrom(request: Request): string {
  const raw = request.headers.get("x-kanban-actor")?.trim();
  return raw && raw.length > 0 && raw.length <= 64 ? raw : "Kevin";
}

/**
 * Diff the incoming tasks array against the stored one and append history
 * entries for meaningful changes. Only status transitions are tracked (notes/
 * description/assignee edits don't pollute the activity log). Task creation and
 * deletion are also recorded. Returns the enriched tasks array.
 */
function applyHistory(
  prevTasks: Task[],
  nextTasks: Task[],
  actor: string,
  now: string
): Task[] {
  const prevById = new Map(prevTasks.map((t) => [t.id, t]));

  return nextTasks.map((task) => {
    const prev = prevById.get(task.id);

    // New task → record creation.
    if (!prev) {
      const entry: TaskHistoryEntry = { at: now, to: task.status, by: actor, note: "Task created" };
      return { ...task, history: [...(task.history || []), entry] };
    }

    const to = normalizeStatus(task.status) ?? prev.status;
    if (to === prev.status) return task; // no status change → untouched history

    const entry: TaskHistoryEntry = {
      at: now,
      from: prev.status,
      to,
      by: actor,
    };
    // Completed/reopened/held transitions get a human-readable note for free.
    if (to === "done") entry.note = `Marked done (${STATUS_LABEL[prev.status]} → Done)`;
    if (prev.status === "done" && to !== "done") entry.note = `Reopened (Done → ${STATUS_LABEL[to]})`;
    if (to === "onhold") entry.note = `Put on hold (${STATUS_LABEL[prev.status]} → On Hold)`;
    if (prev.status === "onhold" && to !== "onhold") entry.note = `Taken off hold (On Hold → ${STATUS_LABEL[to]})`;

    return { ...task, history: [...(task.history || []), entry] };
  });
}

async function readTasksFile(): Promise<TaskFile> {
  try {
    const raw = await fs.readFile(TASKS_FILE_PATH, "utf8");
    const data = JSON.parse(raw) as TaskFile;
    if (!data || !Array.isArray(data.tasks)) {
      return { tasks: [] };
    }
    return data;
  } catch {
    const empty: TaskFile = { tasks: [] };
    await fs.mkdir(TASKS_DIR, { recursive: true });
    await fs.writeFile(TASKS_FILE_PATH, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

async function writeTasksFile(data: TaskFile) {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  await fs.writeFile(TASKS_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  const data = await readTasksFile();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function PUT(request: Request) {
  const actor = actorFrom(request);
  const body = (await request.json()) as TaskFile;
  const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
  const prev = await readTasksFile();

  // Agent writes must not modify On Hold cards — Kev's parking lot is off
  // limits (the UI writes without an actor header, so Kev is unaffected).
  const violations = findHeldViolations(prev.tasks, tasks, actor);
  if (violations.length > 0) {
    return NextResponse.json(
      {
        error:
          "On Hold cards are agent-protected — Kev moves them off hold himself",
        violations,
      },
      { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const withHistory = applyHistory(prev.tasks, tasks, actor, new Date().toISOString());
  await writeTasksFile({ tasks: withHistory });
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}