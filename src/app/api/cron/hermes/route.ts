import { NextResponse } from "next/server";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Hermes cron management for Mission Control.
//
// MC runs on the Pi; Hermes instances live on the Mac (local) and the PC
// (reached via a Mac-side helper that hops over the `windows-comfy` ssh
// alias). All operations go through the helper script on the Mac:
//   ssh <target> /Users/kev/.hermes/scripts/mc-cron.sh <mac|pc> <op> [args...]
// Reads return the raw jobs.json; mutations run the `hermes cron` CLI
// (pause/resume/run/remove/create/edit). The Hermes cron ticker re-reads
// jobs.json every tick, so no service restart is needed after mutations.

const SSH_TARGET = process.env.MC_HERMES_SSH_TARGET || "kev@192.168.4.38";
const HELPER = process.env.MC_HERMES_CRON_HELPER || "/Users/kev/.hermes/scripts/mc-cron.sh";

const INSTANCES = [
  { id: "mac", name: "Hermes — Mac" },
  { id: "pc", name: "Hermes — PC" },
];

type HelperResult = { ok: boolean; output: string; error?: string };

function runHelper(args: string[], timeoutMs: number): Promise<HelperResult> {
  // ssh joins its command arguments with spaces and the remote shell re-parses
  // them, so argv arrays do NOT survive the hop — "every 1h" would arrive as
  // two args. Build one remote command string with POSIX single-quoting so
  // every arg arrives intact.
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
      (err, stdout, stderr) => {
        const out = (stdout || "").toString();
        if (err) {
          // Helper failures print {"error": "..."} and exit 1; timeouts and
          // ssh failures may have empty stdout.
          if (out.trim().startsWith("{")) {
            try {
              const parsed = JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "{}");
              if (parsed.error) {
                resolve({ ok: false, output: out, error: String(parsed.error) });
                return;
              }
            } catch {
              // fall through to generic error below
            }
          }
          resolve({ ok: false, output: out, error: err.killed ? "timed out" : (stderr || err.message || "helper failed") });
          return;
        }
        resolve({ ok: true, output: out });
      }
    );
  });
}

