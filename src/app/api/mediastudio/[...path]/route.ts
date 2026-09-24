import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Pass-through to the Media Studio backend (H:\programz\media-studio\server.py
// on the Windows PC, :8190). ComfyUI, the Qwen-Image-2.1 weights and the GPU
// all live there, so MC is only the UI. Only /api/*, /file/* and /ref/* are reachable.
async function proxy(req: Request, params: { path: string[] }) {
  const segs = params.path || [];
  if (segs[0] !== "api" && segs[0] !== "file" && segs[0] !== "ref") {
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
  const target = `${runtimeConfig.mediaStudioUrl}/${segs.map(encodeURIComponent).join("/")}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: req.method === "POST" ? { "content-type": "application/json" } : {},
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: req.signal,
    });
    const out = new Headers({ "Cache-Control": "no-store, max-age=0" });
    for (const h of ["content-type", "content-length"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e: any) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("mediastudio proxy:", target, e);
    return NextResponse.json(
      {
        error: `Media Studio backend unreachable at ${runtimeConfig.mediaStudioUrl} — ${e?.cause?.code || e?.message || e}`,
        hint: "It runs on the Windows PC as the scheduled task “media-studio-server”.",
      },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}

export async function POST(req: Request, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
