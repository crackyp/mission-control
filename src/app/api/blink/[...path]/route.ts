import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Pass-through to the Blink bridge (blinkclient/bridge.py on the Mac, :8766).
// The Blink cloud client and its clip archive live on the Mac — the Pi can't
// import them — so MC is only the UI and this route is the pipe. Every request
// carries the shared X-Blink-Token (arm/disarm is real camera control).
//
// Bodies are streamed; Range is forwarded so clip videos scrub in the player.
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

async function proxy(req: Request, params: { path: string[] }) {
  const segs = params.path || [];
  if (!segs.length) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const target = `${runtimeConfig.blinkBridgeUrl}/${segs
    .map(encodeURIComponent)
    .join("/")}${fmtQuery(req)}`;

  const headers: Record<string, string> = {};
  if (runtimeConfig.blinkBridgeToken) {
    headers["x-blink-token"] = runtimeConfig.blinkBridgeToken;
  }
  const range = req.headers.get("range");
  if (range) headers["range"] = range;
  const len = req.headers.get("content-length");
  if (len) headers["content-length"] = len;
  const hasBody = req.method === "POST";

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // required by Node's fetch to stream a request body
      ...(hasBody ? { duplex: "half" } : {}),
      cache: "no-store",
      signal: req.signal,
    } as RequestInit);

    const out = new Headers({ "Cache-Control": "no-store, max-age=0" });
    for (const h of FORWARD_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(req.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: out,
    });
  } catch (e: any) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("blink proxy:", target, e);
    return NextResponse.json(
      {
        error: `Blink bridge unreachable at ${runtimeConfig.blinkBridgeUrl} — ${e?.cause?.code || e?.message || e}`,
        hint: "The bridge runs on the Mac as ai.kev.blink-bridge (launchd).",
      },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

function fmtQuery(req: Request): string {
  const qs = new URL(req.url).search;
  return qs || "";
}

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}

export async function HEAD(req: Request, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}

export async function POST(req: Request, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}