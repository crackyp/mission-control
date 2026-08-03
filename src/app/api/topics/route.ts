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
