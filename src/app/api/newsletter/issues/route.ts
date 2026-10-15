import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isMonday, noStore, previewPath, updateState, type NewsletterIssue } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

// Bernie pushes an issue here every time he drafts, edits, schedules or cancels
// it (buttondown.py → mc.py push). Marks the idea and topic it used.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const issueDate = body?.issueDate;
  if (!isMonday(issueDate)) return NextResponse.json({ error: "issueDate must be a Monday (YYYY-MM-DD)" }, { status: 400 });

  if (typeof body.previewHtml === "string" && body.previewHtml) {
    const file = previewPath(issueDate);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body.previewHtml, "utf8");
  }

  const issue = await updateState((s) => {
    const previous = s.issues[issueDate];
    const next: NewsletterIssue = {
      issueDate,
      subject: str(body.subject),
      preheader: str(body.preheader),
      skill: str(body.skill),
      idea: str(body.idea),
      topic: str(body.topic),
      emailId: str(body.emailId),
      status: str(body.status),
      held: previous?.held ?? false,
      publishDate: typeof body.publishDate === "string" ? body.publishDate : null,
      sendAt: str(body.sendAt),
      words: Number(body.words) || 0,
      filled: Number(body.filled) || 0,
      headlines: Array.isArray(body.headlines) ? body.headlines.map(String).slice(0, 10) : [],
      url: str(body.url),
      updatedAt: new Date().toISOString(),
    };
    s.issues[issueDate] = next;
    for (const idea of s.ideas) if (idea.id === next.idea) idea.usedIn = issueDate;
    for (const topic of s.topics) if (topic.id === next.topic) topic.usedIn = issueDate;
    return next;
  });
  return NextResponse.json({ ok: true, issue }, noStore);
}
