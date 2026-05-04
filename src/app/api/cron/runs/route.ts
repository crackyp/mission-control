import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

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

    const runsPath = join(runtimeConfig.openclawDir, "cron", "runs", `${jobId}.jsonl`);

    let raw = "";
    try {
      raw = await readFile(runsPath, "utf-8");
    } catch {
      return NextResponse.json({ runs: [] });
    }

    const runs = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-limit)
      .reverse();

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("Failed to load cron runs", error);
    return NextResponse.json({ error: "Failed to load cron runs" }, { status: 500 });
  }
}
