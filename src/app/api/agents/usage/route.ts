import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { runtimeConfig } from "@/lib/runtime-config";
import { resolveCredential, resolveProviderOrder } from "@/lib/openclaw-auth";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const OPENCLAW_BIN = runtimeConfig.openclawBin;

const CACHE_TTL_MS = 10 * 60_000;
const CMD_TIMEOUT_MS = 65_000;
const WHAM_TIMEOUT_MS = 12_000;
const MINIMAX_COOKIE_MISSING_RE = /cookie is missing|log in again/i;

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

let usageCache:
  | {
      fetchedAt: number;
      snapshot: UsageSnapshot;
    }
  | undefined;

let usageInflight: Promise<UsageSnapshot | undefined> | undefined;

function readOpenAiCodexAuth(): { token: string; accountId?: string } | null {
  try {
    const profileOrder = resolveProviderOrder("openai-codex");
    const profiles = profileOrder
      .map((profileId) => resolveCredential(profileId))
      .filter((cred): cred is NonNullable<ReturnType<typeof resolveCredential>> => !!cred);

    const credential =
      profiles.find((cred) => cred.type === "oauth" && typeof cred.access === "string" && cred.access.trim()) ||
      profiles.find((cred) => cred.type === "token" && typeof cred.token === "string" && cred.token.trim());

    if (!credential) return null;

    const token = typeof credential.access === "string"
      ? credential.access.trim()
      : typeof credential.token === "string"
        ? credential.token.trim()
        : "";
    if (!token) return null;

    return {
      token,
      ...(typeof credential.accountId === "string" && credential.accountId.trim()
        ? { accountId: credential.accountId.trim() }
        : {}),
    };
  } catch {
    // ignore
  }
  return null;
}

async function fetchCodexWhamUsage(): Promise<ProviderUsageEntry | null> {
  const auth = readOpenAiCodexAuth();
  if (!auth?.token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHAM_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      "User-Agent": "MissionControl",
    };
    if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        provider: "openai-codex",
        displayName: "Codex",
        error: `Live Codex quota endpoint returned HTTP ${response.status}.`,
        windows: [],
      };
    }

    const data = (await response.json()) as any;
    const windows: UsageWindow[] = [];
    const primaryWindow = data?.rate_limit?.primary_window;
    const secondaryWindow = data?.rate_limit?.secondary_window;

    if (primaryWindow && typeof primaryWindow === "object") {
      const seconds = Number(primaryWindow.limit_window_seconds);
      windows.push({
        label: `${Math.round((Number.isFinite(seconds) && seconds > 0 ? seconds : 10800) / 3600)}h`,
        usedPercent: Math.max(0, Math.min(100, Number(primaryWindow.used_percent) || 0)),
        ...(Number.isFinite(Number(primaryWindow.reset_at)) ? { resetAt: Number(primaryWindow.reset_at) * 1000 } : {}),
      });
    }

    if (secondaryWindow && typeof secondaryWindow === "object") {
      const seconds = Number(secondaryWindow.limit_window_seconds);
      const hours = Math.round((Number.isFinite(seconds) && seconds > 0 ? seconds : 86400) / 3600);
      const primaryResetAt = Number(primaryWindow?.reset_at);
      const secondaryResetAt = Number(secondaryWindow.reset_at);
      const weekGapSeconds = 4320 * 60;
      const label = hours >= 168
        ? "Week"
        : hours < 24
          ? `${hours}h`
          : Number.isFinite(primaryResetAt) && Number.isFinite(secondaryResetAt) && secondaryResetAt - primaryResetAt >= weekGapSeconds
            ? "Week"
            : "Day";
      windows.push({
        label,
        usedPercent: Math.max(0, Math.min(100, Number(secondaryWindow.used_percent) || 0)),
        ...(Number.isFinite(secondaryResetAt) ? { resetAt: secondaryResetAt * 1000 } : {}),
      });
    }

    let plan = typeof data?.plan_type === "string" && data.plan_type.trim() ? data.plan_type.trim() : undefined;
    const balance = Number(data?.credits?.balance);
    if (Number.isFinite(balance)) {
      const balanceLabel = `$${balance.toFixed(2)}`;
      plan = plan ? `${plan} (${balanceLabel})` : balanceLabel;
    }

    return {
      provider: "openai-codex",
      displayName: "Codex",
      ...(plan ? { plan } : {}),
      windows,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Live Codex quota lookup timed out."
      : "Live Codex quota endpoint unavailable.";
    return {
      provider: "openai-codex",
      displayName: "Codex",
      error: message,
      windows: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function usageUnavailableSnapshot(reason: string): UsageSnapshot {
  return {
    updatedAt: Date.now(),
    stale: true,
    providers: [
      {
        provider: "openai-codex",
        displayName: "Codex",
        error: reason,
        windows: [],
      },
    ],
  };
}

function normalizeProviderKey(value: string | undefined): string {
  const key = (value || "").trim().toLowerCase();
  if (!key) return "unknown";
  if (key === "openai-codex" || key === "codex") return "openai-codex";
  return key;
}

function deriveCodexSessionFallbackWindow(raw: unknown): UsageWindow | undefined {
  const sessions = (raw as any)?.sessions;
  const recent = Array.isArray(sessions?.recent) ? (sessions.recent as unknown[]) : [];
  const byAgent = Array.isArray(sessions?.byAgent) ? (sessions.byAgent as unknown[]) : [];

  const candidates = [...recent, ...byAgent.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const rec = entry as Record<string, unknown>;
    return Array.isArray(rec.recent) ? (rec.recent as unknown[]) : [];
  })]
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const rec = entry as Record<string, unknown>;
      const provider = normalizeProviderKey(typeof rec.provider === "string" ? rec.provider : undefined);
      const model = typeof rec.model === "string" ? rec.model.toLowerCase() : "";
      if (provider !== "openai-codex" && !model.includes("gpt-5") && !model.includes("codex")) return null;

      const percentUsed = toFiniteNumber(rec.percentUsed);
      const totalTokens = toFiniteNumber(rec.totalTokens);
      const contextTokens = toFiniteNumber(rec.contextTokens);
      const updatedAt = toFiniteNumber(rec.updatedAt) ?? 0;

      const derivedPercent =
        percentUsed ??
        (totalTokens !== undefined && contextTokens !== undefined && contextTokens > 0
          ? (totalTokens / contextTokens) * 100
          : undefined);

      if (derivedPercent === undefined) return null;
      return {
        updatedAt,
        usedPercent: Math.max(0, Math.min(100, derivedPercent)),
      };
    })
    .filter((entry): entry is { updatedAt: number; usedPercent: number } => !!entry)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const newest = candidates[0];
  if (!newest) return undefined;

  return {
    label: "Session context",
    usedPercent: newest.usedPercent,
  };
}

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

function toFiniteNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function extractMiniMaxCandidates(entries: unknown[]): Array<{ updatedAt: number; usedPercent: number }> {
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const rec = entry as Record<string, unknown>;

      const model = typeof rec.model === "string" ? rec.model : "";
      const provider = typeof rec.provider === "string" ? rec.provider : "";
      if (!model.toLowerCase().includes("minimax") && !provider.toLowerCase().includes("minimax")) return null;

      const percentUsed = toFiniteNumber(rec.percentUsed);
      const totalTokens = toFiniteNumber(rec.totalTokens);
      const contextTokens = toFiniteNumber(rec.contextTokens);

      const derivedPercent =
        percentUsed ??
        (totalTokens !== undefined && contextTokens !== undefined && contextTokens > 0
          ? (totalTokens / contextTokens) * 100
          : undefined);

      if (derivedPercent === undefined) return null;

      return {
        updatedAt: toFiniteNumber(rec.updatedAt) ?? 0,
        usedPercent: Math.max(0, Math.min(100, derivedPercent)),
      };
    })
    .filter((entry): entry is { updatedAt: number; usedPercent: number } => !!entry);
}

function deriveMiniMaxSessionFallbackWindow(raw: unknown): UsageWindow | undefined {
  const sessions = (raw as any)?.sessions;
  const recent = Array.isArray(sessions?.recent) ? (sessions.recent as unknown[]) : [];
  const byAgentRecent = Array.isArray(sessions?.byAgent)
    ? (sessions.byAgent as unknown[])
        .flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const rec = entry as Record<string, unknown>;
          return Array.isArray(rec.recent) ? (rec.recent as unknown[]) : [];
        })
    : [];

  const minimaxRecent = [...extractMiniMaxCandidates(recent), ...extractMiniMaxCandidates(byAgentRecent)].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  const newest = minimaxRecent[0];
  if (!newest) return undefined;

  return {
    label: "Session context",
    usedPercent: newest.usedPercent,
  };
}

