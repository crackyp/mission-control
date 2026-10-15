import { NextResponse } from "next/server";
import { isMonday, noStore, updateState } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// Which idea goes into an issue's "Since last issue". ideaId null clears the pick
// (Bernie then chooses on Sunday).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const issueDate = body?.issueDate;
  const ideaId = body?.ideaId ?? null;
  if (!isMonday(issueDate)) return NextResponse.json({ error: "issueDate must be a Monday (YYYY-MM-DD)" }, { status: 400 });
  const ok = await updateState((s) => {
    if (ideaId === null) {
      delete s.picks[issueDate];
      return true;
    }
    if (!s.ideas.some((i) => i.id === ideaId)) return false;
    s.picks[issueDate] = ideaId;
    return true;
  });
  if (!ok) return NextResponse.json({ error: "idea not found" }, { status: 404 });
  return NextResponse.json({ ok: true }, noStore);
}
