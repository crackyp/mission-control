import { NextResponse } from "next/server";
import { open, readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { exec } from "child_process";
import { promisify } from "util";
import { hermesSubagentsFileFor, runtimeConfig } from "@/lib/runtime-config";
import { isHermesAgent } from "@/lib/hermes-agents";
import { readCronJobs } from "@/lib/openclaw-cron";

const SHARED_DIR = runtimeConfig.sharedDir;
const BERNIE_DIR = join(SHARED_DIR, "bernie");
const KEVBOT_DIR = runtimeConfig.clawdDir;
const AGENT_STATUS_FILE = runtimeConfig.agentStatusFile;
const SESSIONS_DIR = runtimeConfig.sessionsDir;
const SESSIONS_JSON = join(SESSIONS_DIR, "sessions.json");
const AGENTS_ROOT_DIR = join(SESSIONS_DIR, "..", "..");
const OPENCLAW_BIN = runtimeConfig.openclawBin;
const execAsync = promisify(exec);
const USAGE_REFRESH_MIN_INTERVAL_MS = 5 * 60_000;
const USAGE_FAILURE_BACKOFF_MAX_MS = 30 * 60_000;
const USAGE_STALE_AFTER_MS = 15 * 60_000;
const USAGE_CMD_TIMEOUT_MS = 6_000;

const AGENTS = [
  { id: "kevbot", name: "KevBot", role: "Main Orchestrator", emoji: "🤖" },
  { id: "bernie", name: "Bernie Mac", role: "Hermes Orchestrator", emoji: "🎙️" },
  { id: "edward", name: "Edward", role: "Hermes Researcher", emoji: "🔎" },
  { id: "lucy", name: "Lucy", role: "Hermes Uncensored", emoji: "🌙" },
];

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

type LiveActivityStep = {
  label: string;
  at?: number;
  tool?: string;
};

type AgentLiveActivity = {
  now: string;
  detail?: string;
  command?: string;
  tool?: string;
  at?: number;
  elapsedMs?: number;
  history: LiveActivityStep[];
};

type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

type ProviderUsageEntry = {
  provider: string;
  displayName: string;
  plan?: string;
  error?: string;
  windows: UsageWindow[];
};

type UsageSnapshot = {
  updatedAt: number;
  providers: ProviderUsageEntry[];
  stale?: boolean;
};

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
  liveActivity?: AgentLiveActivity;
  model?: string;
};

type SessionIndexEntry = {
  key: string;
  sessionId: string;
  updatedAt?: number;
  label?: string;
  sessionFile?: string;
  contextTokens?: number;
  inputTokens?: number;
  totalTokens?: number;
};

let usageSnapshotCache:
  | {
      fetchedAt: number;
      snapshot: UsageSnapshot;
    }
  | undefined;
let usageSnapshotInflight: Promise<void> | undefined;
let usageSnapshotNextAttemptAt = 0;
let usageSnapshotFailures = 0;

function parseUsageProviders(raw: unknown): ProviderUsageEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const rec = entry as Record<string, any>;
      const windows = Array.isArray(rec.windows)
        ? rec.windows
            .map((window: any) => {
              if (!window || typeof window !== "object") return null;
              const usedPercent = Number(window.usedPercent);
              if (!Number.isFinite(usedPercent)) return null;
              const resetAt = Number(window.resetAt);
              return {
                label: typeof window.label === "string" && window.label.trim() ? window.label : "Window",
                usedPercent: Math.max(0, Math.min(100, usedPercent)),
                ...(Number.isFinite(resetAt) ? { resetAt } : {}),
              };
            })
            .filter(Boolean) as UsageWindow[]
        : [];

      return {
        provider: typeof rec.provider === "string" ? rec.provider : "unknown",
        displayName:
          typeof rec.displayName === "string" && rec.displayName.trim()
            ? rec.displayName
            : typeof rec.provider === "string"
              ? rec.provider
              : "Unknown",
        ...(typeof rec.plan === "string" && rec.plan.trim() ? { plan: rec.plan.trim() } : {}),
        ...(typeof rec.error === "string" && rec.error.trim() ? { error: rec.error.trim() } : {}),
        windows,
      };
    })
    .filter((entry): entry is ProviderUsageEntry => !!entry)
    .filter((entry) => !entry.provider.toLowerCase().includes("anthropic") && !entry.displayName.toLowerCase().includes("claude"));
}

function computeUsageRetryDelayMs(failures: number): number {
  const factor = 2 ** Math.min(3, Math.max(0, failures - 1));
  return Math.min(USAGE_FAILURE_BACKOFF_MAX_MS, USAGE_REFRESH_MIN_INTERVAL_MS * factor);
}

