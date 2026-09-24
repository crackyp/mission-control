import { NextResponse } from "next/server";
import { safeSegment, saveUpload, type Attachment } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/ideas/[id]/attachments — multipart/form-data with one or more
 * `file` fields. Saves each file to disk and appends attachment metadata to
 * the idea via PATCH /api/ideas.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const targetId = safeSegment(params.id);
  if (!targetId) {
    return NextResponse.json({ error: "Invalid idea id" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with 'file' field(s)" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => typeof (f as File)?.arrayBuffer === "function");
  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided (field name must be 'file')" }, { status: 400 });
  }

  const base = `http://127.0.0.1:${process.env.PORT || 3000}/api/ideas`;
  let ideas: any[];
  try {
    const res = await fetch(base, { cache: "no-store" });
    ideas = (await res.json()).ideas;
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read ideas: ${e?.message || e}` }, { status: 500 });
  }
  const idea = ideas.find((i) => i?.id === targetId);
  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  const saved: Attachment[] = [];
  try {
    for (const f of files) {
      saved.push(await saveUpload("ideas", targetId, f));
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save upload" }, { status: 400 });
  }

  const patchRes = await fetch(base, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: targetId,
      attachments: [...(Array.isArray(idea.attachments) ? idea.attachments : []), ...saved],
    }),
  });
  if (!patchRes.ok) {
    return NextResponse.json({ error: "Failed to persist attachment metadata" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, attachments: saved },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
