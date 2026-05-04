import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

const SESSIONS_JSON = join(runtimeConfig.sessionsDir, "sessions.json");

// Keep completed/recent subagents visible long enough to inspect from Mission Control.
const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
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
      // Match subagent sessions: agent:main:subagent:UUID
      if (!key.includes(":subagent:")) continue;

      const updatedAt = value?.updatedAt ?? null;
      const ageMs = updatedAt ? now - updatedAt : Infinity;

      // Only include subagents active within the window.
      // Skip explicitly aborted runs as well.
      if (ageMs > ACTIVE_WINDOW_MS) continue;
      if (value?.abortedLastRun === true) continue;

      // Extract UUID from session key
      const idMatch = key.match(/:subagent:([a-f0-9-]+)$/i);
      const id = idMatch ? idMatch[1] : key;

      let presence: SubagentPresence = "stale";
      if (ageMs < WORKING_WINDOW_MS) {
        presence = "working";
      } else if (ageMs < ACTIVE_WINDOW_MS) {
        presence = "recent";
      }

      // Try to extract task info from label or other fields
      let task: string | undefined;
      if (value?.label) {
        task = value.label;
      }

      subagents.push({
        id,
        sessionKey: key,
        label: value?.label ?? null,
        model: value?.model ?? value?.modelProvider ?? null,
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
