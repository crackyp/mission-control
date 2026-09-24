import { NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Realtime token-usage snapshot exported by the Hermes host (Mac) every minute
// to shared/bernie/token-usage.json. This route just serves that file with
// staleness metadata so the UI can show "live" vs "stale".
const STALE_AFTER_MS = 5 * 60_000;

function readSnapshot(path: string) {
  const stat = statSync(path);
  const ageMs = Date.now() - stat.mtimeMs;
  return {
    ...JSON.parse(readFileSync(path, "utf8")),
    snapshotAgeMs: ageMs,
    snapshotAgeIso: new Date(stat.mtimeMs).toISOString(),
    stale: ageMs > STALE_AFTER_MS,
    path,
  };
}

// The PC exports its own llama-swap snapshot on the same 1-minute cadence. It is
// a second host, not a second view of the Mac, so a missing or stale PC file
// must not fail the whole response.
function readPcSnapshot() {
  const path = runtimeConfig.tokenUsagePcFile;
  try {
    return readSnapshot(path);
  } catch (e: any) {
    return {
      error: e?.message || String(e),
      stale: true,
      path,
      hint: "Run the llama-swap-token-usage-export scheduled task on the PC.",
    };
  }
}

export async function GET() {
  const path = runtimeConfig.tokenUsageFile;
  try {
    const raw = readSnapshot(path);

    return NextResponse.json(
      {
        ...raw,
        pc: readPcSnapshot(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || String(e),
        stale: true,
        path,
        hint: "Run the token-usage-export cron on the Mac to generate this file.",
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