function getUsageSnapshotForResponse(): UsageSnapshot | undefined {
  if (!usageSnapshotCache) return undefined;
  const ageMs = Date.now() - usageSnapshotCache.fetchedAt;
  if (ageMs > USAGE_STALE_AFTER_MS) {
    return {
      ...usageSnapshotCache.snapshot,
      stale: true,
    };
  }
  return usageSnapshotCache.snapshot;
}

function triggerUsageSnapshotRefresh(): void {
  const now = Date.now();
  if (usageSnapshotInflight) return;
  if (now < usageSnapshotNextAttemptAt) return;

  // Reserve the next window immediately so concurrent requests don't stampede.
  usageSnapshotNextAttemptAt = now + USAGE_REFRESH_MIN_INTERVAL_MS;

  usageSnapshotInflight = (async () => {
    try {
      const { stdout } = await execAsync(`${OPENCLAW_BIN} status --json --usage`, {
        timeout: USAGE_CMD_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        cwd: runtimeConfig.clawdDir,
        env: {
          ...process.env,
          HOME: runtimeConfig.homeDir,
          PATH: `${process.env.PATH || ""}:${runtimeConfig.homeDir}/.npm-global/bin`,
        },
      });

      const parsed = JSON.parse(stdout) as { usage?: { updatedAt?: number; providers?: unknown[] } };
      const providers = parseUsageProviders(parsed?.usage?.providers);

      usageSnapshotCache = {
        fetchedAt: Date.now(),
        snapshot: {
          updatedAt:
            typeof parsed?.usage?.updatedAt === "number" && Number.isFinite(parsed.usage.updatedAt)
              ? parsed.usage.updatedAt
              : Date.now(),
          providers,
        },
      };

      usageSnapshotFailures = 0;
      usageSnapshotNextAttemptAt = Date.now() + USAGE_REFRESH_MIN_INTERVAL_MS;
    } catch {
      usageSnapshotFailures += 1;
      usageSnapshotNextAttemptAt = Date.now() + computeUsageRetryDelayMs(usageSnapshotFailures);
    } finally {
      usageSnapshotInflight = undefined;
    }
  })();
}

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

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function trimOneLine(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function normalizeToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}

function getPathLikeArg(args: Record<string, unknown>): string | undefined {
  const candidates = [
    args.path,
    args.file,
    args.filePath,
    args.file_path,
    args.targetUrl,
    args.url,
    args.pdf,
    args.image,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

function describeExecCommand(command: string): { label: string; command?: string } {
  const normalized = trimOneLine(command, 160);
  const lower = normalized.toLowerCase();

  if (lower.includes("python") || lower.includes("pip ") || lower.includes("pip3 ")) {
    return { label: "Running Python…", command: normalized };
  }
  if (lower.includes("npm") || lower.includes("pnpm") || lower.includes("yarn") || lower.includes("node ")) {
    return { label: "Running JS command…", command: normalized };
  }
  if (lower.includes("git ")) {
    return { label: "Running Git command…", command: normalized };
  }
  if (lower.includes("curl ") || lower.includes("wget ")) {
    return { label: "Fetching via terminal…", command: normalized };
  }

  return { label: "Running terminal command…", command: normalized };
}

function describeToolCall(toolName: string, argsRaw: unknown): {
  label: string;
  detail?: string;
  command?: string;
} {
  const args = normalizeToolArgs(argsRaw);

  if (toolName === "exec") {
    const command = typeof args.command === "string" ? args.command : "";
    return describeExecCommand(command);
  }

  if (toolName === "web_search" || toolName === "web_fetch") {
    const q = typeof args.query === "string" ? args.query : typeof args.url === "string" ? args.url : "";
    return {
      label: "Searching online…",
      ...(q ? { detail: trimOneLine(q, 110) } : {}),
    };
  }

  if (toolName === "browser") {
    const action = typeof args.action === "string" ? args.action : "browsing";
    return {
      label: "Browsing web UI…",
      detail: trimOneLine(action, 80),
    };
  }

  if (toolName === "read" || toolName === "memory_get" || toolName === "pdf" || toolName === "image") {
    const pathLike = getPathLikeArg(args);
    return {
      label: "Reading files…",
      ...(pathLike ? { detail: trimOneLine(basename(pathLike), 80) } : {}),
    };
  }

  if (toolName === "write" || toolName === "edit" || toolName === "apply_patch") {
    const pathLike = getPathLikeArg(args);
    return {
      label: "Editing files…",
      ...(pathLike ? { detail: trimOneLine(basename(pathLike), 80) } : {}),
    };
  }

  if (toolName === "process") {
    const action = typeof args.action === "string" ? args.action : "poll";
    return {
      label: "Monitoring process…",
      detail: trimOneLine(action, 80),
    };
  }

  if (
    toolName === "sessions_spawn" ||
    toolName === "sessions_send" ||
    toolName === "sessions_list" ||
    toolName === "sessions_history" ||
    toolName === "subagents"
  ) {
    return { label: "Coordinating agents…" };
  }

  if (toolName === "message") {
    return { label: "Sending message…" };
  }

  if (toolName === "cron") {
    return { label: "Managing schedules…" };
  }

  if (toolName === "gateway") {
    return { label: "Updating system settings…" };
  }

  if (toolName === "memory_search") {
    return { label: "Searching memory…" };
  }

  return { label: `Using ${toolName}…` };
}

async function readSessionIndex(path: string): Promise<Record<string, any> | undefined> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as Record<string, any>;
  } catch {
    return undefined;
  }
}

