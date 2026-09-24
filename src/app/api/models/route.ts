import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

const OPENCLAW_CONFIG_FILE = runtimeConfig.openclawConfigFile;
const MAC_HERMES_JOBS_FILE = runtimeConfig.macHermesJobsFile;
const CACHE_TTL_MS = 5_000;

type ModelOption = {
  value: string;
  label: string;
  group?: string;
};

type OpenClawConfig = {
  gateway?: {
    port?: number;
    auth?: { token?: string };
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      models?: Record<string, unknown>;
    };
  };
};

// llama-swap's full model registry. MC runs on the Pi and cannot reach the
// Mac's llama-swap directly, so the Hermes host exports the snapshot
// llamaswap-status.json (llamaswap-status-export.py on the Mac) to the share.
// The snapshot's `stale` flag tells the UI when the registry went quiet.
//
// `catalog` is llama-swap's actual /v1/models list, minus entries whose
// weights are gone from disk (`catalogUnavailable` — qwen3.6-27b since the
// 08-19 disk reclaim), so the dropdown never offers a model that hard-fails at
// load. Snapshots written before 2026-09-21 have no `catalog`; for those we
// fall back to the old derivation (resident models + models the gate has seen
// traffic for), which undercounts — it listed 5 of 8 ids — because a model
// that has not been touched recently drops out of it silently.
type LlamaswapSnapshot = {
  catalog?: string[];
  catalogUnavailable?: string[];
  runningModels?: Array<{ model?: string }>;
  gate?: { activityCounts?: Record<string, number> } | null;
  generatedAtIso?: string;
  state?: string;
  wedged?: { wedged?: boolean };
};

function snapshotModelIds(snap: LlamaswapSnapshot): {
  ids: string[];
  source: "catalog" | "derived";
} {
  if (Array.isArray(snap.catalog) && snap.catalog.length) {
    return { ids: [...snap.catalog], source: "catalog" };
  }
  const ids = new Set<string>();
  for (const m of snap.runningModels || []) {
    if (m?.model) ids.add(m.model);
  }
  for (const id of Object.keys(snap.gate?.activityCounts || {})) {
    if (id) ids.add(id);
  }
  return { ids: [...ids], source: "derived" };
}

function prettyLabel(id: string): string {
  return id
    .replace(/^openai-codex\//, "Codex ")
    .replace(/^openai\//, "OpenAI ")
    .replace(/^anthropic\//, "Anthropic ")
    .replace(/^moonshot\//, "Moonshot ")
    .replace(/^google\//, "Google ")
    .replace(/^ollama\//, "Ollama ")
    .replace(/^modal\//, "Modal ");
}

type CacheEntry = {
  at: number;
  body: unknown;
};
let cache: CacheEntry | null = null;

async function readOpenClawConfig(): Promise<OpenClawConfig> {
  const raw = await readFile(OPENCLAW_CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as OpenClawConfig;
}

function openclawModelIds(cfg: OpenClawConfig): string[] {
  const mapKeys = Object.keys(cfg.agents?.defaults?.models || {});
  const primary = cfg.agents?.defaults?.model?.primary;
  const fallbacks = cfg.agents?.defaults?.model?.fallbacks || [];
  return [...mapKeys, ...(primary ? [primary] : []), ...fallbacks];
}

async function readLlamaswapSnapshot(): Promise<{
  ids: string[];
  source?: "catalog" | "derived";
  unavailable?: string[];
  state?: string;
  generatedAtIso?: string;
  error: string | null;
}> {
  try {
    const raw = await readFile(runtimeConfig.llamaswapStatusFile, "utf-8");
    const snap = JSON.parse(raw) as LlamaswapSnapshot;
    const { ids, source } = snapshotModelIds(snap);
    return {
      ids,
      source,
      unavailable: snap.catalogUnavailable || [],
      state: snap.state,
      generatedAtIso: snap.generatedAtIso,
      error: null,
    };
  } catch (e: any) {
    return { ids: [], error: e?.message || "llamaswap-status.json unreadable" };
  }
}

async function readMacHermesModels(): Promise<{
  models: string[];
  providers: string[];
  error: string | null;
}> {
  try {
    const raw = await readFile(MAC_HERMES_JOBS_FILE, "utf-8");
    const data = JSON.parse(raw) as {
      jobs?: Array<{ model?: unknown; provider?: unknown }>;
    };
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const models = jobs
      .map((j) => (typeof j?.model === "string" ? j.model : ""))
      .filter(Boolean);
    const providers = jobs
      .map((j) => (typeof j?.provider === "string" ? j.provider : ""))
      .filter(Boolean);
    return { models, providers, error: null };
  } catch (e: any) {
    return { models: [], providers: [], error: e?.message || "mac jobs.json unreadable" };
  }
}

function toOptions(
  ids: string[],
  group: string,
  overrides: Set<string> = new Set()
): ModelOption[] {
  const unique = Array.from(new Set(ids.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  return unique.map((id) => ({
    value: id,
    label: overrides.has(id) ? `${prettyLabel(id)} (current override)` : prettyLabel(id),
    group,
  }));
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body as any, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  const [openclawCfgRes, llamaRes, macJobsRes] = await Promise.all([
    readOpenClawConfig()
      .then((cfg) => ({ ids: openclawModelIds(cfg), error: null as string | null }))
      .catch((e: any) => ({ ids: [], error: e?.message || "openclaw.json unreadable" })),
    readLlamaswapSnapshot(),
    readMacHermesModels(),
  ]);

  const macOverrideSet = new Set(macJobsRes.models);

  const groups: Array<{ name: string; options: ModelOption[] }> = [
    {
      name: "OpenClaw (Kevbot / Ricky)",
      options: toOptions(openclawCfgRes.ids, "openclaw"),
    },
    {
      name: "Mac llama-swap",
      options: toOptions(llamaRes.ids, "llamaswap", macOverrideSet),
    },
    {
      name: "Mac Hermes job overrides",
      options: toOptions(
        macJobsRes.models.filter((m) => !llamaRes.ids.includes(m)),
        "mac-jobs"
      ),
    },
  ].filter((g) => g.options.length > 0);

  const flat: ModelOption[] = groups.flatMap((g) => g.options);
  const seen = new Set<string>();
  const models = flat.filter((m) => {
    if (seen.has(m.value)) return false;
    seen.add(m.value);
    return true;
  });

  const body = {
    models,
    groups: groups.map((g) => ({ name: g.name, count: g.options.length })),
    providers: Array.from(new Set(macJobsRes.providers)).sort((a, b) =>
      a.localeCompare(b)
    ),
    sources: {
      openclaw: openclawCfgRes.error
        ? { ok: false, error: openclawCfgRes.error }
        : { ok: true, count: openclawCfgRes.ids.length },
      llamaswap: llamaRes.error
        ? { ok: false, error: llamaRes.error }
        : {
            ok: true,
            count: llamaRes.ids.length,
            source: llamaRes.source,
            unavailable: llamaRes.unavailable,
            snapshotState: llamaRes.state,
            snapshotAt: llamaRes.generatedAtIso,
          },
      macJobs: macJobsRes.error
        ? { ok: false, error: macJobsRes.error }
        : { ok: true, count: macJobsRes.models.length },
    },
    stale: !llamaRes.ids.length && !!llamaRes.error,
    updatedAt: now,
  };

  cache = { at: now, body };
  return NextResponse.json(body as any, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}