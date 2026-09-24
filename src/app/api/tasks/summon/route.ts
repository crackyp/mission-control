import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Summon Bernie (the default Hermes agent on the Mac) to work kanban cards.
//
// POST { ids: string[], model?: string } creates ONE one-shot Hermes cron job
// that works the cards in order — one job, not one per card, so parallel runs
// never race each other's full-array PUTs to /api/tasks. The job goes through
// the same ssh → mc-cron.sh → `hermes cron create` path as /api/cron/hermes,
// is scheduled SUMMON_DELAY_MS ahead (the Hermes ticker fires due jobs within
// ~60s), and retires itself after its one run. model "" = Bernie's default.

const SSH_TARGET = process.env.MC_HERMES_SSH_TARGET || "kev@192.168.4.38";
const HELPER = process.env.MC_HERMES_CRON_HELPER || "/Users/kev/.hermes/scripts/mc-cron.sh";
const TASKS_API = process.env.MC_TASKS_API_URL || "http://192.168.7.111:3000/api/tasks";
const SUMMON_DELAY_MS = 20_000;
const MAX_CARDS = 10;
const TASK_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
const MODEL_RE = /^[a-zA-Z0-9._:-]{1,80}$/;

type TaskStatus = "todo" | "inprogress" | "done";
type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  history?: { at: string; from?: TaskStatus; to?: TaskStatus; by: string; note?: string }[];
  [key: string]: unknown;
};

function runHelper(args: string[]): Promise<{ ok: boolean; output: string; error?: string }> {
  // One remote command string with POSIX single-quoting: ssh re-parses argv
  // on the far side, so an array would not survive the hop (see /api/cron/hermes).
  const shq = (s: string) => "'" + s.replace(/'/g, `'\\''`) + "'";
  const remoteCmd = [HELPER, ...args].map(shq).join(" ");
  return new Promise((resolve) => {
    execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", SSH_TARGET, remoteCmd],
      { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || "").toString();
        if (err) resolve({ ok: false, output: out, error: err.killed ? "timed out" : (out.trim() || stderr || err.message) });
        else resolve({ ok: true, output: out });
      }
    );
  });
}

function buildPrompt(cards: Task[]): string {
  const list = cards.map((t, i) => `${i + 1}. ${t.id} — ${t.title}`).join("\n");
  return `Kevin summoned you from the Mission Control Kanban board (skill mission-control-kanban is already loaded) to work ${cards.length === 1 ? "this card" : `these ${cards.length} cards, in this order`}:

${list}

Board API: ${TASKS_API}

FOR EACH CARD, in order:
1. GET /api/tasks and find the card by id. If it is already 'done', skip it.
2. Claim BEFORE working: full-array read-modify-write PUT setting status='inprogress', with header 'X-Kanban-Actor: bernie'. Verify the round-trip (task count unchanged, card at inprogress).
3. Work it: read the title + description literally (they are Kevin's requests in his own words). Identify the project, load its skill, and follow that project's REAL deploy/verify pipeline.
4. Validate for real: run the app/tests, hit the live endpoint, check the changed UI. NEVER fabricate validation output — Kevin checks.
5. Close out: full-array PUT → status 'done', completedAt = CURRENT UTC ISO (get the real clock via terminal 'date -u'), append to notes: '[bernie YYYY-MM-DD] <what changed>; validated: <how, with real output>'. Re-GET and confirm.
6. Blocked, or running low on time/turn budget → full-array PUT the card back to 'todo' with the blocker explained in notes. NEVER leave a card 'inprogress' at the end of your run; NEVER mark an unvalidated card done.

HARD RULES:
- Every PUT carries the FULL tasks array (PUT replaces the whole file — a partial PUT destroys all other cards). Verify the task count after every PUT.
- Only touch the cards listed above; never reorder or delete other cards.
- NEVER run recursive/bulk delete commands (rm -rf, find -delete, git clean -fdx or similar) — this run has no user present to approve them. Use targeted single-file deletes or mv instead.
- You cannot ask questions in this run: make reasonable engineering decisions and document them in the card notes.
- Final response: one short line per card — id, done/blocked, and what changed.`;
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers });
  }

  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0 || ids.length > MAX_CARDS || !ids.every((id) => TASK_ID_RE.test(id))) {
    return NextResponse.json({ error: `pick 1-${MAX_CARDS} cards` }, { status: 400, headers });
  }
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (model && !MODEL_RE.test(model)) {
    return NextResponse.json({ error: "invalid model name" }, { status: 400, headers });
  }

  try {
    const file = JSON.parse(await fs.readFile(runtimeConfig.tasksFilePath, "utf8")) as { tasks: Task[] };
    const byId = new Map(file.tasks.map((t) => [t.id, t]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      return NextResponse.json({ error: `card not found: ${missing.join(", ")}` }, { status: 404, headers });
    }
    const cards = ids.map((id) => byId.get(id)!).filter((t) => t.status !== "done");
    if (cards.length === 0) {
      return NextResponse.json({ error: "all selected cards are already done" }, { status: 400, headers });
    }

    const at = new Date(Date.now() + SUMMON_DELAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const name = cards.length === 1 ? `Summon: ${cards[0].title}` : `Summon: ${cards.length} kanban cards`;
    const args = [
      "mac", "create", at, buildPrompt(cards),
      "--name", name.slice(0, 120),
      "--skill", "mission-control-kanban",
      "--deliver", "telegram",
      "--repeat", "1",
    ];
    if (model) args.push("--model", model, "--provider", "custom:mac");

    const res = await runHelper(args);
    const jobId = /Created job: ([a-zA-Z0-9_-]+)/.exec(res.output || "")?.[1];
    if (!res.ok || !jobId) {
      console.error("Summon: hermes cron create failed", res.error || res.output);
      return NextResponse.json({ error: res.error || "could not create the Hermes job", output: res.output }, { status: 502, headers });
    }

    // Record the summon on each card (assignee + an activity entry) so the
    // board shows who is on it before Bernie claims it.
    const now = new Date().toISOString();
    const note = `Summoned Bernie${model ? ` (${model})` : ""} — Hermes job ${jobId}`;
    const summoned = new Set(cards.map((c) => c.id));
    const fresh = JSON.parse(await fs.readFile(runtimeConfig.tasksFilePath, "utf8")) as { tasks: Task[] };
    fresh.tasks = fresh.tasks.map((t) =>
      summoned.has(t.id)
        ? { ...t, assignee: "bernie", history: [...(t.history || []), { at: now, by: "Kevin", note }] }
        : t
    );
    await fs.writeFile(runtimeConfig.tasksFilePath, JSON.stringify(fresh, null, 2), "utf8");

    return NextResponse.json({ ok: true, jobId, runAt: at, cards: cards.map((c) => c.id), model: model || null }, { headers });
  } catch (error: any) {
    console.error("Summon failed", error);
    return NextResponse.json({ error: error?.message || "summon failed" }, { status: 500, headers });
  }
}
