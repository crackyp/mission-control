import { NextResponse } from "next/server";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { runtimeConfig } from "@/lib/runtime-config";

const SHARED_DIR = runtimeConfig.sharedDir;
const KEVBOT_DIR = runtimeConfig.clawdDir;
const CRON_JOBS_FILE = runtimeConfig.cronJobsFile;
const AGENT_STATUS_FILE = runtimeConfig.agentStatusFile;
const SESSIONS_DIR = runtimeConfig.sessionsDir;
const SESSIONS_JSON = join(SESSIONS_DIR, "sessions.json");

const AGENTS = [
  { id: "kevbot", name: "KevBot", role: "Main Orchestrator", emoji: "🤖" },
  { id: "bob", name: "Bob", role: "Builder/Developer", emoji: "🔨" },
  { id: "chet", name: "Chet", role: "Creative Agent", emoji: "🎨" },
  { id: "duke", name: "Duke", role: "Backend Engineer", emoji: "⚙️" },
  { id: "inspector-gadget", name: "Inspector Gadget", role: "Reviewer/QA", emoji: "🔍" },
  { id: "pixel", name: "Pixel", role: "Frontend Engineer", emoji: "🖥️" },
  { id: "ricky", name: "Ricky", role: "Researcher", emoji: "📚" },
  { id: "shuri", name: "Shuri", role: "Product Manager", emoji: "📋" },
];

const MEMORY_FILES = ["AGENTS.md", "MEMORY.md", "SOUL.md", "WORKING.md"];

type TokenUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type SessionTokenInfo = {
  sessionId: string;
  label?: string;
  updatedAt?: number;
  usage: TokenUsage;
};

type AgentTokenUsage = {
  current?: SessionTokenInfo;
  recent: SessionTokenInfo[];
  totals: TokenUsage;
  // Approximate live context usage from latest session metadata
  // (inputTokens from latest turn) and model context window max.
  contextCurrentTokens?: number;
  contextMaxTokens?: number;
};

type AgentFile = {
  path: string;
  name: string;
  type: "context" | "daily";
  date?: string;
  text?: string;
  modifiedAt?: number;
};

type AgentPresence = "idle" | "waking" | "working";

type Agent = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  files: AgentFile[];
  lastActive?: number;
  currentWork?: string;
  presence: AgentPresence;
  presenceTask?: string;
  presenceUpdatedAt?: number;
  tokenUsage?: AgentTokenUsage;
};

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function parseSessionTokens(sessionFile: string): Promise<TokenUsage> {
  const usage: TokenUsage = { totalTokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 };

  try {
    const fileStream = createReadStream(sessionFile);
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        if (entry?.message?.usage) {
          const u = entry.message.usage;
          usage.totalTokens += u.totalTokens || 0;
          usage.inputTokens += u.input || 0;
          usage.outputTokens += u.output || 0;
          usage.cost += u.cost?.total || 0;
        }
      } catch {
        // skip invalid lines
      }
    }
  } catch {
    // file doesn't exist or can't be read
  }

  return usage;
}

// Best-effort approximation of OpenClaw's "current context used" value.
// We take the highest prompt/cache token observation from the session log, which
// is typically closer to the /status Context numerator than raw input/output sums.
async function parseSessionContextUsedEstimate(sessionFile: string): Promise<number | undefined> {
  let peak: number | undefined;

  try {
    const fileStream = createReadStream(sessionFile);
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        const u = entry?.message?.usage;
        if (!u) continue;

        const totalTokens = typeof u.totalTokens === "number" ? u.totalTokens : undefined;
        const ioTotal = (typeof u.input === "number" ? u.input : 0) + (typeof u.output === "number" ? u.output : 0);
        const candidate = typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0
          ? totalTokens
          : ioTotal > 0
            ? ioTotal
            : undefined;

        if (typeof candidate === "number" && (!peak || candidate > peak)) {
          peak = candidate;
        }
      } catch {
        // skip invalid lines
      }
    }
  } catch {
    // file doesn't exist or can't be read
  }

  return peak;
}

