import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/runtime-config";
import { HERMES_AGENT_NAMES, isHermesAgent } from "@/lib/hermes-agents";

export const dynamic = "force-dynamic";

// Send a message into a Hermes agent's live chat session (Telegram, Discord, ...)
// through the mc-bridge plugin in that agent's gateway. It is delivered exactly
// like a message typed in that chat: mid-turn it goes through the gateway's
// busy_input_mode (interrupt), and /steer, /queue and /stop work as commands.
//
// POST { agent, sessionId, text } → plugin's { ok, busy, platform } or { error }.

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const MAX_TEXT = 4000;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const agent = typeof body?.agent === "string" ? body.agent : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const url = isHermesAgent(agent) ? runtimeConfig.hermesBridgeUrls[agent] : undefined;
  if (!url) {
    return NextResponse.json({ error: "unknown agent" }, { status: 400, headers: NO_STORE });
  }
  if (!sessionId || !text || text.length > MAX_TEXT) {
    return NextResponse.json({ error: `sessionId and text (max ${MAX_TEXT} chars) required` }, { status: 400, headers: NO_STORE });
  }
  if (!runtimeConfig.hermesBridgeToken) {
    return NextResponse.json({ error: "MC_HERMES_BRIDGE_TOKEN is not set" }, { status: 500, headers: NO_STORE });
  }

  try {
    const res = await fetch(`${url}/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runtimeConfig.hermesBridgeToken}` },
      body: JSON.stringify({ session_id: sessionId, text }),
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
