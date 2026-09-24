import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Pass-through to H3 Studio (render-studio/h3-dashboard.py on the Mac, :8189).
// Renders have to start on the Mac — h3.c, ComfyUI and the output files all
// live there — so the Python server stays the backend and MC is only the UI.
// Only its /api/* and /file/* surface is reachable; its own HTML page is not.
//
// Bodies are streamed, not buffered: an upload is a base64 video of up to
// ~256 MB and the Pi should never hold one in memory. Range is forwarded so
// gallery videos can be scrubbed.
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

async function proxy(req: Request, params: { path: string[] }) {
  const segs = params.path || [];
  if (segs[0] !== "api" && segs[0] !== "file") {
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
  const target = `${runtimeConfig.h3StudioUrl}/${segs.map(encodeURIComponent).join("/")}`;

  const headers: Record<string, string> = {};
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
    console.error("h3studio proxy:", target, e);
    return NextResponse.json(
      {
        error: `H3 Studio unreachable at ${runtimeConfig.h3StudioUrl} — ${e?.cause?.code || e?.message || e}`,
        hint: "Start it on the Mac with the Desktop launcher “Start Render Monitor”.",
      },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
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
