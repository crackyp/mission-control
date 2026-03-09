import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { runtimeConfig } from "@/lib/runtime-config";

const execAsync = promisify(exec);

const AGENTS: Record<string, string> = {
  shuri: "Product Manager",
  chet: "Creative Agent",
  ricky: "Researcher",
  bob: "Builder",
  pixel: "Frontend Engineer",
  duke: "Backend Engineer",
  "inspector-gadget": "Reviewer",
};

const JOBS_FILE = runtimeConfig.cronJobsFile;
const STATUS_FILE = runtimeConfig.agentStatusFile;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agent, message, model } = body;

    if (!agent || !AGENTS[agent]) {
      return NextResponse.json(
        { error: `Invalid agent. Valid agents: ${Object.keys(AGENTS).join(", ")}` },
        { status: 400 }
      );
    }

    const role = AGENTS[agent];
    const nowMs = Date.now();
    const jobId = crypto.randomUUID();

    const task = `You are ${agent}, the ${role}. Manual wake: ${message || "Check for tasks"}.

CRITICAL: Use these EXACT file paths (do not guess):
- HEARTBEAT.md: ${runtimeConfig.sharedDir}/${agent}/HEARTBEAT.md
- WORKING.md: ${runtimeConfig.sharedDir}/${agent}/memory/WORKING.md
- MEMORY.md: ${runtimeConfig.sharedDir}/${agent}/memory/MEMORY.md
- AGENTS.md: ${runtimeConfig.sharedDir}/${agent}/memory/AGENTS.md
- Daily notes: ${runtimeConfig.sharedDir}/${agent}/memory/dailynotes/YYYY-MM-DD.md

Follow HEARTBEAT.md, check tasks.json for your assignments, take action, and report status to Discord.`;

    const newJob = {
      id: jobId,
      agentId: "main",
      name: `manual-wake-${agent}`,
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: {
        kind: "at",
        atMs: nowMs + 2000,
      },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: task,
        timeoutSeconds: 300,
        ...(model ? { model } : {}),
      },
      delivery: {
        mode: "announce",
        channel: "discord",
        to: runtimeConfig.defaultDiscordChannelTo,
      },
    };

    // Read existing jobs
    let jobsData: { jobs: any[] } = { jobs: [] };
    try {
      const content = await readFile(JOBS_FILE, "utf-8");
      jobsData = JSON.parse(content);
    } catch {
      // File doesn't exist, start fresh
    }

    // Add the new job
    jobsData.jobs.push(newJob);

    // Write back
    await writeFile(JOBS_FILE, JSON.stringify(jobsData, null, 2));

    // Update real-time presence file immediately.
    try {
      let statusData: any = { updatedAtMs: nowMs, agents: {} };
      try {
        statusData = JSON.parse(await readFile(STATUS_FILE, "utf-8"));
      } catch {}
      if (!statusData.agents || typeof statusData.agents !== "object") statusData.agents = {};
      statusData.agents[agent] = {
        status: "waking",
        task: (message || "Check for tasks").slice(0, 240),
        updatedAtMs: nowMs,
      };
      statusData.updatedAtMs = nowMs;
      await writeFile(STATUS_FILE, JSON.stringify(statusData, null, 2));
    } catch {
      // non-fatal
    }

    // Signal gateway to reload (SIGUSR1)
    try {
      const { stdout } = await execAsync("pgrep -f openclaw-gateway");
      const pid = stdout.trim().split("\n")[0];
      if (pid) {
        await execAsync(`kill -USR1 ${pid}`);
      }
    } catch {
      // Gateway not running or signal failed
    }

    return NextResponse.json({
      success: true,
      agent,
      role,
      jobId: jobId.slice(0, 8),
      message: message || "Check for tasks",
      model: model || null,
    });
  } catch (error: any) {
    console.error("Failed to wake agent", error);
    return NextResponse.json(
      { error: error?.message || "Failed to wake agent" },
      { status: 500 }
    );
  }
}
