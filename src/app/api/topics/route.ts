import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// node:sqlite is available in Node 22+ at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = runtimeConfig.marketingDbPath;

// The engine's topic statuses — the self-replenishing content calendar.
// `planned` is the active queue the engine drafts from next.
const STATUS_ORDER: Record<string, number> = {
  planned: 0,
  drafted: 1,
  published: 2,
  skipped: 3,
};

const VALID_STATUSES = Object.keys(STATUS_ORDER);

// Human-submitted ideas carry this marker in notes; next_planned_topic()
// in the engine prioritizes them. Edits must not silently strip it.
const USER_IDEA_MARKER = "source: user idea";

export async function GET() {
  let db: any = null;
  try {
    if (!existsSync(DB_PATH)) {
      return NextResponse.json(
        { error: `Marketing DB not found at ${DB_PATH}` },
        { status: 503 }
      );
    }
    db = new DatabaseSync(DB_PATH);
    const rows = db
      .prepare("SELECT id, slug, title, keyword, intent, audience, status, notes, created_at FROM topics")
      .all()
      .sort(
        (a: any, b: any) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          a.id - b.id
      );
    return NextResponse.json(
      { topics: rows },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    console.error("Failed to list marketing topics", error);
    return NextResponse.json(
      { error: error?.message || "Failed to list marketing topics" },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}

// PATCH — edit a topic's title/keyword/status/notes.
// Body: { id: number, title?: string, keyword?: string, status?: string, notes?: string }
// The slug is immutable — it's referenced by artifacts and the draft queue.
export async function PATCH(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "A valid topic id is required" }, { status: 400 });
  }

  if (body?.slug !== undefined && body.slug !== null) {
    return NextResponse.json(
      { error: "slug is immutable (referenced by drafts and artifacts)" },
      { status: 400 }
    );
  }

  let db: any = null;
  try {
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA busy_timeout = 5000");

    const existing = db
      .prepare("SELECT id, notes FROM topics WHERE id = ?")
      .get(id);
    if (!existing) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const sets: string[] = [];
    const values: any[] = [];

    if (typeof body.title === "string" && body.title.trim()) {
      sets.push("title = ?");
      values.push(body.title.trim());
    }
    if (typeof body.keyword === "string") {
      sets.push("keyword = ?");
      values.push(body.keyword.trim());
    }
    if (typeof body.notes === "string") {
      let notes = body.notes.trim();
      // Preserve the human-idea priority marker if it was there before.
      if (
        typeof existing.notes === "string" &&
        existing.notes.includes(USER_IDEA_MARKER) &&
        !notes.includes(USER_IDEA_MARKER)
      ) {
        notes = notes ? `${notes} | ${USER_IDEA_MARKER} via Mission Control` : `${USER_IDEA_MARKER} via Mission Control`;
      }
      sets.push("notes = ?");
      values.push(notes);
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !VALID_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      sets.push("status = ?");
      values.push(body.status);
    }

    if (!sets.length) {
      return NextResponse.json(
        { error: "Nothing to update — provide title, keyword, status, and/or notes" },
        { status: 400 }
      );
    }

    db.prepare(`UPDATE topics SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);

    const updated = db
      .prepare("SELECT id, slug, title, keyword, intent, audience, status, notes, created_at FROM topics WHERE id = ?")
      .get(id);
    return NextResponse.json({ topic: updated });
  } catch (error: any) {
    console.error("Failed to update marketing topic", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update marketing topic" },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}

// DELETE — remove a topic from the calendar. ?id=<topic id>
// Note: deleting a drafted/published topic does NOT delete its artifacts;
// the article itself is untouched. Planned/skipped topics are safe to purge.
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: "A valid ?id= topic id is required" },
      { status: 400 }
    );
  }

  let db: any = null;
  try {
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA busy_timeout = 5000");
    const result = db.prepare("DELETE FROM topics WHERE id = ?").run(id);
    if (!result.changes) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: id });
  } catch (error: any) {
    console.error("Failed to delete marketing topic", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete marketing topic" },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}