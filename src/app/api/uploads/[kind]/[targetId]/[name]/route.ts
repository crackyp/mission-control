import { NextResponse } from "next/server";
import { isUploadKind, readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * GET /api/uploads/[kind]/[targetId]/[name] — serve a stored attachment file.
 * kind ∈ tasks | ideas. Inline for images/pdf, attachment disposition otherwise.
 */
export async function GET(
  _request: Request,
  { params }: { params: { kind: string; targetId: string; name: string } }
) {
  const kind = params.kind;
  const targetId = safe(params.targetId);
  if (!isUploadKind(kind) || !targetId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const found = await readUpload(kind, targetId, params.name);
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { buf, att } = found;
  const inline = att.type.startsWith("image/") || att.type === "application/pdf" || att.type.startsWith("text/");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": att.type,
      "Content-Length": String(buf.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${att.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function safe(v: string): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.includes("..") || !/^[A-Za-z0-9._-]+$/.test(t)) return null;
  return t;
}
