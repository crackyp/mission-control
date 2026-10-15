import { NextResponse } from "next/server";
import { buttondown, isMonday, noStore, readState, updateState } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// Hold: turn the Buttondown email back into a draft so it won't send, and flag
// the issue so Bernie's scripts don't reschedule it. Release: schedule it again
// for its Monday 7:00 am ET. Status is always set explicitly — Buttondown's
// default for an email with no status is "send now".
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { issueDate, action } = body ?? {};
  if (!isMonday(issueDate) || (action !== "hold" && action !== "release")) {
    return NextResponse.json({ error: "need issueDate (a Monday) and action hold|release" }, { status: 400 });
  }
  const issue = (await readState()).issues[issueDate];
  if (!issue?.emailId) return NextResponse.json({ error: "Bernie hasn't put this issue in Buttondown yet" }, { status: 409 });
  if (issue.status === "sent") return NextResponse.json({ error: "This issue has already been sent" }, { status: 409 });

  let payload: Record<string, string>;
  if (action === "hold") {
    payload = { status: "draft" };
  } else {
    const sendAt = new Date(issue.sendAt);
    if (!issue.sendAt || Number.isNaN(sendAt.getTime())) {
      return NextResponse.json({ error: "This issue has no send time; ask Bernie to reschedule it" }, { status: 409 });
    }
    if (sendAt.getTime() - Date.now() < 30 * 60 * 1000) {
      return NextResponse.json(
        { error: "Its Monday 7:00 am send time is less than 30 minutes away or past. Send it from Buttondown if you still want it out." },
        { status: 409 }
      );
    }
    payload = { status: "scheduled", publish_date: sendAt.toISOString().replace(/\.\d{3}Z$/, "Z") };
  }

  try {
    const email = await buttondown("PATCH", `/emails/${issue.emailId}`, payload);
    if (email.status !== payload.status) {
      return NextResponse.json(
        { error: `Buttondown reports status "${email.status}", expected "${payload.status}". Check the Buttondown dashboard now.` },
        { status: 502 }
      );
    }
    const updated = await updateState((s) => {
      const i = s.issues[issueDate];
      i.status = email.status;
      i.publishDate = email.publish_date ?? null;
      i.held = action === "hold";
      return i;
    });
    return NextResponse.json({ ok: true, issue: updated }, noStore);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
