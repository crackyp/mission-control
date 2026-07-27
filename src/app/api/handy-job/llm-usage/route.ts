import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";

export const dynamic = "force-dynamic";

const JOB_TRACKER_ROOT = "/home/crackypp/shared/Projects/job-tracker";
const BACKEND_ENV = `${JOB_TRACKER_ROOT}/backend/.env`;
const PRICES_PATH = `${JOB_TRACKER_ROOT}/llm_prices.json`;

type Timeframe = "recent" | "24h" | "7d" | "30d" | "90d" | "month" | "ytd";

type LlmUsageRow = {
  id?: string;
  createdAt?: string;
  userId?: string | null;
  feature?: string | null;
  provider?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  status?: string | null;
  errorMessage?: string | null;
  requestId?: string | null;
};

type PricedRow = LlmUsageRow & { costUsd: number };

type Totals = {
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRate: number;
};

function parseEnvFile(path: string): Record<string, string> {
  try {
    const env: Record<string, string> = {};
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      let value = rest.join("=").trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key.trim()] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function getSupabaseConfig() {
  const env = parseEnvFile(BACKEND_ENV);
  const url = (process.env.HANDY_JOB_SUPABASE_URL || process.env.SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.HANDY_JOB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Handy Job Supabase URL/service key");
  return { url, key };
}

function loadPrices() {
  try {
    return JSON.parse(readFileSync(PRICES_PATH, "utf8"));
  } catch {
    return { models: {}, local_projection: { default: null, by_feature: {} } };
  }
}

const modelDateSuffix = /-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{6})$/;
function normalizeModelId(model: string): string {
  return (model || "").trim().replace(modelDateSuffix, "");
}

function projectCostUsd(row: LlmUsageRow, prices: any): number {
  const models = prices?.models || {};
  const projection = prices?.local_projection || {};
  const provider = row.provider || "";
  const feature = row.feature === "wrapper" ? "unknown (legacy wrapper)" : row.feature || "unknown";
  const model = row.model || "";
  let rates: any = null;

  if (provider === "llamacpp") {
    const target = projection?.by_feature?.[feature] || projection?.default;
    rates = models[target || ""];
  } else {
    rates = models[model] || models[normalizeModelId(model)];
  }

  if (!rates) return 0;
  const input = ((row.promptTokens || 0) / 1_000_000) * (rates.input_per_1m || 0);
  const output = ((row.completionTokens || 0) / 1_000_000) * (rates.output_per_1m || 0);
  return input + output;
}

function getRange(timeframe: Timeframe) {
  const now = new Date();
  let start: Date;
  if (timeframe === "recent") start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  else if (timeframe === "24h") start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  else if (timeframe === "7d") start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (timeframe === "30d") start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  else if (timeframe === "90d") start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  else if (timeframe === "month") start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  else start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const durationMs = Math.max(1, now.getTime() - start.getTime());
  return {
    start,
    end: now,
    priorStart: new Date(start.getTime() - durationMs),
    priorEnd: start,
    durationDays: durationMs / 86_400_000,
  };
}

async function fetchRows(start?: Date, end?: Date, limit = 50000): Promise<LlmUsageRow[]> {
  const { url, key } = getSupabaseConfig();
  const params = new URLSearchParams({
    select: "id,createdAt,userId,feature,provider,model,promptTokens,completionTokens,totalTokens,latencyMs,status,errorMessage,requestId",
    order: "createdAt.desc",
    limit: String(limit),
  });
  if (start) params.append("createdAt", `gte.${start.toISOString()}`);
  if (end) params.append("createdAt", `lt.${end.toISOString()}`);

  const res = await fetch(`${url}/rest/v1/LlmUsage?${params.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostgREST ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as LlmUsageRow[];
}

function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function totals(rows: PricedRow[]): Totals {
  const latencySum = rows.reduce((sum, row) => sum + (row.latencyMs || 0), 0);
  const calls = rows.length;
  const errors = rows.filter((row) => row.status === "error").length;
  return {
    calls,
    errors,
    promptTokens: rows.reduce((sum, row) => sum + (row.promptTokens || 0), 0),
    completionTokens: rows.reduce((sum, row) => sum + (row.completionTokens || 0), 0),
    totalTokens: rows.reduce((sum, row) => sum + (row.totalTokens || 0), 0),
    costUsd: roundMoney(rows.reduce((sum, row) => sum + row.costUsd, 0)),
    avgLatencyMs: calls ? Math.round(latencySum / calls) : 0,
    errorRate: calls ? errors / calls : 0,
  };
}

function groupBy<T extends Record<string, any>>(rows: PricedRow[], keyFn: (row: PricedRow) => string, labelKey: string): T[] {
  const map = new Map<string, any>();
  for (const row of rows) {
    const label = keyFn(row) || "unknown";
    const g = map.get(label) || {
      [labelKey]: label,
      calls: 0,
      errors: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMsSum: 0,
      costUsd: 0,
      lastCallAt: null,
    };
    g.calls += 1;
    g.errors += row.status === "error" ? 1 : 0;
    g.promptTokens += row.promptTokens || 0;
    g.completionTokens += row.completionTokens || 0;
    g.totalTokens += row.totalTokens || 0;
    g.latencyMsSum += row.latencyMs || 0;
    g.costUsd += row.costUsd;
    if (row.createdAt && (!g.lastCallAt || row.createdAt > g.lastCallAt)) g.lastCallAt = row.createdAt;
    map.set(label, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, avgLatencyMs: g.calls ? Math.round(g.latencyMsSum / g.calls) : 0, costUsd: roundMoney(g.costUsd), latencyMsSum: undefined }))
    .sort((a, b) => b.costUsd - a.costUsd) as T[];
}

function timeline(rows: PricedRow[], start: Date, end: Date) {
  const spanMs = Math.max(1, end.getTime() - start.getTime());
  const buckets = spanMs <= 36 * 60 * 60 * 1000 ? 24 : Math.min(60, Math.ceil(spanMs / 86_400_000));
  const bucketMs = spanMs / buckets;
  const arr = Array.from({ length: buckets }, (_, i) => {
    const bucketStart = new Date(start.getTime() + i * bucketMs);
    return { label: bucketStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }), calls: 0, costUsd: 0, tokens: 0 };
  });
  if (buckets === 24) {
    arr.forEach((bucket, i) => {
      bucket.label = new Date(start.getTime() + i * bucketMs).toLocaleTimeString("en-US", { hour: "numeric" });
    });
  }
  for (const row of rows) {
    const t = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((t - start.getTime()) / bucketMs)));
    arr[index].calls += 1;
    arr[index].costUsd = roundMoney(arr[index].costUsd + row.costUsd);
    arr[index].tokens += row.totalTokens || 0;
  }
  return arr;
}

function featureBreakdown(rows: PricedRow[]) {
  const map = new Map<string, any>();
  const sortedRows = [...rows].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  for (const row of sortedRows) {
    const feature = row.feature || "unknown";
    const provider = row.provider || "unknown";
    const model = row.model || "unknown";
    const key = `${feature}|||${provider}|||${model}`;
    const g = map.get(key) || {
      id: key,
      feature,
      provider,
      model,
      calls: 0,
      errors: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMsSum: 0,
      costUsd: 0,
      lastCallAt: null,
      recentCalls: [],
    };

    g.calls += 1;
    g.errors += row.status === "error" ? 1 : 0;
    g.promptTokens += row.promptTokens || 0;
    g.completionTokens += row.completionTokens || 0;
    g.totalTokens += row.totalTokens || 0;
    g.latencyMsSum += row.latencyMs || 0;
    g.costUsd += row.costUsd;
    if (row.createdAt && (!g.lastCallAt || row.createdAt > g.lastCallAt)) g.lastCallAt = row.createdAt;
    if (g.recentCalls.length < 15) {
      g.recentCalls.push({
        id: row.id,
        createdAt: row.createdAt,
        userId: row.userId || null,
        promptTokens: row.promptTokens || 0,
        completionTokens: row.completionTokens || 0,
        costUsd: roundMoney(row.costUsd),
        status: row.status || "ok",
      });
    }
    map.set(key, g);
  }

  return [...map.values()]
    .map((g) => ({
      ...g,
      avgLatencyMs: g.calls ? Math.round(g.latencyMsSum / g.calls) : 0,
      costUsd: roundMoney(g.costUsd),
      latencyMsSum: undefined,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function delta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export async function GET(request: NextRequest) {
  try {
    const timeframe = ((request.nextUrl.searchParams.get("timeframe") || "30d") as Timeframe);
    const valid: Timeframe[] = ["recent", "24h", "7d", "30d", "90d", "month", "ytd"];
    const selected = valid.includes(timeframe) ? timeframe : "30d";
    const range = getRange(selected);
    const prices = loadPrices();

    const [currentRaw, priorRaw] = selected === "recent"
      ? await Promise.all([fetchRows(undefined, undefined, 200), Promise.resolve([] as LlmUsageRow[])])
      : await Promise.all([fetchRows(range.start, range.end), fetchRows(range.priorStart, range.priorEnd)]);
    const currentRows = currentRaw.map((row) => ({ ...row, feature: row.feature === "wrapper" ? "unknown (legacy wrapper)" : row.feature, costUsd: projectCostUsd(row, prices) }));
    const priorRows = priorRaw.map((row) => ({ ...row, costUsd: projectCostUsd(row, prices) }));
    const total = totals(currentRows);
    const prior = totals(priorRows);

    return NextResponse.json({
      success: true,
      timeframe: selected,
      range: {
        start: (selected === "recent" && currentRows.length && currentRows[currentRows.length - 1].createdAt) ? currentRows[currentRows.length - 1].createdAt : range.start.toISOString(),
        end: (selected === "recent" && currentRows.length && currentRows[0].createdAt) ? currentRows[0].createdAt : range.end.toISOString(),
        durationDays: range.durationDays,
      },
      totals: { ...total, projectedMonthlyUsd: roundMoney(total.costUsd * (30 / Math.max(range.durationDays, 1 / 24))) },
      deltas: {
        costUsd: delta(total.costUsd, prior.costUsd),
        calls: delta(total.calls, prior.calls),
        totalTokens: delta(total.totalTokens, prior.totalTokens),
        errorRate: total.errorRate - prior.errorRate,
        avgLatencyMs: delta(total.avgLatencyMs, prior.avgLatencyMs),
      },
      byFeature: groupBy(currentRows, (row) => row.feature || "unknown", "feature"),
      byProvider: groupBy(currentRows, (row) => row.provider || "unknown", "provider"),
      byModel: groupBy(currentRows, (row) => row.model || "unknown", "model"),
      timeline: timeline(currentRows, range.start, range.end),
      tokenSplit: { promptTokens: total.promptTokens, completionTokens: total.completionTokens },
      featureBreakdown: featureBreakdown(currentRows),
      recent: currentRows.slice(0, 50).map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        feature: row.feature || "unknown",
        provider: row.provider || "unknown",
        model: row.model || "unknown",
        totalTokens: row.totalTokens || 0,
        promptTokens: row.promptTokens || 0,
        completionTokens: row.completionTokens || 0,
        latencyMs: row.latencyMs || 0,
        status: row.status || "ok",
        errorMessage: row.errorMessage || null,
        costUsd: roundMoney(row.costUsd),
      })),
    });
  } catch (error) {
    console.error("Failed to build Handy Job LLM dashboard data", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
