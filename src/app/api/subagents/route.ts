import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SESSIONS_JSON = join(runtimeConfig.sessionsDir, "sessions.json");

// Keep completed/recent spawned runs visible long enough to inspect from Mission Control.
// Ralph-style loops can finish between refreshes and were disappearing before anyone could see them.
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const WORKING_WINDOW_MS = 90 * 1000; // 90 seconds

type SubagentPresence = "working" | "recent" | "stale";

type Subagent = {
  id: string;
  sessionKey: string;
  label: string | null;
  model: string | null;
  updatedAt: number | null;
  presence: SubagentPresence;
  task?: string;
};

export async function GET() {
  try {
    const sessionsRaw = await readFile(SESSIONS_JSON, "utf-8");
    const sessions = JSON.parse(sessionsRaw) as Record<string, any>;
    const now = Date.now();

    const subagents: Subagent[] = [];

    for (const [key, value] of Object.entries(sessions)) {
      // Match spawned child sessions. Native subagents use :subagent:, while
      // Ralph/e2e loop workers are created as explicit isolated sessions.
      const isNativeSubagent = key.includes(":subagent:");
      const isExplicitSpawnedRun = key.includes(":explicit:");
      if (!isNativeSubagent && !isExplicitSpawnedRun) continue;

      const updatedAt = value?.updatedAt ?? null;
      const ageMs = updatedAt ? now - updatedAt : Infinity;

      // Only include spawned runs active within the window. Keep timed-out/aborted
      // runs visible too; otherwise quick test/failure runs never get a tile.
      if (ageMs > ACTIVE_WINDOW_MS) continue;

      // Extract a readable id from the session key.
      const idMatch = key.match(/:(?:subagent|explicit):(.+)$/i);
      const id = idMatch ? idMatch[1] : key;

      let presence: SubagentPresence = "stale";
      if (ageMs < WORKING_WINDOW_MS) {
        presence = "working";
      } else if (ageMs < ACTIVE_WINDOW_MS) {
        presence = "recent";
      }

      // Try to extract task info from label/session id/key.
      const sessionId = typeof value?.sessionId === "string" ? value.sessionId : undefined;
      const readableId = decodeURIComponent(id).replace(/^ralph-/i, "Ralph ");
      const task = value?.label || sessionId || readableId;

      subagents.push({
        id,
        sessionKey: key,
        label: value?.label ?? sessionId ?? readableId,
        model: value?.model ?? value?.modelOverride ?? value?.modelProvider ?? null,
        updatedAt,
        presence,
        task,
      });
    }

    // Sort by updatedAt descending (most recent first)
    subagents.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return NextResponse.json({ subagents });
  } catch (error) {
    console.error("Failed to list subagents", error);
    return NextResponse.json({ error: "Failed to list subagents" }, { status: 500 });
  }
}