function applyProviderFallbacksFromSessions(providers: ProviderUsageEntry[], rawStatusPayload: unknown): ProviderUsageEntry[] {
  const nextProviders = providers.map((provider) => {
    const providerKey = normalizeProviderKey(provider.provider);
    if (providerKey !== "minimax") return provider;
    if (!provider.error || !MINIMAX_COOKIE_MISSING_RE.test(provider.error)) return provider;

    const fallbackWindow = deriveMiniMaxSessionFallbackWindow(rawStatusPayload);
    if (!fallbackWindow) {
      return {
        ...provider,
        error:
          "MiniMax live quota unavailable with current auth. Showing session-derived usage only.",
      };
    }

    return {
      ...provider,
      windows: [fallbackWindow],
      plan: provider.plan || "Session context fallback",
      error: "MiniMax live quota unavailable with current auth, showing latest session context.",
    };
  });

  const hasCodexProvider = nextProviders.some((provider) => normalizeProviderKey(provider.provider) === "openai-codex");
  if (!hasCodexProvider) {
    const codexFallback = deriveCodexSessionFallbackWindow(rawStatusPayload);
    nextProviders.unshift({
      provider: "openai-codex",
      displayName: "Codex",
      ...(codexFallback
        ? {
            windows: [codexFallback],
            plan: "Session context fallback",
            error: "Live Codex quota endpoint unavailable, showing latest session context.",
          }
        : {
            windows: [],
            error: "Live Codex quota endpoint unavailable.",
          }),
    });
  }

  return nextProviders;
}

async function loadUsageSnapshot(force = false): Promise<UsageSnapshot | undefined> {
  const now = Date.now();
  if (!force && usageCache && now - usageCache.fetchedAt < CACHE_TTL_MS) {
    return usageCache.snapshot;
  }

  const whamCodexProvider = await fetchCodexWhamUsage();

  if (usageInflight) return usageInflight;

  usageInflight = (async () => {
    try {
      const { stdout } = await execFileAsync(
        OPENCLAW_BIN,
        ["status", "--json", "--usage"],
        {
          timeout: CMD_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: 2 * 1024 * 1024,
          cwd: runtimeConfig.clawdDir,
          env: {
            ...process.env,
            HOME: runtimeConfig.homeDir,
            PATH: `${process.env.PATH || ""}:${runtimeConfig.homeDir}/.npm-global/bin`,
          },
        }
      );

      const parsed = JSON.parse(String(stdout)) as {
        usage?: { updatedAt?: number; providers?: unknown[] };
        sessions?: { recent?: unknown[] };
      };
      const parsedProviders = parseUsageProviders(parsed?.usage?.providers);
      const nonCodexProviders = parsedProviders.filter((provider) => normalizeProviderKey(provider.provider) !== "openai-codex");
      const mergedProviders = whamCodexProvider
        ? [whamCodexProvider, ...nonCodexProviders]
        : parsedProviders;
      const snapshot: UsageSnapshot = {
        updatedAt:
          typeof parsed?.usage?.updatedAt === "number" && Number.isFinite(parsed.usage.updatedAt)
            ? parsed.usage.updatedAt
            : Date.now(),
        providers: applyProviderFallbacksFromSessions(mergedProviders, parsed),
      };

      if (
        mergedProviders.length === 0 &&
        snapshot.providers.length > 0 &&
        snapshot.providers.every((provider) => provider.provider === "openai-codex")
      ) {
        snapshot.stale = true;
      }

      usageCache = {
        fetchedAt: Date.now(),
        snapshot,
      };

      return snapshot;
    } catch {
      if (usageCache) {
        return {
          ...usageCache.snapshot,
          stale: true,
        };
      }
      if (whamCodexProvider) {
        return {
          updatedAt: Date.now(),
          stale: true,
          providers: [whamCodexProvider],
        };
      }
      return usageUnavailableSnapshot("Live quota lookup timed out. Mission Control will show session-derived Codex usage when available.");
    } finally {
      usageInflight = undefined;
    }
  })();

  return usageInflight;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const usageSnapshot = await loadUsageSnapshot(force);
    return NextResponse.json({
      ...(usageSnapshot ? { usageSnapshot } : {}),
    });
  } catch (error) {
    console.error("Failed to fetch usage snapshot", error);
    return NextResponse.json({ error: "Failed to fetch usage snapshot" }, { status: 500 });
  }
}
