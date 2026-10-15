import { promises as fs } from "fs";
import { isMonday, previewPath } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

// The same preview.html Bernie sends to Telegram (subject on top, made-up bits highlighted).
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!isMonday(date)) return new Response("date must be a Monday (YYYY-MM-DD)", { status: 400 });
  try {
    const html = await fs.readFile(previewPath(date), "utf8");
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("No preview for this issue yet.", { status: 404 });
  }
}