async function getAgentTokenUsage(agentId: string): Promise<AgentTokenUsage> {
  const result: AgentTokenUsage = {
    recent: [],
    totals: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  };

  try {
    const sessionsRaw = await readFile(SESSIONS_JSON, "utf-8");
    const sessions = JSON.parse(sessionsRaw) as Record<string, any>;

    // Find sessions for this agent.
    // KevBot uses the main Discord session key and does not include "kevbot" in key/label.
    const agentPattern = new RegExp(`${agentId}`, "i");
    const matchingSessions: Array<{
      key: string;
      sessionId: string;
      label?: string;
      updatedAt?: number;
      contextTokens?: number;
      inputTokens?: number;
      totalTokens?: number;
    }> = [];
    const seenSessionIds = new Set<string>();

    for (const [key, value] of Object.entries(sessions)) {
      const label = value?.label || "";
      const sessionId = value?.sessionId;

      const isKevBotMainSession =
        agentId === "kevbot" &&
        typeof key === "string" &&
        key.startsWith("agent:main:discord:");

      const isAgentMatch = agentPattern.test(label) || agentPattern.test(key);

      if ((isKevBotMainSession || isAgentMatch) && sessionId && !seenSessionIds.has(sessionId)) {
        seenSessionIds.add(sessionId);
        matchingSessions.push({
          key,
          sessionId,
          label: value.label,
          updatedAt: value.updatedAt,
          contextTokens: typeof value?.contextTokens === "number" ? value.contextTokens : undefined,
          inputTokens: typeof value?.inputTokens === "number" ? value.inputTokens : undefined,
          totalTokens: typeof value?.totalTokens === "number" ? value.totalTokens : undefined,
        });
      }
    }
    
    // Sort by updatedAt descending
    matchingSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    
    // Get token usage for recent sessions (top 5)
    const recentSessions = matchingSessions.slice(0, 5);
    for (const session of recentSessions) {
      const sessionFile = join(SESSIONS_DIR, `${session.sessionId}.jsonl`);
      const usage = await parseSessionTokens(sessionFile);

      // Fallback when usage lines are unavailable/truncated: use contextTokens from sessions index.
      if (usage.totalTokens === 0 && typeof session.contextTokens === "number" && session.contextTokens > 0) {
        usage.totalTokens = session.contextTokens;
        usage.inputTokens = session.contextTokens;
      }

      result.recent.push({
        sessionId: session.sessionId,
        label: session.label,
        updatedAt: session.updatedAt,
        usage,
      });

      // Add to totals
      result.totals.totalTokens += usage.totalTokens;
      result.totals.inputTokens += usage.inputTokens;
      result.totals.outputTokens += usage.outputTokens;
      result.totals.cost += usage.cost;
    }
    
    // Set current session (most recent)
    if (result.recent.length > 0) {
      result.current = result.recent[0];
    }

    // Context window telemetry aligned to OpenClaw semantics:
    // - max comes from contextTokens on latest metadata
    // - current prefers totalTokens (prompt/cache), falls back to input+output,
    //   and is upgraded from session log peak usage when available.
    if (matchingSessions.length > 0) {
      const latest = matchingSessions[0];

      if (typeof latest.contextTokens === "number" && latest.contextTokens > 0) {
        result.contextMaxTokens = latest.contextTokens;
      }

      let currentEstimate: number | undefined;
      if (typeof latest.totalTokens === "number" && latest.totalTokens > 0) {
        currentEstimate = latest.totalTokens;
      } else if (typeof latest.inputTokens === "number" && latest.inputTokens > 0) {
        currentEstimate = latest.inputTokens;
      }

      const latestSessionFile = join(SESSIONS_DIR, `${latest.sessionId}.jsonl`);
      const logPeak = await parseSessionContextUsedEstimate(latestSessionFile);
      if (typeof logPeak === "number" && logPeak > 0) {
        if (!currentEstimate || logPeak > currentEstimate) {
          currentEstimate = logPeak;
        }
      }

      if (typeof currentEstimate === "number") {
        result.contextCurrentTokens = currentEstimate;
      }
    }
    
    // Get totals from all matching sessions (not just recent 5)
    // For performance, we'll sample from the recent ones for now
    // Could be extended to scan all sessions if needed
    
  } catch (error) {
    console.error(`Failed to get token usage for ${agentId}:`, error);
  }
  
  return result;
}

async function getKevBotFiles(): Promise<AgentFile[]> {
  const files: AgentFile[] = [];
  const baseDir = KEVBOT_DIR;
  const contextFiles = ["SOUL.md", "MEMORY.md", "AGENTS.md", "TOOLS.md", "IDENTITY.md", "USER.md"];

  for (const name of contextFiles) {
    const filePath = join(baseDir, name);
    try {
      const text = await readFileSafe(filePath);
      if (text) {
        const info = await stat(filePath);
        files.push({ path: filePath, name, type: "context", text, modifiedAt: info.mtimeMs });
      }
    } catch {}
  }

  // Daily notes in runtimeConfig.memoryDir
  try {
    const dailyDir = join(baseDir, "memory");
    const entries = await readdir(dailyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      const filePath = join(dailyDir, entry.name);
      const text = await readFileSafe(filePath);
      const info = await stat(filePath);
      files.push({ path: filePath, name: entry.name, type: "daily", date: dateMatch[1], text, modifiedAt: info.mtimeMs });
    }
  } catch {}

  files.sort((a, b) => {
    if (a.type !== b.type) return a.type === "context" ? -1 : 1;
    if (a.type === "daily" && b.type === "daily") return (b.date || "").localeCompare(a.date || "");
    return a.name.localeCompare(b.name);
  });

  return files;
}

