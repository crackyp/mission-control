import { NextResponse } from "next/server";
import { buttondown, noStore } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

type Stats = {
  subscribers: number;
  issues: {
    id: string;
    subject: string;
    publishDate: string;
    url: string;
    recipients: number;
    opens: number;
    clicks: number;
    unsubscriptions: number;
  }[];
  fetchedAt: string;
};

let cache: Stats | null = null;
const TEN_MINUTES = 10 * 60 * 1000;

// Sent issues with Buttondown's analytics, plus the active subscriber count.
// Cached for 10 minutes; ?refresh=1 skips the cache.
export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (cache && !refresh && Date.now() - new Date(cache.fetchedAt).getTime() < TEN_MINUTES) {
    return NextResponse.json(cache, noStore);
  }
  try {
    const [sent, subscribers] = await Promise.all([
      buttondown("GET", "/emails?status=sent&ordering=-publish_date"),
      buttondown("GET", "/subscribers?type=regular"),
    ]);
    cache = {
      subscribers: subscribers.count ?? 0,
      issues: (sent.results ?? []).map((e: any) => ({
        id: e.id,
        subject: e.subject,
        publishDate: e.publish_date,
        url: e.absolute_url,
        recipients: e.analytics?.recipients ?? 0,
        opens: e.analytics?.opens ?? 0,
        clicks: e.analytics?.clicks ?? 0,
        unsubscriptions: e.analytics?.unsubscriptions ?? 0,
      })),
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(cache, noStore);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
