import { NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Realtime llama-swap runtime snapshot exported by the Hermes host (Mac) every
// minute to shared/bernie/llamaswap-status.json (same exporter pattern as
// token-usage.json). Serves the file plus staleness metadata so the UI can
// distinguish "live" from "stale" — a stale snapshot with `state: busy` must
// not read as "generating right now".
const STALE_AFTER_MS = 60_000;

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

export async function GET() {
  const path = runtimeConfig.llamaswapStatusFile;
  try {
    const raw = readSnapshot(path);
    return NextResponse.json(raw, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || String(e),
        stale: true,
        path,
        state: "unreachable",
        hint: "Run the llamaswap-status-export cron on the Mac to generate this file.",
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}