function parseJobsJson(raw: string): { jobs: any[] } | null {
  try {
    const data = JSON.parse(raw.trim());
    if (data && Array.isArray(data.jobs)) return { jobs: data.jobs };
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const results = await Promise.all(
    INSTANCES.map(async (inst) => {
      const res = await runHelper([inst.id, "read"], 30000);
      if (!res.ok) {
        return { ...inst, online: false, jobs: [], error: res.error || "unreachable" };
      }
      const parsed = parseJobsJson(res.output);
      if (!parsed) {
        return { ...inst, online: false, jobs: [], error: "invalid jobs.json from helper" };
      }
      return { ...inst, online: true, jobs: parsed.jobs };
    })
  );
  return NextResponse.json({ instances: results }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

const JOB_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
const OPS = new Set(["pause", "resume", "run", "remove", "create", "edit", "history", "set-model"]);
// Delivery targets accepted by `hermes cron create/edit --deliver`.
const DELIVER_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
// Per-job model override (jobs.json "model" / "provider"). The CLI has no
// --model flag; the set-model helper patches jobs.json instead.
const MODEL_RE = /^[a-zA-Z0-9._\/:-]{1,80}$/;
const PROVIDER_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

function clean(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v.slice(0, maxLen);
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const instance = String(body?.instance || "");
  const op = String(body?.op || "");
  if (!INSTANCES.some((i) => i.id === instance)) {
    return NextResponse.json({ error: "unknown instance" }, { status: 400 });
  }
  if (!OPS.has(op)) {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }

  const id = clean(body?.id, 64);
  if ((op === "pause" || op === "resume" || op === "run" || op === "remove" || op === "edit" || op === "history")) {
    if (!id || !JOB_ID_RE.test(id)) {
      return NextResponse.json({ error: "invalid job id" }, { status: 400 });
    }
  }

  const args: string[] = [instance, op];
  const name = clean(body?.name, 200);
  const schedule = clean(body?.schedule, 200);
  const prompt = clean(body?.prompt, 20000);
  const deliver = clean(body?.deliver, 64);
  const repeat = clean(body?.repeat, 16);
  const script = clean(body?.script, 300);
  const noAgent = body?.noAgent === true;
  // Model override: undefined = leave as-is, "" = clear, string = set.
  const model = typeof body?.model === "string" ? clean(body.model, 80) ?? "" : undefined;
  const provider = typeof body?.provider === "string" ? clean(body.provider, 64) ?? "" : undefined;
  if (model && !MODEL_RE.test(model)) {
    return NextResponse.json({ error: "invalid model name" }, { status: 400 });
  }
  if (provider && !PROVIDER_RE.test(provider)) {
    return NextResponse.json({ error: "invalid provider name" }, { status: 400 });
  }

  if (op === "create") {
    if (!schedule) {
      return NextResponse.json({ error: "schedule required" }, { status: 400 });
    }
    args.push(schedule);
    if (prompt) args.push(prompt);
    if (name) args.push("--name", name);
    if (deliver) {
      if (!DELIVER_RE.test(deliver)) {
        return NextResponse.json({ error: "invalid deliver target" }, { status: 400 });
      }
      args.push("--deliver", deliver);
    }
    if (repeat) args.push("--repeat", repeat);
    if (script) args.push("--script", script);
    if (noAgent) args.push("--no-agent");
  } else if (op === "edit") {
    args.push(id!);
    if (name) args.push("--name", name);
    if (schedule) args.push("--schedule", schedule);
    if (typeof body?.prompt === "string" && prompt) args.push("--prompt", prompt);
    if (deliver) {
      if (!DELIVER_RE.test(deliver)) {
        return NextResponse.json({ error: "invalid deliver target" }, { status: 400 });
      }
      args.push("--deliver", deliver);
    }
    if (repeat) args.push("--repeat", repeat);
  } else if (op === "pause" || op === "resume" || op === "run" || op === "remove" || op === "history") {
    args.push(id!);
  }

  const res = await runHelper(args, op === "create" || op === "edit" ? 90000 : 45000);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error || "action failed", output: res.output }, { status: 502 });
  }
  if (op === "history") {
    // helper prints a JSON array of run entries ([] when none)
    let runs: any[] = [];
    try {
      const parsed = JSON.parse(res.output.trim());
      if (Array.isArray(parsed)) runs = parsed;
    } catch {
      // keep runs empty, surface raw output
    }
    return NextResponse.json({ ok: true, runs, output: res.output }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // Per-job model override. Applied AFTER the CLI create/edit because the
  // CLI has no --model flag — set-model patches jobs.json directly and the
  // ticker picks it up on the next tick. undefined = don't touch;
  // "" = clear (use instance default).
  if (op === "create" || op === "edit") {
    if (model !== undefined || provider !== undefined) {
      let targetId = id!;
      if (op === "create") {
        const m = /Created job: ([a-zA-Z0-9_-]+)/.exec(res.output || "");
        if (!m) {
          return NextResponse.json({ ok: true, output: res.output, warning: "job created but model could not be applied (no job id in output)" }, {
            headers: { "Cache-Control": "no-store, max-age=0" },
          });
        }
        targetId = m[1];
      }
      const set = await runHelper(
        [instance, "set-model", targetId, model ? model : "-", provider ? provider : "-"],
        45000
      );
      if (!set.ok) {
        return NextResponse.json({ ok: true, output: res.output, warning: `job saved but model could not be applied: ${set.error || "set-model failed"}` }, {
          headers: { "Cache-Control": "no-store, max-age=0" },
        });
      }
    }
  }
  return NextResponse.json({ ok: true, output: res.output }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}