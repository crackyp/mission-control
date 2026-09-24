import { NextResponse } from "next/server";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fire an OpenClaw cron job immediately via the gateway `cron.run` RPC.
// The MC process runs on the Pi, same host as the openclaw gateway.
const OPENCLAW_BIN = process.env.MC_OPENCLAW_BIN || "/home/crackypp/.local/bin/openclaw";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Job id required" }, { status: 400 });
    }

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        OPENCLAW_BIN,
        ["cron", "run", id, "--timeout", "45000"],
        { timeout: 60000 },
        (error, stdout, stderr) => {
          resolve({
            code: error ? (typeof (error as any).code === "number" ? (error as any).code : 1) : 0,
            stdout: stdout || "",
            stderr: stderr || "",
          });
        }
      );
    });

    let parsed: any = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // non-JSON output; surface raw
    }

    if (result.code !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed?.error ||
            parsed?.reason ||
            result.stderr.trim().slice(0, 400) ||
            "Failed to trigger job",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      enqueued: parsed?.enqueued ?? true,
      runId: parsed?.runId || null,
      reason: parsed?.reason || null,
    });
  } catch (error) {
    console.error("Failed to run cron job", error);
    return NextResponse.json({ error: "Failed to run cron job" }, { status: 500 });
  }
}
