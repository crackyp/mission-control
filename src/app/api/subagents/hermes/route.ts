import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Hermes subagents (delegate_task children) exported from the Mac's state.db to
// shared/bernie/subagents.json every 5s. GET → cards (timelines stripped, only
// the last few events kept); GET ?id=<sessionId> → one child with its full
// exported timeline, for the detail modal; GET ?id=main → Bernie's own session.
const STALE_AFTER_MS = 60_000;
const CARD_EVENTS = 4;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  const path = runtimeConfig.hermesSubagentsFile;
  try {
    const [raw, stat] = await Promise.all([fs.readFile(path, "utf8"), fs.stat(path)]);
    const snapshot = JSON.parse(raw);
    const ageMs = Date.now() - stat.mtimeMs;
    const stale = ageMs > STALE_AFTER_MS;
    const subagents: any[] = Array.isArray(snapshot.subagents) ? snapshot.subagents : [];

    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      // "main" = Bernie's own active (or latest) session, same timeline shape.
      const subagent = id === "main" ? snapshot.main : subagents.find((s) => s.id === id);
      if (!subagent) return NextResponse.json({ error: "Subagent not found", stale }, { status: 404, headers });
      return NextResponse.json({ subagent, stale, snapshotAgeMs: ageMs }, { headers });
    }

    return NextResponse.json(
      {
        stale,
        snapshotAgeMs: ageMs,
        subagents: subagents.map(({ events, ...rest }) => ({
          ...rest,
          recent: Array.isArray(events) ? events.slice(-CARD_EVENTS) : [],
        })),
      },
      { headers }
    );
  } catch (error: any) {
    console.error("Failed to read Hermes subagents snapshot", error?.message || error);
    return NextResponse.json(
      { error: error?.message || String(error), stale: true, subagents: [] },
      { status: 200, headers }
    );
  }
}
