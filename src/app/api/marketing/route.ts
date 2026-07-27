import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runtimeConfig } from "@/lib/runtime-config";

const execFileAsync = promisify(execFile);

// node:sqlite is available in Node 22+ at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = runtimeConfig.marketingDbPath;

function openDb() {
  if (!existsSync(DB_PATH)) return null;
  return new DatabaseSync(DB_PATH);
}

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function rowToArtifact(row: any) {
  return {
    ...row,
    brief: parseJson(row.brief),
    compliance: parseJson(row.compliance),
    meta: parseJson(row.meta),
  };
}

// The X character budgets, straight from the engine's brand.json, so the editor
// can count against the same numbers the gate enforces instead of hardcoding a
// second copy that drifts. Advisory only — compliance.check() still decides.
function readXBudget() {
  try {
    const brandPath = join(runtimeConfig.marketingEngineDir, "brand.json");
    if (!existsSync(brandPath)) return null;
    const social = JSON.parse(readFileSync(brandPath, "utf-8")).social || {};
    const body = Number(social.x_char_limit) || 280;
    const hook = Number(social.x_hook_limit) || Math.min(280, body);
    const pair = Array.isArray(social.x_target_chars) ? social.x_target_chars : [];
    const target =
      pair.length === 2
        ? [Math.min(Number(pair[0]), body), Math.min(Number(pair[1]), body)]
        : null;
    return { hook, body, target };
  } catch (error) {
    console.error("Failed to read X budgets from brand.json", error);
    return null;
  }
}