function isAgentSessionMatch(agentId: string, key: string, value: any): boolean {
  if (agentId === "kevbot") {
    // Discord used to be KevBot's only live surface, and MC_MAIN_DISCORD_SESSION_KEY
    // used to pin presence to it. Since the GPT models were dropped from OpenClaw
    // the Discord sessions went quiet while real activity lands in the main
    // agent's other sessions (agent:main:main, agent:main:cron:*). KevBot IS the
    // OpenClaw "main" agent, so match all of its sessions.
    return key.startsWith("agent:main:");
  }

  const label = String(value?.label || "").toLowerCase();
  return key.startsWith(`agent:${agentId}:`) || label.includes(agentId.toLowerCase());
}

// Label KevBot's presence task by the session its latest activity came from,
// now that activity may come from cron or the main session instead of Discord.
function kevbotActivityLabel(sessionKey?: string): string {
  const key = sessionKey || "";
  if (key.startsWith("agent:main:cron:")) return "Running scheduled job";
  if (key === "agent:main:main") return "Active in main session";
  if (key.startsWith("agent:main:discord:")) return "Responding in Discord";
  if (key.startsWith("agent:main:telegram:")) return "Responding in Telegram";
  return "Active in session";
}

async function getLatestSessionEntry(agentId: string): Promise<SessionIndexEntry | undefined> {
  const candidates = [
    join(AGENTS_ROOT_DIR, agentId, "sessions", "sessions.json"),
    SESSIONS_JSON,
  ];

  let best: SessionIndexEntry | undefined;
  let bestPriority = -1;

  for (const indexPath of candidates) {
    const sessions = await readSessionIndex(indexPath);
    if (!sessions) continue;

    for (const [key, value] of Object.entries(sessions)) {
      const sessionId = typeof value?.sessionId === "string" ? value.sessionId : undefined;
      if (!sessionId) continue;
      if (!isAgentSessionMatch(agentId, key, value)) continue;

      const updatedAt = toTimestamp(value?.updatedAt) || 0;
      // The configured main-Discord-session key used to get priority 2 here so
      // KevBot's presence pinned to his Discord session. Since the GPT models
      // were dropped from OpenClaw those Discord sessions went quiet, and the
      // pin froze KevBot's status at the last Discord message even though
      // cron/main sessions kept updating. All agent:main:* sessions now
      // compete purely on recency.
      const priority = 1;

      if (
        !best ||
        priority > bestPriority ||
        (priority === bestPriority && updatedAt > (best.updatedAt || 0))
      ) {
        const sessionFile = typeof value?.sessionFile === "string" && value.sessionFile.trim()
          ? value.sessionFile
          : join(dirname(indexPath), `${sessionId}.jsonl`);

        best = {
          key,
          sessionId,
          label: typeof value?.label === "string" ? value.label : undefined,
          updatedAt,
          sessionFile,
          contextTokens: typeof value?.contextTokens === "number" ? value.contextTokens : undefined,
          inputTokens: typeof value?.inputTokens === "number" ? value.inputTokens : undefined,
          totalTokens: typeof value?.totalTokens === "number" ? value.totalTokens : undefined,
        };
        bestPriority = priority;
      }
    }
  }

  return best;
}

