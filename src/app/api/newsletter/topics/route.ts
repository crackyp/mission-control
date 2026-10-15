import { NextResponse } from "next/server";
import { isMonday, newId, noStore, updateState } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// Skill topics. A topic with an issueDate is what that Monday teaches; one
// without is in the pool Bernie may pick from when a week has nothing planned.
function parseDate(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value === "string" && isMonday(value)) return value;
  return undefined; // invalid
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const issueDate = parseDate(body?.issueDate ?? null);
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (issueDate === undefined) return NextResponse.json({ error: "issueDate must be a Monday (YYYY-MM-DD) or empty" }, { status: 400 });
  const topic = {
    id: newId(),
    title,
    notes: typeof body?.notes === "string" ? body.notes : "",
    issueDate,
    createdAt: new Date().toISOString(),
    usedIn: null,
  };
  await updateState((s) => {
    if (issueDate) for (const t of s.topics) if (t.issueDate === issueDate && !t.usedIn) t.issueDate = null;
    s.topics.push(topic);
  });
  return NextResponse.json({ ok: true, topic }, noStore);
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const issueDate = body?.issueDate === undefined ? undefined : parseDate(body.issueDate);
  if (body?.issueDate !== undefined && issueDate === undefined) {
    return NextResponse.json({ error: "issueDate must be a Monday (YYYY-MM-DD) or empty" }, { status: 400 });
  }
  const result = await updateState((s) => {
    const topic = s.topics.find((t) => t.id === body?.id);
    if (!topic) return null;
    if (typeof body.title === "string" && body.title.trim()) topic.title = body.title.trim();
    if (typeof body.notes === "string") topic.notes = body.notes;
    if (issueDate !== undefined) {
      // One planned topic per Monday: the one being moved in bumps the old one back to the pool.
      if (issueDate) for (const t of s.topics) if (t !== topic && t.issueDate === issueDate && !t.usedIn) t.issueDate = null;
      topic.issueDate = issueDate;
    }
    return topic;
  });
  if (!result) return NextResponse.json({ error: "topic not found" }, { status: 404 });
  return NextResponse.json({ ok: true, topic: result }, noStore);
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const found = await updateState((s) => {
    const before = s.topics.length;
    s.topics = s.topics.filter((t) => t.id !== body?.id);
    return s.topics.length !== before;
  });
  if (!found) return NextResponse.json({ error: "topic not found" }, { status: 404 });
  return NextResponse.json({ ok: true }, noStore);
}
