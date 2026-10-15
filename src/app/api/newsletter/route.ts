import { NextResponse } from "next/server";
import { buttondown, noStore, readState, updateState } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// Everything the Newsletter tab (and Bernie) needs. Issues that haven't gone out
// yet get their status refreshed from Buttondown, so a send, a hold made in
// Buttondown itself, or a Telegram "newsletter stop" all show up here.
export async function GET() {
  const state = await readState();
  const open = Object.values(state.issues).filter((i) => i.emailId && i.status !== "sent");
  const refreshed: Record<string, { status: string; publishDate: string | null }> = {};
  let buttondownError = "";
  for (const issue of open) {
    try {
      const email = await buttondown("GET", `/emails/${issue.emailId}`);
      refreshed[issue.issueDate] = { status: email.status, publishDate: email.publish_date ?? null };
    } catch (error: any) {
      buttondownError = error.message;
    }
  }
  const changed = Object.entries(refreshed).filter(
    ([date, r]) => state.issues[date].status !== r.status || state.issues[date].publishDate !== r.publishDate
  );
  if (changed.length) {
    await updateState((s) => {
      for (const [date, r] of changed) {
        if (s.issues[date]) Object.assign(s.issues[date], r);
      }
    });
    for (const [date, r] of changed) Object.assign(state.issues[date], r);
  }
  return NextResponse.json({ ...state, buttondownError }, noStore);
}