async function getAgentFiles(agentId: string): Promise<AgentFile[]> {
  if (agentId === "kevbot") return getKevBotFiles();

  const files: AgentFile[] = [];
  const agentDir = join(SHARED_DIR, agentId);
  const memoryDir = join(agentDir, "memory");

  // Check for HEARTBEAT.md at root level (some agents have it there)
  try {
    const heartbeatPath = join(agentDir, "HEARTBEAT.md");
    const text = await readFileSafe(heartbeatPath);
    if (text) {
      const info = await stat(heartbeatPath);
      files.push({
        path: heartbeatPath,
        name: "HEARTBEAT.md",
        type: "context",
        text,
        modifiedAt: info.mtimeMs,
      });
    }
  } catch {}

  // Check for WORKING.md at root level
  try {
    const workingPath = join(agentDir, "WORKING.md");
    const text = await readFileSafe(workingPath);
    if (text) {
      const info = await stat(workingPath);
      files.push({
        path: workingPath,
        name: "WORKING.md (root)",
        type: "context",
        text,
        modifiedAt: info.mtimeMs,
      });
    }
  } catch {}

  // Load memory context files
  for (const name of MEMORY_FILES) {
    const path = join(memoryDir, name);
    try {
      const text = await readFileSafe(path);
      if (text) {
        const info = await stat(path);
        files.push({
          path,
          name,
          type: "context",
          text,
          modifiedAt: info.mtimeMs,
        });
      }
    } catch {}
  }

  // Load daily notes
  try {
    const dailyNotesDir = join(memoryDir, "dailynotes");
    const entries = await readdir(dailyNotesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;

      const path = join(dailyNotesDir, entry.name);
      const text = await readFileSafe(path);
      const info = await stat(path);

      const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : undefined;

      files.push({
        path,
        name: entry.name,
        type: "daily",
        date,
        text,
        modifiedAt: info.mtimeMs,
      });
    }
  } catch {}

  // Sort: context first, then daily by date descending
  files.sort((a, b) => {
    if (a.type !== b.type) return a.type === "context" ? -1 : 1;
    if (a.type === "daily" && b.type === "daily") {
      return (b.date || "").localeCompare(a.date || "");
    }
    return a.name.localeCompare(b.name);
  });

  return files;
}

