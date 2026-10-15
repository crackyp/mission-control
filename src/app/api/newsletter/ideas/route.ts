import { NextResponse } from "next/server";
import { newId, noStore, updateState } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// Kev's "since last issue" ideas: a project, a tool, a trip, a restaurant.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const idea = {
    id: newId(),
    title,
    body: typeof body?.body === "string" ? body.body : "",
    createdAt: new Date().toISOString(),
    usedIn: null,
  };
  await updateState((s) => s.ideas.unshift(idea));
  return NextResponse.json({ ok: true, idea }, noStore);
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await updateState((s) => {
    const idea = s.ideas.find((i) => i.id === body?.id);
    if (!idea) return null;
    if (typeof body.title === "string" && body.title.trim()) idea.title = body.title.trim();
    if (typeof body.body === "string") idea.body = body.body;
    return idea;
  });
  if (!result) return NextResponse.json({ error: "idea not found" }, { status: 404 });
  return NextResponse.json({ ok: true, idea: result }, noStore);
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const found = await updateState((s) => {
    const before = s.ideas.length;
    s.ideas = s.ideas.filter((i) => i.id !== body?.id);
    for (const [date, ideaId] of Object.entries(s.picks)) if (ideaId === body?.id) delete s.picks[date];
    return s.ideas.length !== before;
  });
  if (!found) return NextResponse.json({ error: "idea not found" }, { status: 404 });
  return NextResponse.json({ ok: true }, noStore);
}
