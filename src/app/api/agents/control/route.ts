import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir, unlink, readdir } from "fs/promises";
import { join } from "path";
import { existsSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { runtimeConfig } from "@/lib/runtime-config";

const SHARED_DIR = runtimeConfig.sharedDir;
const AGENT_STATUS_FILE = runtimeConfig.agentStatusFile;
const QUEUE_FILE = runtimeConfig.messagesFile || join(SHARED_DIR, "messages.jsonl");
const CRON_JOBS_FILE = runtimeConfig.cronJobsFile;

const AGENTS = ["shuri", "ricky", "bob", "pixel", "duke", "inspector-gadget"];

function getKillFile(agent: string): string {
  return join(SHARED_DIR, agent, ".no_auto_wake");
}

function getHandoffLogPath(agent: string): string {
  return join(SHARED_DIR, agent, "memory", "HANDOFF_LOG.json");
}

async function readJsonFile(path: string): Promise<any> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, data: any): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * GET /api/agents/control
 * Returns control status for all agents (killed state, handoff counts, etc.)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const agent = url.searchParams.get("agent");
  const hours = parseInt(url.searchParams.get("hours") || "6");

  try {
    if (action === "status" && agent) {
      // Get status for a single agent
      return NextResponse.json(await getAgentControlStatus(agent));
    }

    if (action === "handoff-trace") {
      // Get recent handoff trace for debugging
      return NextResponse.json(await getHandoffTrace(hours));
    }

    // Default: return status for all agents
    const statuses: Record<string, any> = {};
    for (const a of AGENTS) {
      statuses[a] = await getAgentControlStatus(a);
    }
    return NextResponse.json({ agents: statuses });
  } catch (error: any) {
    console.error("Agent control GET error:", error);
    return NextResponse.json({ error: error?.message || "Failed to get agent control status" }, { status: 500 });
  }
}

