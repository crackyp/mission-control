import { NextResponse } from "next/server";
import { isMonday, newId, noStore, readState, updateState } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// Edit requests Kev types on the Newsletter tab. Bernie's newsletter-requests
// cron watches GET ?pending=1 (Hermes --monitor-url: it only wakes when the
// response changes), applies each edit, then PATCHes the request done or failed.
export async function GET(request: Request) {
  const pendingOnly = new URL(request.url).searchParams.get("pending") === "1";
  const { requests } = await readState();
  if (pendingOnly) {
    // Stable output (no timestamps) so the monitor's hash only changes when the queue does.
    const pending = requests
      .filter((r) => r.status === "pending")
      .map(({ id, issueDate, text }) => ({ id, issueDate, text }));
    return NextResponse.json({ pending }, noStore);
  }
  return NextResponse.json({ requests }, noStore);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!isMonday(body?.issueDate)) return NextResponse.json({ error: "issueDate must be a Monday (YYYY-MM-DD)" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const req = {
    id: newId(),
    issueDate: body.issueDate as string,
    text,
    createdAt: new Date().toISOString(),
    status: "pending" as const,
    result: "",
    doneAt: null,
  };
  await updateState((s) => s.requests.unshift(req));
  return NextResponse.json({ ok: true, request: req }, noStore);
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const status = body?.status;
  if (status !== "done" && status !== "failed") {
    return NextResponse.json({ error: "status must be done or failed" }, { status: 400 });
  }
  const result = await updateState((s) => {
    const req = s.requests.find((r) => r.id === body?.id);
    if (!req) return null;
    req.status = status;
    req.result = typeof body.result === "string" ? body.result : "";
    req.doneAt = new Date().toISOString();
    return req;
  });
  if (!result) return NextResponse.json({ error: "request not found" }, { status: 404 });
  return NextResponse.json({ ok: true, request: result }, noStore);
}
