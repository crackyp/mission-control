import { NextResponse } from "next/server";
import { safeSegment, saveUpload, type Attachment } from "@/lib/uploads";
import { mutateTasks } from "@/lib/tasks-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/[id]/attachments — multipart/form-data with one or more
 * `file` fields. Saves each file to disk and appends attachment metadata to
 * the task card's `attachments` array via the shared locked store (the old
 * HTTP self-PUT round-trip raced the 2s UI poll and other writers).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const targetId = safeSegment(params.id);
  if (!targetId) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
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

  // Validate the target card against the store before touching disk.
  const store = await import("@/lib/tasks-store");
  const data = await store.readTasksFile();
  if (!data.tasks.some((t) => t?.id === targetId)) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const saved: Attachment[] = [];
  try {
    for (const f of files) {
      saved.push(await saveUpload("tasks", targetId, f));
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save upload" }, { status: 400 });
  }

  try {
    await mutateTasks((file) => {
      const tasks = file.tasks.map((t) =>
        t.id === targetId
          ? { ...t, attachments: [...(Array.isArray(t.attachments) ? t.attachments : []), ...saved] }
          : t
      );
      return { tasks, result: true };
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to persist attachment metadata" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, attachments: saved },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}