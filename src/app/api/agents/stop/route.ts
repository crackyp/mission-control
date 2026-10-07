import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/runtime-config";
import { HERMES_AGENT_NAMES, isHermesAgent } from "@/lib/hermes-agents";

export const dynamic = "force-dynamic";

// Stop a live Hermes run through the mc-bridge plugin in that agent's gateway.
// A chat session (Telegram, Discord, ...) gets the gateway's own /stop, which also
// cancels its background subagents; a subagent or kanban (cron) run is
// hard-interrupted inside the gateway process.
//
// POST { agent, sessionId } → plugin's { ok, ... } or { error }.

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const agent = typeof body?.agent === "string" ? body.agent : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const url = isHermesAgent(agent) ? runtimeConfig.hermesBridgeUrls[agent] : undefined;
  if (!url) {
    return NextResponse.json({ error: "unknown agent" }, { status: 400, headers: NO_STORE });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400, headers: NO_STORE });
  }
  if (!runtimeConfig.hermesBridgeToken) {
    return NextResponse.json({ error: "MC_HERMES_BRIDGE_TOKEN is not set" }, { status: 500, headers: NO_STORE });
  }

  try {
    const res = await fetch(`${url}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runtimeConfig.hermesBridgeToken}` },
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ error: `bridge answered HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch (e: any) {
    return NextResponse.json(
      { error: `${HERMES_AGENT_NAMES[agent]}'s gateway bridge is unreachable at ${url} — ${e?.cause?.code || e?.message}` },
      { status: 502, headers: NO_STORE }
    );
  }
}