export async function GET() {
  let db: any = null;
  try {
    db = openDb();
    if (!db) {
      return NextResponse.json(
        { error: `Marketing DB not found at ${DB_PATH}` },
        { status: 503 }
      );
    }
    const rows = db.prepare("SELECT * FROM artifacts ORDER BY id DESC").all();
    return NextResponse.json({ artifacts: rows.map(rowToArtifact), xBudget: readXBudget() });
  } catch (error: any) {
    console.error("Failed to list marketing artifacts", error);
    return NextResponse.json(
      { error: error?.message || "Failed to list marketing artifacts" },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}

// Statuses whose body an operator is still allowed to rewrite. Once something
// is approved or published, editing it here would slip past the review it
// already passed — unapprove it first.
const EDITABLE_STATUSES = ["pending_review", "draft", "blocked"];

// Re-run the engine's compliance gate over an edited body. Shelling out keeps
// one implementation of the rules; reimplementing them here would let the two
// drift and eventually disagree about what is publishable.
async function runComplianceGate(artifact: any, body: string) {
  const payload = JSON.stringify({
    channel: artifact.channel,
    kind: artifact.kind,
    title: artifact.title,
    body,
  });
  const child = execFileAsync(
    runtimeConfig.pythonBin,
    ["-m", "engine.compliance"],
    { cwd: runtimeConfig.marketingEngineDir, timeout: 20000 }
  );
  child.child.stdin?.end(payload);
  const { stdout } = await child;
  return JSON.parse(stdout);
}

// Edit a draft's body in place. The compliance verdict stored on the row
// describes the old text, so it is recomputed here and the status follows it:
// a fix unblocks the draft, and a newly-introduced violation re-blocks it.
export async function PATCH(req: Request) {
  let db: any = null;
  try {
    const payload = await req.json();
    const slug = payload.slug;
    const body = typeof payload.body === "string" ? payload.body : null;
    if (!slug || body === null) {
      return NextResponse.json({ error: "Need slug and body" }, { status: 400 });
    }
    if (!body.trim()) {
      return NextResponse.json({ error: "Body cannot be empty" }, { status: 400 });
    }

    db = openDb();
    if (!db) {
      return NextResponse.json(
        { error: `Marketing DB not found at ${DB_PATH}` },
        { status: 503 }
      );
    }
    const row = db.prepare("SELECT * FROM artifacts WHERE slug=?").get(slug);
    if (!row) {
      return NextResponse.json({ error: "No such artifact" }, { status: 404 });
    }
    const artifact = rowToArtifact(row);
    if (!EDITABLE_STATUSES.includes(artifact.status)) {
      return NextResponse.json(
        { error: `Only unapproved drafts can be edited (status: ${artifact.status})` },
        { status: 409 }
      );
    }

    let compliance: any;
    try {
      compliance = await runComplianceGate(artifact, body);
    } catch (error: any) {
      // Never save an edit we could not gate — a body with no matching verdict
      // is exactly the stale state this endpoint exists to prevent.
      console.error("Compliance gate failed to run", error);
      return NextResponse.json(
        { error: `Could not run the compliance gate, edit not saved: ${error?.message || error}` },
        { status: 500 }
      );
    }

    const status = compliance.ok ? "pending_review" : "blocked";
    db.prepare(
      "UPDATE artifacts SET body=?, compliance=?, status=?, updated_at=? WHERE slug=?"
    ).run(body, JSON.stringify(compliance), status, Date.now() / 1000, slug);

    return NextResponse.json({ success: true, compliance, status });
  } catch (error: any) {
    console.error("Failed to save artifact edit", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save artifact edit" },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}

// Mirrors the marketing engine's console POST /review: approval refuses
// anything the compliance gate blocked; rejections always land and are
// appended to the feedback table so re-drafting learns from the reason.
export async function POST(req: Request) {
  let db: any = null;
  try {
    const body = await req.json();
    const slug = body.slug;
    const decision = body.decision;
    const notes = (body.notes || "").trim();
    if (!slug || !["approved", "rejected", "unapproved", "deleted"].includes(decision)) {
      return NextResponse.json(
        { error: "Need slug and decision (approved|rejected|unapproved|deleted)" },
        { status: 400 }
      );
    }

    db = openDb();
    if (!db) {
      return NextResponse.json(
        { error: `Marketing DB not found at ${DB_PATH}` },
        { status: 503 }
      );
    }
    const row = db.prepare("SELECT * FROM artifacts WHERE slug=?").get(slug);
    if (!row) {
      return NextResponse.json({ error: "No such artifact" }, { status: 404 });
    }
    const artifact = rowToArtifact(row);
    const now = Date.now() / 1000;

    if (decision === "approved") {
      if (artifact.status === "blocked" || artifact.compliance.ok === false) {
        return NextResponse.json(
          { error: "Blocked by the compliance gate; fix the draft and re-run before approving" },
          { status: 409 }
        );
      }
      db.prepare("UPDATE artifacts SET status='approved', notes=?, updated_at=? WHERE slug=?")
        .run("Approved by operator.", now, slug);
    } else if (decision === "unapproved") {
      // Conditional update so we can never pull back something the autopilot
      // already published between our read and this write.
      const result = db
        .prepare("UPDATE artifacts SET status='pending_review', notes=?, updated_at=? WHERE slug=? AND status='approved'")
        .run("Approval withdrawn by operator.", now, slug);
      if (result.changes === 0) {
        return NextResponse.json(
          { error: `Only approved artifacts can be unapproved (status: ${artifact.status})` },
          { status: 409 }
        );
      }
    } else if (decision === "deleted") {
      db.prepare("DELETE FROM feedback WHERE artifact_slug=?").run(slug);
      db.prepare("DELETE FROM artifacts WHERE slug=?").run(slug);
    } else {
      const reason = notes || "Rejected (no note).";
      db.prepare("UPDATE artifacts SET status='rejected', notes=?, updated_at=? WHERE slug=?")
        .run(reason, now, slug);
      db.prepare(
        "INSERT INTO feedback(artifact_slug,channel,kind,decision,reason,created_at) VALUES(?,?,?,?,?,?)"
      ).run(slug, artifact.channel, artifact.kind, "rejected", reason, now);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to apply review decision", error);
    return NextResponse.json(
      { error: error?.message || "Failed to apply review decision" },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}
