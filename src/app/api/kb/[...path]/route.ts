import { NextResponse } from "next/server";
import http from "http";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

// Pass-through to the Knowledge Base backend (local-kb's FastAPI app on the
// Windows PC, :8765). The wiki, the FAISS index and the models all live
// there, so MC is only the UI. Only /api/* is reachable.
//
// http.request rather than fetch: Node's fetch gives up after 300 s without
// response headers (or between body chunks), and a compile, an ask or a
// health check is one LLM call that routinely runs longer. Bodies are streamed
// both ways — uploads are multipart, and chat/compile/ingest answer as SSE.
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-length"];
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // The raw pathname, not the decoded route params: file paths arrive as one
  // %2F-encoded segment and the backend needs them encoded exactly that way.
  const path = url.pathname.slice("/api/kb".length);
  if (!path.startsWith("/api/")) {
    return Promise.resolve(NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE }));
  }
  const target = `${runtimeConfig.kbUrl}${path}${url.search}`;

  const hasBody = req.method === "POST" || req.method === "PUT";
  const headers: Record<string, string> = {};
  const type = req.headers.get("content-type");
  if (hasBody && type) headers["content-type"] = type;
  const len = req.headers.get("content-length");
  if (hasBody && len) headers["content-length"] = len;

  return new Promise((resolve) => {
    const upstream = http.request(target, { method: req.method, headers }, (res) => {
      const out = new Headers(NO_STORE);
      for (const h of FORWARD_RESPONSE_HEADERS) {
        const v = res.headers[h];
        if (typeof v === "string") out.set(h, v);
      }
      resolve(new Response(Readable.toWeb(res) as unknown as ReadableStream, { status: res.statusCode || 502, headers: out }));
    });
    upstream.on("error", (e: NodeJS.ErrnoException) => {
      if (req.signal.aborted) return resolve(new Response(null, { status: 499 }));
      console.error("kb proxy:", target, e);
      resolve(
        NextResponse.json(
          {
            error: `Knowledge Base backend unreachable at ${runtimeConfig.kbUrl} — ${e.code || e.message}`,
            hint: "It runs on the Windows PC as the scheduled task “kb-server”.",
          },
          { status: 502, headers: NO_STORE }
        )
      );
    });
    // Stop (chat, compile) is the browser aborting its request; dropping the
    // upstream socket is what tells the backend to stop the work.
    req.signal.addEventListener("abort", () => upstream.destroy());
    if (hasBody && req.body) Readable.fromWeb(req.body as unknown as NodeReadableStream).pipe(upstream);
    else upstream.end();
  });
}

export async function GET(req: Request) {
  return proxy(req);
}

export async function POST(req: Request) {
  return proxy(req);
}

export async function PUT(req: Request) {
  return proxy(req);
}

export async function DELETE(req: Request) {
  return proxy(req);
}