async function getAgentPresenceMap(): Promise<Record<string, { presence: AgentPresence; task?: string; updatedAt?: number; explicit?: boolean }>> {
  const map: Record<string, { presence: AgentPresence; task?: string; updatedAt?: number; explicit?: boolean }> = {};
  for (const a of AGENTS) map[a.id] = { presence: "idle", explicit: false };
  // KevBot (main session): default idle, then elevate from live session activity below.
  map["kevbot"] = { presence: "idle", explicit: false };

  const now = Date.now();

  // Primary source: explicit real-time status file written by agents/wake flow.
  try {
    const raw = await readFile(AGENT_STATUS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { agents?: Record<string, { status?: AgentPresence; task?: string; updatedAtMs?: number }> };
    const agents = parsed?.agents || {};
    for (const a of AGENTS) {
      const s = agents[a.id];
      if (!s?.status) continue;
      const updatedAt = s.updatedAtMs;
      const ageMs = typeof updatedAt === "number" ? now - updatedAt : Number.MAX_SAFE_INTEGER;

      // Auto-expire stale statuses so UI doesn't get stuck.
      // working expires after 15m without refresh, waking after 5m.
      let presence: AgentPresence = s.status;
      if (presence === "working" && ageMs > 15 * 60 * 1000) presence = "idle";
      if (presence === "waking" && ageMs > 5 * 60 * 1000) presence = "idle";

      map[a.id] = {
        presence,
        task: presence === "idle" ? undefined : s.task,
        updatedAt,
        explicit: true,
      };
    }
  } catch {
    // no status file yet
  }

  // Fallback/booster: cron wake jobs for very recent transitions.
  try {
    const raw = await readFile(CRON_JOBS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { jobs?: any[] };
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];

    for (const agent of AGENTS) {
      const wakeJobs = jobs
        .filter((j) => typeof j?.name === "string" && j.name === `manual-wake-${agent.id}`)
        .sort((a, b) => (b?.updatedAtMs || b?.createdAtMs || b?.state?.lastRunAtMs || 0) - (a?.updatedAtMs || a?.createdAtMs || a?.state?.lastRunAtMs || 0));

      const latest = wakeJobs[0];
      if (!latest) continue;

      const status = latest?.state?.lastStatus;
      const lastRunAt = latest?.state?.lastRunAtMs;
      const createdAt = latest?.createdAtMs;
      const scheduledAt = latest?.schedule?.atMs;

      if (map[agent.id].explicit) continue;

      if (status === "running") {
        map[agent.id] = { ...map[agent.id], presence: "working" };
      } else if (typeof lastRunAt === "number" && now - lastRunAt < 5 * 60 * 1000) {
        if (map[agent.id].presence === "idle") map[agent.id].presence = "waking";
      } else if (!lastRunAt && typeof scheduledAt === "number" && scheduledAt >= now - 30 * 1000 && scheduledAt <= now + 2 * 60 * 1000) {
        if (map[agent.id].presence === "idle") map[agent.id].presence = "waking";
      } else if (!lastRunAt && typeof createdAt === "number" && now - createdAt < 2 * 60 * 1000) {
        if (map[agent.id].presence === "idle") map[agent.id].presence = "waking";
      }
    }
  } catch {
    // ignore
  }

  // KevBot live activity from main Discord session metadata.
  // If this session updated recently, show working/waking instead of idle.
  try {
    const raw = await readFile(SESSIONS_JSON, "utf-8");
    const sessions = JSON.parse(raw) as Record<string, any>;

    let mainSession: any;
    const configuredKey = (runtimeConfig.mainDiscordSessionKey || "").trim();
    if (configuredKey) {
      mainSession = sessions[configuredKey];
    }

    // Fallback for portable/public setups: choose the most recently updated
    // main Discord channel session if no explicit key is configured.
    if (!mainSession) {
      const discordMainCandidates = Object.entries(sessions)
        .filter(([key]) => key.startsWith("agent:main:discord:channel:"))
        .map(([, value]) => value)
        .filter(Boolean)
        .sort((a: any, b: any) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
      mainSession = discordMainCandidates[0];
    }

    const updatedAt = Number(mainSession?.updatedAt || 0);
    if (updatedAt > 0) {
      const ageMs = now - updatedAt;
      if (ageMs < 2 * 60 * 1000) {
        map["kevbot"] = { presence: "working", task: "Responding in Discord", updatedAt, explicit: true };
      } else if (ageMs < 10 * 60 * 1000) {
        map["kevbot"] = { presence: "waking", task: "Recently active", updatedAt, explicit: true };
      } else {
        map["kevbot"] = { presence: "idle", updatedAt, explicit: true };
      }
    }
  } catch {
    // keep default idle
  }

  return map;
}

export async function GET() {
  try {
    const agents: Agent[] = [];
    const presenceMap = await getAgentPresenceMap();

    for (const agentDef of AGENTS) {
      const files = await getAgentFiles(agentDef.id);
      
      // Find last modified time across all files
      let lastActive: number | undefined;
      for (const file of files) {
        if (file.modifiedAt && (!lastActive || file.modifiedAt > lastActive)) {
          lastActive = file.modifiedAt;
        }
      }

      // Extract current work from WORKING.md
      const workingFile = files.find(f => f.name === "WORKING.md" || f.name === "WORKING.md (root)");
      let currentWork: string | undefined;
      if (workingFile?.text) {
        // Get first non-header line as summary
        const lines = workingFile.text.split("\n").filter(l => l.trim() && !l.startsWith("#"));
        currentWork = lines[0]?.slice(0, 100) || undefined;
      }

      const p = presenceMap[agentDef.id] || { presence: "idle" as AgentPresence };
      const tokenUsage = await getAgentTokenUsage(agentDef.id);
      
      agents.push({
        ...agentDef,
        files,
        lastActive,
        currentWork,
        presence: p.presence,
        presenceTask: p.task,
        presenceUpdatedAt: p.updatedAt,
        tokenUsage,
      });
    }

    // Sort by last active (most recent first)
    agents.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Failed to list agents", error);
    return NextResponse.json({ error: "Failed to list agents" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const filePath = body?.path;
    const text = body?.text;

    if (!filePath) return NextResponse.json({ error: "No file path provided" }, { status: 400 });
    if (text === undefined) return NextResponse.json({ error: "No text provided" }, { status: 400 });

    // Safety: only allow writes in configured shared or clawd directories
    if (!filePath.startsWith(SHARED_DIR + "/") && !filePath.startsWith(KEVBOT_DIR + "/")) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    await writeFile(filePath, text, "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to save agent file", error);
    return NextResponse.json({ error: error?.message || "Failed to save agent file" }, { status: 500 });
  }
}
