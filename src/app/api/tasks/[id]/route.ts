import { NextResponse } from "next/server";
import {
  actorFrom,
  ApiError,
  mutateTasks,
} from "@/lib/tasks-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

// DELETE /api/tasks/:id — per-task delete, server does the read-modify-write.
// Replaces the UI's "filter the card out and PUT the whole file" dance.
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const actor = actorFrom(request);
  const id = (params?.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await mutateTasks((file) => {
      const idx = file.tasks.findIndex((t) => t.id === id);
      if (idx < 0) throw new ApiError(404, `task not found: ${id}`);
      if (file.tasks[idx].status === "onhold" && actor !== "Kevin") {
        throw new ApiError(
          403,
          "On Hold cards are agent-protected — Kev moves them off hold himself"
        );
      }
      const [removed] = file.tasks.splice(idx, 1);
      return { tasks: file.tasks, result: { removed } };
    });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    }
    console.error("DELETE /api/tasks/:id failed", e);
    return NextResponse.json({ error: "write failed" }, { status: 500, headers: NO_STORE });
  }
}