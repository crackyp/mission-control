import { NextRequest, NextResponse } from "next/server";
import { readCronRuns } from "@/lib/openclaw-cron";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId") || req.nextUrl.searchParams.get("id");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 30);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 30;

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const runs = readCronRuns(jobId, limit);

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("Failed to load cron runs", error);
    return NextResponse.json({ error: "Failed to load cron runs" }, { status: 500 });
  }
}
