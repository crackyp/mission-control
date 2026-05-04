import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

const execFileAsync = promisify(execFile);

const AGENTS: Record<string, string> = {
  shuri: "Product Manager",
  ricky: "Researcher",
  bob: "Builder",
  pixel: "Frontend Engineer",
  duke: "Backend Engineer",
  "inspector-gadget": "Reviewer",
};

const WAKE_SCRIPT = join(runtimeConfig.sharedDir, "scripts", "wake_single_agent.py");

function extractPreflightLines(output: string): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.replace(/\s+$/, ""));
  const start = lines.findIndex((line) => line.includes("🔎 Preflight"));
  if (start < 0) return [];

  const preflight: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > start && /^(✅|❌|⏸️|🧪|📢|📋)/u.test(line.trim())) break;
    if (line.trim() === "" && preflight.length > 0) break;

    preflight.push(line);
    if (preflight.length >= 16) break;
  }

  return preflight;
}

function parseWakeStatus(output: string): "dispatched" | "skipped" | "dry-run" | "completed" {
  if (output.includes("✅ Wake dispatched")) return "dispatched";
  if (output.includes("⏸️")) return "skipped";
  if (output.includes("🧪 DRY RUN")) return "dry-run";
  return "completed";
}

function parseSessionInfo(output: string): { mode: "reused" | "new" | null; id: string | null } {
  const match = output.match(/session:\s*(reused|new)\s+([a-f0-9-]{8,})/i);
  if (!match) return { mode: null, id: null };
  return {
    mode: match[1].toLowerCase() === "reused" ? "reused" : "new",
    id: match[2],
  };
}

function parseProcessPid(output: string): number | null {
  const match = output.match(/process pid:\s*(\d+)/i);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isFinite(pid) ? pid : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agent, message, model } = body ?? {};

    if (!agent || !AGENTS[agent]) {
      return NextResponse.json(
        { error: `Invalid agent. Valid agents: ${Object.keys(AGENTS).join(", ")}` },
        { status: 400 }
      );
    }

    const role = AGENTS[agent];
    const finalMessage = String(message || "Check for tasks");

    let stdout = "";
    let stderr = "";

    try {
      const result = await execFileAsync(
        "python3",
        [WAKE_SCRIPT, agent, finalMessage],
        {
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
        }
      );
      stdout = result.stdout || "";
      stderr = result.stderr || "";
    } catch (error: any) {
      const errorOutput = `${error?.stdout || ""}\n${error?.stderr || ""}`.trim();
      const preflight = extractPreflightLines(errorOutput);

      return NextResponse.json(
        {
          error: error?.message || "Failed to wake agent",
          agent,
          role,
          preflight,
          preflightText: preflight.join("\n"),
          output: errorOutput,
        },
        { status: 500 }
      );
    }

    const output = `${stdout}\n${stderr}`.trim();
    const preflight = extractPreflightLines(output);
    const status = parseWakeStatus(output);
    const session = parseSessionInfo(output);
    const processPid = parseProcessPid(output);

    const warnings: string[] = [];
    if (model) {
      warnings.push(
        "Model override is not currently applied for persistent wake sessions in Mission Control."
      );
    }

    return NextResponse.json({
      success: true,
      agent,
      role,
      status,
      message: finalMessage,
      model: model || null,
      modelApplied: false,
      warnings,
      preflight,
      preflightText: preflight.join("\n"),
      sessionMode: session.mode,
      sessionId: session.id,
      processPid,
      output,
    });
  } catch (error: any) {
    console.error("Failed to wake agent", error);
    return NextResponse.json(
      { error: error?.message || "Failed to wake agent" },
      { status: 500 }
    );
  }
}
