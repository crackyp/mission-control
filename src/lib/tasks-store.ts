import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

// Shared server-side store for the kanban tasks file (Sep 2026 write-path
// migration). Replaces the "client GETs everything and PUTs everything back"
// model: every mutation now runs through this module, so
//   - an in-process promise-chain lock serializes writers (no silent clobbers),
//   - writes are atomic (tmp file + rename — no half-written reads),
//   - a corrupt file is backed up instead of being "healed" into an empty board,
//   - a monotonic `rev` counter enables If-Match 409-on-stale checks,
//   - the On Hold agent guard and history attribution live in exactly one place.

export const TASKS_FILE_PATH = runtimeConfig.tasksFilePath;
const TASKS_DIR = path.dirname(TASKS_FILE_PATH);

export type TaskStatus = "todo" | "inprogress" | "done" | "onhold";

export type TaskHistoryEntry = {
  at: string;          // UTC ISO timestamp of the change
  from?: TaskStatus;   // previous status (undefined for task creation)
  to?: TaskStatus;     // new status (undefined if status didn't change in this write)
  by: string;          // who made the change: "Kevin" | agent identifier via X-Kanban-Actor
  note?: string;       // short free-text reason (optional)
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  history?: TaskHistoryEntry[];
  [key: string]: unknown;
};

export type TaskFile = {
  tasks: Task[];
  rev?: number;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  done: "Done",
  onhold: "On Hold",
};

// Thrown inside mutateTasks callbacks to abort a mutation with an HTTP status.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function isAgentActor(actor: string): boolean {
  return actor !== "Kevin";
}

// Extract an actor id from the X-Kanban-Actor header (agents identify themselves
// when they write, e.g. "bernie"). UI writes carry no header — only Kev uses the
// web UI, so unattributed writes are credited to "Kevin".
export function actorFrom(request: Request): string {
  const raw = request.headers.get("x-kanban-actor")?.trim();
  return raw && raw.length > 0 && raw.length <= 64 ? raw : "Kevin";
}

export function normalizeStatus(value: unknown): TaskStatus | null {
  return value === "todo" || value === "inprogress" || value === "done" || value === "onhold" ? value : null;
}

// Cards parked in "onhold" are Kev's — agents must leave them untouched. The
// legacy whole-file PUT carries every card (including held ones riding along
// unchanged), so we diff the incoming array against the stored one and reject
// only when a HELD card was actually modified. Agent writes must identify via
// X-Kanban-Actor; unattributed writes are the web UI (Kev) and always allowed.
function sameHeldCard(prev: Task, next: Task): boolean {
  // Comparison is on the card's meaningful fields, not reference identity.
  const comparable = (t: Task) =>
    JSON.stringify({ ...t, history: undefined });
  return comparable(prev) === comparable(next);
}

export function findHeldViolations(
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
  // New tasks arriving already in onhold are agent-created held cards.
  for (const next of nextTasks) {
    if (next.status === "onhold" && !prevById.has(next.id)) {
      violations.push({ id: next.id, title: next.title, field: "created as onhold" });
    }
  }
  return violations;
}

/**
 * Diff the incoming tasks array against the stored one and append history
 * entries for meaningful changes. Only status transitions are tracked (notes/
 * description/assignee edits don't pollute the activity log). Task creation is
 * also recorded. Returns the enriched tasks array.
 */
export function applyHistory(
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

// Server-generated ids keep the format the UI always produced.
export function newTaskId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Lock + file IO
// ---------------------------------------------------------------------------

// Serialize all mutations. Next.js runs the app as a single Node process, so a
// promise chain is a sufficient mutex; the chain survives individual failures.
let lock: Promise<unknown> = Promise.resolve();
export function withTasksLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

export async function readTasksFile(): Promise<TaskFile> {
  let raw: string;
  try {
    raw = await fs.readFile(TASKS_FILE_PATH, "utf8");
  } catch {
    return { tasks: [], rev: 0 };
  }
  try {
    const data = JSON.parse(raw) as TaskFile;
    if (!data || !Array.isArray(data.tasks)) return { tasks: [], rev: 0 };
    return { ...data, tasks: data.tasks };
  } catch {
    // Corrupt file: back it up and continue empty — never write an empty file
    // back over the corrupt one (the old auto-heal destroyed the evidence and
    // let the next poll turn a bad parse into total data loss).
    const backup = `${TASKS_FILE_PATH}.corrupt-${Date.now()}`;
    try {
      await fs.copyFile(TASKS_FILE_PATH, backup);
      console.error(`tasks file failed to parse — backed up to ${backup}`);
    } catch {
      console.error("tasks file failed to parse — backup failed");
    }
    return { tasks: [], rev: 0 };
  }
}

export async function writeTasksFile(data: TaskFile): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  const tmp = `${TASKS_FILE_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, TASKS_FILE_PATH);
}

/**
 * Run one serialized read-modify-write against the tasks file. The callback
 * receives the current file ({tasks, rev}) and the current UTC timestamp and
 * returns the new tasks array plus an optional result to pass back to the
 * caller. Throws ApiError to abort with an HTTP status; any other error
 * becomes a 500 at the route. Every successful write bumps `rev`.
 */
export async function mutateTasks<T>(
  mutate: (file: TaskFile, now: string) => { tasks: Task[]; result: T }
): Promise<T> {
  return withTasksLock(async () => {
    const prev = await readTasksFile();
    const now = new Date().toISOString();
    const { tasks, result } = mutate(prev, now);
    await writeTasksFile({ tasks, rev: (prev.rev ?? 0) + 1 });
    return result;
  });
}