async function readTail(filePath: string, maxBytes = 160 * 1024): Promise<string> {
  try {
    const handle = await open(filePath, "r");
    try {
      const info = await handle.stat();
      const size = info.size;
      if (!size) return "";
      const start = Math.max(0, size - maxBytes);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

async function getAgentLiveActivity(agentId: string): Promise<AgentLiveActivity | undefined> {
  const latest = await getLatestSessionEntry(agentId);
  if (!latest?.sessionFile) return undefined;

  const tail = await readTail(latest.sessionFile, 160 * 1024);
  if (!tail) return undefined;

  type ToolCallState = {
    id: string;
    tool: string;
    label: string;
    detail?: string;
    command?: string;
    at?: number;
    completedAt?: number;
  };

  const callsById = new Map<string, ToolCallState>();
  const orderedCalls: ToolCallState[] = [];
  let sawAssistantWithoutToolCall = false;
  let lastAssistantTimestamp: number | undefined;

  const lines = tail.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry?.type !== "message" || !entry?.message || typeof entry.message !== "object") {
      continue;
    }

    const message = entry.message as any;
    const ts = toTimestamp(message.timestamp) || toTimestamp(entry.timestamp) || latest.updatedAt;

    if (message.role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      const toolCalls = content.filter((part: any) => part && typeof part === "object" && part.type === "toolCall");
      if (toolCalls.length === 0) {
        sawAssistantWithoutToolCall = true;
        if (ts) lastAssistantTimestamp = ts;
      }

      for (let i = 0; i < toolCalls.length; i += 1) {
        const part = toolCalls[i] as any;
        const toolName = typeof part?.name === "string" ? part.name : "tool";
        const args = part?.arguments;
        const id = typeof part?.id === "string" && part.id
          ? part.id
          : `${toolName}:${ts || Date.now()}:${i}`;
        const described = describeToolCall(toolName, args);
        const call: ToolCallState = {
          id,
          tool: toolName,
          label: described.label,
          ...(described.detail ? { detail: described.detail } : {}),
          ...(described.command ? { command: described.command } : {}),
          ...(ts ? { at: ts } : {}),
        };
        callsById.set(id, call);
        orderedCalls.push(call);
      }
    }

    if (message.role === "toolResult") {
      const callId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
      const resultTs = ts;

      if (callId && callsById.has(callId)) {
        const existing = callsById.get(callId)!;
        existing.completedAt = resultTs;
      } else {
        const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
        const described = describeToolCall(toolName, {});
        const synthetic: ToolCallState = {
          id: callId || `${toolName}:result:${resultTs || Date.now()}`,
          tool: toolName,
          label: described.label,
          ...(resultTs ? { at: resultTs, completedAt: resultTs } : {}),
        };
        orderedCalls.push(synthetic);
      }
    }
  }

  const nowMs = Date.now();
  const unresolved = [...orderedCalls].reverse().find((c) => !c.completedAt && c.at && nowMs - c.at < 20 * 60 * 1000);
  const latestCall = orderedCalls.length > 0 ? orderedCalls[orderedCalls.length - 1] : undefined;

  const history: LiveActivityStep[] = [];
  const seenLabels = new Set<string>();
  for (let i = orderedCalls.length - 1; i >= 0 && history.length < 3; i -= 1) {
    const c = orderedCalls[i];
    if (!c.label || seenLabels.has(c.label)) continue;
    seenLabels.add(c.label);
    history.unshift({ label: c.label, at: c.completedAt || c.at, tool: c.tool });
  }

  if (unresolved) {
    const at = unresolved.at;
    return {
      now: unresolved.label,
      ...(unresolved.detail ? { detail: unresolved.detail } : {}),
      ...(unresolved.command ? { command: unresolved.command } : {}),
      tool: unresolved.tool,
      ...(at ? { at, elapsedMs: Math.max(0, nowMs - at) } : {}),
      history,
    };
  }

  const sessionUpdatedAt = latest.updatedAt;
  if (sawAssistantWithoutToolCall && lastAssistantTimestamp && nowMs - lastAssistantTimestamp < 2 * 60 * 1000) {
    return {
      now: "Thinking / planning…",
      at: lastAssistantTimestamp,
      elapsedMs: Math.max(0, nowMs - lastAssistantTimestamp),
      ...(latestCall?.label ? { detail: `Last action: ${latestCall.label}` } : {}),
      ...(latestCall?.command ? { command: latestCall.command } : {}),
      ...(latestCall?.tool ? { tool: latestCall.tool } : {}),
      history,
    };
  }

  if (sessionUpdatedAt && nowMs - sessionUpdatedAt < 10 * 60 * 1000) {
    return {
      now: "Waiting for next step…",
      ...(latestCall?.label ? { detail: `Last action: ${latestCall.label}` } : {}),
      ...(latestCall?.command ? { command: latestCall.command } : {}),
      ...(latestCall?.tool ? { tool: latestCall.tool } : {}),
      at: sessionUpdatedAt,
      elapsedMs: Math.max(0, nowMs - sessionUpdatedAt),
      history,
    };
  }

  if (history.length > 0) {
    return {
      now: "Idle",
      ...(latestCall?.label ? { detail: `Last action: ${latestCall.label}` } : {}),
      ...(latestCall?.command ? { command: latestCall.command } : {}),
      ...(latestCall?.tool ? { tool: latestCall.tool } : {}),
      history,
    };
  }

  return undefined;
}

async function getSessionModelForAgent(agentId: string): Promise<string | undefined> {
  try {
    const latest = await getLatestSessionEntry(agentId);
    if (!latest) return undefined;

    const sessions = await readSessionIndex(
      latest.sessionFile ? join(dirname(latest.sessionFile), "sessions.json") : SESSIONS_JSON,
    );
    const session = sessions?.[latest.key];
    const model = session?.model || session?.modelId || session?.systemPromptReport?.model;
    return typeof model === "string" && model.trim() ? model : undefined;
  } catch {
    return undefined;
  }
}

async function getAgentTokenUsage(agentId: string): Promise<AgentTokenUsage> {
  const result: AgentTokenUsage = {
    recent: [],
    totals: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  };

  try {
    const sessionIndexes = [
      join(AGENTS_ROOT_DIR, agentId === "kevbot" ? "main" : agentId, "sessions", "sessions.json"),
      SESSIONS_JSON,
    ];

    // Find sessions for this agent.
    // KevBot uses the main Discord session key and does not include "kevbot" in key/label.
    const agentPattern = new RegExp(`${agentId}`, "i");
    const matchingSessions: Array<{
      key: string;
      sessionId: string;
      sessionFile: string;
      label?: string;
      updatedAt?: number;
      contextTokens?: number;
      inputTokens?: number;
      totalTokens?: number;
    }> = [];
    const seenSessionIds = new Set<string>();

    for (const indexPath of sessionIndexes) {
      const sessions = await readSessionIndex(indexPath);
      if (!sessions) continue;

      for (const [key, value] of Object.entries(sessions)) {
        const label = value?.label || "";
        const sessionId = value?.sessionId;

        const isKevBotMainSession =
          agentId === "kevbot" &&
          typeof key === "string" &&
          key.startsWith("agent:main:discord:");

        const isAgentMatch = isAgentSessionMatch(agentId, key, value) || agentPattern.test(label) || agentPattern.test(key);

        if ((isKevBotMainSession || isAgentMatch) && sessionId && !seenSessionIds.has(sessionId)) {
          seenSessionIds.add(sessionId);
          matchingSessions.push({
            key,
            sessionId,
            sessionFile:
              typeof value?.sessionFile === "string" && value.sessionFile.trim()
                ? value.sessionFile
                : join(dirname(indexPath), `${sessionId}.jsonl`),
            label: value.label,
            updatedAt: value.updatedAt,
            contextTokens: typeof value?.contextTokens === "number" ? value.contextTokens : undefined,
            inputTokens: typeof value?.inputTokens === "number" ? value.inputTokens : undefined,
            totalTokens: typeof value?.totalTokens === "number" ? value.totalTokens : undefined,
          });
        }
      }
    }
    
    // Sort by updatedAt descending
    matchingSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    
    // Get token usage for recent sessions (top 5)
    const recentSessions = matchingSessions.slice(0, 5);
    for (const session of recentSessions) {
      const usage = await parseSessionTokens(session.sessionFile);

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

      const logPeak = await parseSessionContextUsedEstimate(latest.sessionFile);
      // Important: keep live context values from sessions.json when available.
      // Using log peaks can show stale pre-compact highs after /compact.
      if (typeof logPeak === "number" && logPeak > 0 && !currentEstimate) {
        currentEstimate = logPeak;
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
  // Kevbot and Ricky are both OpenClaw agents whose runtime workspace is
  // ~/clawd on the Pi (openclaw.json agents.defaults.workspace — no
  // per-agent override). Read their REAL injected files from there instead
  // of the unused legacy copies on the share. Bernie (Hermes, Mac-local
  // ~/.hermes) is handled by the share path below — the exporter mirrors
  // his live SOUL/MEMORY/USER there.
  if (agentId === "kevbot" || agentId === "ricky") return getKevBotFiles();

  const files: AgentFile[] = [];
  const seenPaths = new Set<string>();
  const agentDir = join(SHARED_DIR, agentId);
  const memoryDir = join(agentDir, "memory");

  const pushFile = async (filePath: string, name: string, type: "context" | "daily", date?: string) => {
    if (seenPaths.has(filePath)) return;
    const text = await readFileSafe(filePath);
    if (!text) return;
    const info = await stat(filePath);
    files.push({ path: filePath, name, type, date, text, modifiedAt: info.mtimeMs });
    seenPaths.add(filePath);
  };

  // Root-level context files. NOTE: these are only shown if they exist in
  // shared/<agentId>/. For bernie they are LIVE copies mirrored from the Mac
  // by token-usage-export.py (~/.hermes/SOUL.md, memories/MEMORY.md,
  // memories/USER.md) — Hermes never reads the share copies of AGENTS/TOOLS/
  // IDENTITY/HEARTBEAT/WORKING (verified Sep 2026: Hermes core only injects
  // AGENTS.md, SOUL.md and the memory stores), so those dead entries were
  // removed from this list. Ricky reads his real OpenClaw workspace via
  // getKevBotFiles() below, so these share paths simply won't exist.
  const ROOT_CONTEXT_FILES = ["SOUL.md", "MEMORY.md", "USER.md"];
  for (const name of ROOT_CONTEXT_FILES) {
    const path = join(agentDir, name);
    try {
      await pushFile(path, name, "context");
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

// When was this agent genuinely last active?
//
// Not sessions.json's updatedAt: that is index bookkeeping, and a gateway
// restart rewrites it for sessions that have been dead for months (Ricky's
// index reads "today" against a session log last written in April). The only
// trustworthy signal is a real message in the session log.
async function getLatestSessionMessageTs(agentId: string): Promise<number | undefined> {
  const latest = await getLatestSessionEntry(agentId);
  if (!latest?.sessionFile) return undefined;

  const tail = await readTail(latest.sessionFile, 160 * 1024);
  if (!tail) return undefined;

  let newest: number | undefined;
  for (const line of tail.split("\n")) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      // readTail can slice the first line mid-JSON; skipping it is fine.
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry?.type !== "message" || !entry?.message) continue;
    const ts = toTimestamp(entry.message.timestamp) || toTimestamp(entry.timestamp);
    if (ts && (!newest || ts > newest)) newest = ts;
  }

  return newest;
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
    const jobs = readCronJobs();

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

  // Live session activity overlay (agent runtimes + fallback indexes).
  // This keeps presence accurate even if agent-status.json is stale.
  //
  // Keyed off real message timestamps, not sessions.json's updatedAt: a
  // gateway restart bulk-rewrites that field, which would show every agent
  // with a registered session as "working" immediately after any restart.
  const sessionActivity: Record<string, number | undefined> = {};
  for (const agent of AGENTS) {
    const updatedAt = await getLatestSessionMessageTs(agent.id);
    sessionActivity[agent.id] = updatedAt;
    if (!updatedAt) continue;

    const ageMs = now - updatedAt;
    const livePresence: AgentPresence = ageMs < 5 * 60 * 1000 ? "working" : ageMs < 30 * 60 * 1000 ? "waking" : "idle";

    // Promote stale/non-working states when live data is fresher.
    if (livePresence === "working") {
      map[agent.id] = { ...map[agent.id], presence: "working", updatedAt };
      if (!map[agent.id].task) map[agent.id].task = "Active in session";
    } else if (livePresence === "waking" && map[agent.id].presence === "idle") {
      map[agent.id] = { ...map[agent.id], presence: "waking", updatedAt };
      if (!map[agent.id].task) map[agent.id].task = "Recently active";
    }
  }

  // KevBot live activity from its main agent sessions (Discord, main, cron).
  //
  // This used to read updatedAt straight out of sessions.json, which pinned
  // KevBot to "Responding in Discord" after every gateway restart. Reuse the
  // message timestamp resolved above, which already prefers the configured
  // main Discord session key, and label the task by which session the latest
  // activity actually came from.
  const kevbotActivity = sessionActivity["kevbot"];
  if (kevbotActivity) {
    let kevbotSessionKey: string | undefined;
    try {
      kevbotSessionKey = (await getLatestSessionEntry("kevbot"))?.key;
    } catch {
      // ignore — fall back to the generic label
    }
    const ageMs = now - kevbotActivity;
    if (ageMs < 2 * 60 * 1000) {
      map["kevbot"] = { presence: "working", task: kevbotActivityLabel(kevbotSessionKey), updatedAt: kevbotActivity, explicit: true };
    } else if (ageMs < 10 * 60 * 1000) {
      map["kevbot"] = { presence: "waking", task: "Recently active", updatedAt: kevbotActivity, explicit: true };
    } else {
      map["kevbot"] = { presence: "idle", updatedAt: kevbotActivity, explicit: true };
    }
  }

  return map;
}

// Hermes runs on separate hosts, so their state.db files are not readable from
// here. Scheduled exporters on those hosts write JSON snapshots to the share;
// the helpers below read them.

// An open (ended_at IS NULL) session still counts as "working" only while
// messages are actually flowing; past this window the session is open but the
// agent is idle.
const HERMES_ACTIVE_WINDOW_MS = 10 * 60 * 1000;

type HermesSessionInfo = {
  presence: AgentPresence;
  task?: string;
  model?: string;
  lastActive?: number;
  tokenUsage?: AgentTokenUsage;
};

async function getHermesSessionInfo(): Promise<HermesSessionInfo | undefined> {
  // ---- Primary source: token-usage.json (Hermes cron exporter) -----------
  // Written every minute by token-usage-export.py on the Mac. Its
  // data.activeSessions rows are computed LIVE from state.db with a
  // per-message lastMessageAt timestamp. Prefer it; fall back to the
  // subagents.json `main` block when there is no open session.
  let live: any;
  try {
    live = JSON.parse(await readFile(runtimeConfig.tokenUsageFile, "utf-8"));
  } catch {
    live = undefined;
  }
  const active = live?.data?.activeSessions?.[0];
  if (active && typeof active.lastMessageAtMs === "number" && active.lastMessageAtMs > 0) {
    const lastActive = active.lastMessageAtMs;
    const presence: AgentPresence =
      Date.now() - lastActive <= HERMES_ACTIVE_WINDOW_MS ? "working" : "idle";
    const task =
      typeof active.title === "string" && active.title.trim()
        ? active.title.trim().slice(0, 200)
        : undefined;
    const model =
      typeof active.model === "string" && active.model.trim() ? active.model : undefined;
    const input = typeof active.inputTokens === "number" ? active.inputTokens : 0;
    const output = typeof active.outputTokens === "number" ? active.outputTokens : 0;
    const totals: TokenUsage = {
      totalTokens: input + output,
      inputTokens: input,
      outputTokens: output,
      cost: 0,
    };
    const tokenUsage: AgentTokenUsage = {
      recent: [
        {
          sessionId: typeof active.id === "string" ? active.id : "unknown",
          updatedAt: lastActive,
          usage: totals,
        },
      ],
      totals,
    };
    return {
      presence,
      ...(task ? { task } : {}),
      ...(model ? { model } : {}),
      ...(lastActive ? { lastActive } : {}),
      tokenUsage,
    };
  }

  // ---- Fallback: the `main` block of Bernie's subagents.json -------------
  // Used when Bernie has no open session in token-usage.json. (This used to
  // read bernie/status.json, but that file's writer was a PC task exporting
  // the PC's own Hermes, not Bernie, so the card showed the wrong agent.)
  return getHermesMainInfo(runtimeConfig.hermesSubagentsFile);
}

// Edward and Lucy (Hermes profiles on the PC) have no token-usage.json. Their
// exporter's `main` block -- the active (or latest) session, with its last
// message time and end time -- carries the same presence signals.
async function getHermesMainInfo(path: string): Promise<HermesSessionInfo | undefined> {
  let main: any;
  try {
    main = JSON.parse(await readFile(path, "utf-8"))?.main;
  } catch {
    return undefined;
  }
  if (!main) return undefined;
  const lastActive =
    typeof main.lastActivityAt === "number" && main.lastActivityAt > 0 ? main.lastActivityAt : undefined;
  const presence: AgentPresence =
    !main.endedAt && lastActive && Date.now() - lastActive <= HERMES_ACTIVE_WINDOW_MS ? "working" : "idle";
  const task =
    typeof main.title === "string" && main.title.trim() ? main.title.trim().slice(0, 200) : undefined;
  const model = typeof main.model === "string" && main.model.trim() ? main.model : undefined;
  return {
    presence,
    ...(task ? { task } : {}),
    ...(model ? { model } : {}),
    ...(lastActive ? { lastActive } : {}),
  };
}

// A Hermes agent's in-flight turn, from its subagents.json snapshot (`main`).
// The exporter marks it running only while Hermes holds a turn lease, so a
// stale snapshot is dropped rather than shown as live work.
async function getHermesLiveActivity(path: string): Promise<AgentLiveActivity | null> {
  try {
    const [raw, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
    if (Date.now() - info.mtimeMs > 60_000) return null;
    const main = JSON.parse(raw)?.main;
    if (!main || main.status !== "running") return null;
    const events: any[] = Array.isArray(main.events) ? main.events : [];
    return {
      now: main.now || "Working…",
      ...(main.activityDetail ? { detail: main.activityDetail } : {}),
      ...(main.turnStartedAt ? { at: main.turnStartedAt, elapsedMs: Date.now() - main.turnStartedAt } : {}),
      history: events
        .filter((e) => e.kind === "call")
        .slice(-6)
        .map((e) => ({ label: e.tool, at: e.ts ?? undefined, tool: e.tool })),
    };
  } catch {
    return null;
  }
}

// A Hermes agent's token usage for the card, from the same snapshot
// (`sessions`): last-24h sessions with aux calls and subagents folded in.
// token-usage.json's activeSessions only carries the main model's tokens for
// one open session.
async function getHermesTokenUsage(path: string): Promise<AgentTokenUsage | null> {
  try {
    const [raw, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
    if (Date.now() - info.mtimeMs > 60_000) return null;
    const sessions: any[] = JSON.parse(raw)?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    const toInfo = (s: any): SessionTokenInfo => ({
      sessionId: s.id,
      ...(s.title ? { label: s.title } : {}),
      ...(s.lastActivityAt ? { updatedAt: s.lastActivityAt } : {}),
      usage: {
        inputTokens: s.total.inputTokens,
        outputTokens: s.total.outputTokens,
        totalTokens: s.total.inputTokens + s.total.outputTokens,
        cost: 0,
      },
    });
    const recent = sessions
      .filter((s) => (s.lastActivityAt || 0) > Date.now() - 24 * 60 * 60 * 1000)
      .map(toInfo);
    const totals = recent.reduce<TokenUsage>(
      (acc, s) => ({
        totalTokens: acc.totalTokens + s.usage.totalTokens,
        inputTokens: acc.inputTokens + s.usage.inputTokens,
        outputTokens: acc.outputTokens + s.usage.outputTokens,
        cost: 0,
      }),
      { totalTokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
    );
    const working = sessions.find((s) => s.working);
    return { recent, totals, ...(working ? { current: toInfo(working) } : {}) };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const agents: Agent[] = [];
    const presenceMap = await getAgentPresenceMap();
    const bernieStatus = await getHermesSessionInfo();

    for (const agentDef of AGENTS) {
      const files = await getAgentFiles(agentDef.id);
      
      // Find last modified time across all files
      let lastActive: number | undefined;
      for (const file of files) {
        if (file.modifiedAt && (!lastActive || file.modifiedAt > lastActive)) {
          lastActive = file.modifiedAt;
        }
      }

      // Hermes agents (Bernie on the Mac, Edward and Lucy on the PC) come from
      // their hosts' exported snapshots instead of OpenClaw session data.
      const hermesFile = isHermesAgent(agentDef.id) ? hermesSubagentsFileFor(agentDef.id) : null;
      const hermesStatus = !hermesFile
        ? undefined
        : agentDef.id === "bernie"
        ? bernieStatus
        : await getHermesMainInfo(hermesFile);
      if (hermesFile && hermesStatus) {
        const [hermesLive, hermesTokens] = await Promise.all([
          getHermesLiveActivity(hermesFile),
          getHermesTokenUsage(hermesFile),
        ]);
        agents.push({
          ...agentDef,
          files,
          lastActive: hermesStatus.lastActive || lastActive,
          presence: hermesLive ? "working" : hermesStatus.presence,
          ...(hermesLive ? { liveActivity: hermesLive } : {}),
          presenceTask: hermesStatus.task,
          presenceUpdatedAt: hermesStatus.lastActive,
          tokenUsage: hermesTokens || hermesStatus.tokenUsage || { recent: [], totals: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 } },
          ...(hermesStatus.model ? { model: hermesStatus.model } : {}),
        });
        continue;
      }

      const p = presenceMap[agentDef.id] || { presence: "idle" as AgentPresence };
      const [tokenUsage, liveActivity, model, sessionMessageTs] = await Promise.all([
        getAgentTokenUsage(agentDef.id),
        getAgentLiveActivity(agentDef.id),
        getSessionModelForAgent(agentDef.id),
        getLatestSessionMessageTs(agentDef.id),
      ]);

      // Memory-file mtimes alone report an agent as idle for weeks while it is
      // actively working in a session, so take whichever signal is newer.
      const effectiveLastActive =
        sessionMessageTs && (!lastActive || sessionMessageTs > lastActive) ? sessionMessageTs : lastActive;

      agents.push({
        ...agentDef,
        files,
        lastActive: effectiveLastActive,
        presence: p.presence,
        presenceTask: p.task,
        presenceUpdatedAt: p.updatedAt,
        tokenUsage,
        ...(liveActivity ? { liveActivity } : {}),
        ...(model ? { model } : {}),
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

    // Safety: only allow writes in configured shared, clawd, or bernie directories
    if (!filePath.startsWith(SHARED_DIR + "/") && !filePath.startsWith(KEVBOT_DIR + "/") && !filePath.startsWith(BERNIE_DIR + "/")) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    await writeFile(filePath, text, "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to save agent file", error);
    return NextResponse.json({ error: error?.message || "Failed to save agent file" }, { status: 500 });
  }
}