/**
 * POST /api/agents/control
 * Perform control actions: kill, revive, clear-inbox, clear-cron
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, agent, reason } = body;

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    switch (action) {
      case "kill":
        if (!agent) return NextResponse.json({ error: "Missing agent" }, { status: 400 });
        return NextResponse.json(await killAgent(agent, reason || "Killed from Mission Control"));

      case "revive":
        if (!agent) return NextResponse.json({ error: "Missing agent" }, { status: 400 });
        return NextResponse.json(await reviveAgent(agent));

      case "kill-all":
        return NextResponse.json(await killAllAgents(reason || "Emergency stop from Mission Control"));

      case "revive-all":
        return NextResponse.json(await reviveAllAgents());

      case "clear-inbox":
        if (!agent) return NextResponse.json({ error: "Missing agent" }, { status: 400 });
        return NextResponse.json(await clearInbox(agent));

      case "clear-handoff-log":
        if (!agent) return NextResponse.json({ error: "Missing agent" }, { status: 400 });
        return NextResponse.json(await clearHandoffLog(agent));

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Agent control POST error:", error);
    return NextResponse.json({ error: error?.message || "Failed to perform action" }, { status: 500 });
  }
}

async function getAgentControlStatus(agent: string): Promise<any> {
  const killFile = getKillFile(agent);
  const inboxFile = join(SHARED_DIR, agent, "inbox.json");
  const handoffLogFile = getHandoffLogPath(agent);

  const status: any = {
    agent,
    killed: existsSync(killFile),
    killInfo: null,
    status: "unknown",
    inboxCount: 0,
    recentHandoffs: 0,
    lastUpdate: null,
  };

  // Kill info
  if (status.killed) {
    status.killInfo = await readJsonFile(killFile);
  }

  // Agent status
  const agentStatus = await readJsonFile(AGENT_STATUS_FILE);
  if (agentStatus?.agents?.[agent]) {
    const a = agentStatus.agents[agent];
    status.status = a.status || "unknown";
    status.task = a.task;
    status.lastUpdate = a.updatedAtMs ? new Date(a.updatedAtMs).toISOString() : null;
  }

  // Inbox count
  const inbox = await readJsonFile(inboxFile);
  if (Array.isArray(inbox)) {
    status.inboxCount = inbox.length;
  }

  // Recent handoffs (last 6 hours)
  const handoffLog = await readJsonFile(handoffLogFile);
  if (handoffLog?.handoffs) {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    status.recentHandoffs = Object.values(handoffLog.handoffs).filter(
      (h: any) => new Date(h.timestamp).getTime() > cutoff
    ).length;
  }

  return status;
}

async function getHandoffTrace(hours: number): Promise<any> {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const handoffs: any[] = [];

  if (!existsSync(QUEUE_FILE)) {
    return { handoffs: [], loops: [] };
  }

  try {
    const fileStream = createReadStream(QUEUE_FILE);
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "handoff") {
          const msgTime = new Date(msg.timestamp).getTime();
          if (msgTime > cutoff) {
            handoffs.push({
              time: msg.timestamp,
              from: msg.from,
              to: msg.to,
              message: msg.message?.slice(0, 100) || "",
            });
          }
        }
      } catch {
        // skip invalid lines
      }
    }
  } catch {
    // file doesn't exist or can't be read
  }

  // Detect potential loops (same from→to pair appearing 3+ times)
  const pairs: Record<string, number> = {};
  for (const h of handoffs) {
    const key = `${h.from}→${h.to}`;
    pairs[key] = (pairs[key] || 0) + 1;
  }

  const loops = Object.entries(pairs)
    .filter(([, count]) => count >= 3)
    .map(([pair, count]) => ({ pair, count, warning: count >= 5 }))
    .sort((a, b) => b.count - a.count);

  return {
    handoffs: handoffs.slice(-100), // Last 100
    loops,
    totalHandoffs: handoffs.length,
    timeRangeHours: hours,
  };
}

async function killAgent(agent: string, reason: string): Promise<any> {
  if (!AGENTS.includes(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }

  const killFile = getKillFile(agent);
  const inboxFile = join(SHARED_DIR, agent, "inbox.json");
  const agentDir = join(SHARED_DIR, agent);

  // Ensure directory exists
  await mkdir(agentDir, { recursive: true });

  // 1. Create kill file
  const killData = {
    killed_at: new Date().toISOString(),
    reason,
    killed_by: "Mission Control",
  };
  await writeJsonFile(killFile, killData);

  // 2. Clear inbox
  let inboxCleared = 0;
  try {
    const inbox = await readJsonFile(inboxFile);
    if (Array.isArray(inbox)) {
      inboxCleared = inbox.length;
    }
    await writeFile(inboxFile, "[]", "utf-8");
  } catch {}

  // 3. Update status
  const statusData = await readJsonFile(AGENT_STATUS_FILE) || { agents: {}, updatedAtMs: 0 };
  statusData.agents[agent] = {
    status: "killed",
    updatedAtMs: Date.now(),
    task: `KILLED: ${reason}`,
  };
  statusData.updatedAtMs = Date.now();
  await writeJsonFile(AGENT_STATUS_FILE, statusData);

  // 4. Post to queue
  const queueEntry = {
    id: `kill-${agent}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    from: "system",
    to: "all",
    type: "alert",
    message: `🛑 AGENT KILLED: ${agent} — Reason: ${reason}`,
  };
  await writeFile(QUEUE_FILE, JSON.stringify(queueEntry) + "\n", { flag: "a" });

  return {
    success: true,
    agent,
    action: "killed",
    reason,
    inboxCleared,
  };
}

async function reviveAgent(agent: string): Promise<any> {
  if (!AGENTS.includes(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }

  const killFile = getKillFile(agent);
  let wasKilled = false;

  // 1. Remove kill file
  if (existsSync(killFile)) {
    await unlink(killFile);
    wasKilled = true;
  }

  // 2. Update status
  const statusData = await readJsonFile(AGENT_STATUS_FILE) || { agents: {}, updatedAtMs: 0 };
  statusData.agents[agent] = {
    status: "idle",
    updatedAtMs: Date.now(),
    task: "Revived - awaiting next wake",
  };
  statusData.updatedAtMs = Date.now();
  await writeJsonFile(AGENT_STATUS_FILE, statusData);

  // 3. Post to queue
  const queueEntry = {
    id: `revive-${agent}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    from: "system",
    to: "all",
    type: "info",
    message: `🔄 AGENT REVIVED: ${agent} — Ready to accept work`,
  };
  await writeFile(QUEUE_FILE, JSON.stringify(queueEntry) + "\n", { flag: "a" });

  return {
    success: true,
    agent,
    action: "revived",
    wasKilled,
  };
}

async function killAllAgents(reason: string): Promise<any> {
  const results: any[] = [];
  for (const agent of AGENTS) {
    results.push(await killAgent(agent, reason));
  }
  return { success: true, action: "kill-all", results };
}

async function reviveAllAgents(): Promise<any> {
  const results: any[] = [];
  for (const agent of AGENTS) {
    results.push(await reviveAgent(agent));
  }
  return { success: true, action: "revive-all", results };
}

async function clearInbox(agent: string): Promise<any> {
  if (!AGENTS.includes(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }

  const inboxFile = join(SHARED_DIR, agent, "inbox.json");
  let count = 0;

  try {
    const inbox = await readJsonFile(inboxFile);
    if (Array.isArray(inbox)) {
      count = inbox.length;
    }
    await writeFile(inboxFile, "[]", "utf-8");
  } catch {}

  return { success: true, agent, action: "clear-inbox", messagesCleared: count };
}

async function clearHandoffLog(agent: string): Promise<any> {
  if (!AGENTS.includes(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }

  const handoffLogFile = getHandoffLogPath(agent);

  try {
    await writeJsonFile(handoffLogFile, { handoffs: {}, completions: {} });
  } catch {}

  return { success: true, agent, action: "clear-handoff-log" };
}
