"use client";

import { useEffect, useMemo, useState } from "react";

type Timeframe = "recent" | "24h" | "7d" | "30d" | "90d" | "month" | "ytd";

type Totals = {
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  projectedMonthlyUsd: number;
  avgLatencyMs: number;
  errorRate: number;
};

type GroupRow = {
  feature?: string;
  provider?: string;
  model?: string;
  error?: string;
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  costUsd: number;
  lastCallAt?: string | null;
};

type TimelineBucket = { label: string; calls: number; costUsd: number; tokens: number };
type FeatureCall = {
  id?: string;
  createdAt?: string;
  userId?: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  status: string;
};

type FeatureBreakdownRow = GroupRow & {
  id: string;
  feature: string;
  provider: string;
  model: string;
  recentCalls: FeatureCall[];
};

type RecentRow = {
  id?: string;
  createdAt?: string;
  feature: string;
  provider: string;
  model: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status: string;
  errorMessage?: string | null;
  costUsd: number;
};

type DashboardData = {
  success: boolean;
  error?: string;
  timeframe: Timeframe;
  range: { start: string; end: string; durationDays: number };
  totals: Totals;
  deltas: Record<string, number | null>;
  byFeature: GroupRow[];
  byProvider: GroupRow[];
  byModel: GroupRow[];
  timeline: TimelineBucket[];
  tokenSplit: { promptTokens: number; completionTokens: number };
  featureBreakdown: FeatureBreakdownRow[];
  recent: RecentRow[];
};

const timeframeOptions: Array<{ key: Timeframe; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "month", label: "This month" },
  { key: "ytd", label: "YTD" },
];

function money(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value || 0);
}

function compact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function integer(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}

function userLabel(userId?: string | null) {
  if (!userId) return "—";
  return userId.length > 12 ? `${userId.slice(0, 8)}…${userId.slice(-4)}` : userId;
}

function percent(value: number) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function latency(ms: number) {
  if (!ms) return "0ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function deltaLabel(value: number | null, lowerIsGood = false) {
  if (value === null) return "new activity";
  const abs = Math.abs(value * 100).toFixed(0);
  if (Math.abs(value) < 0.005) return "flat vs prior";
  const arrow = value > 0 ? "↑" : "↓";
  const good = lowerIsGood ? value < 0 : value > 0;
  return `${arrow} ${abs}% vs prior${good ? "" : ""}`;
}

function Delta({ value, lowerIsGood = false }: { value: number | null; lowerIsGood?: boolean }) {
  const isBad = value !== null && Math.abs(value) >= 0.005 && (lowerIsGood ? value > 0 : value < 0);
  const isGood = value !== null && Math.abs(value) >= 0.005 && (lowerIsGood ? value < 0 : value > 0);
  return <div className={`mt-1 text-[11px] ${isBad ? "text-red-400" : isGood ? "text-emerald-400" : "text-linear-text-tertiary"}`}>{deltaLabel(value, lowerIsGood)}</div>;
}

function KpiCard({ label, value, delta, lowerIsGood, accent = "bg-violet-500" }: { label: string; value: string; delta?: number | null; lowerIsGood?: boolean; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-linear-text-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-linear-text">{value}</div>
      {delta !== undefined ? <Delta value={delta} lowerIsGood={lowerIsGood} /> : <div className="mt-1 text-[11px] text-linear-text-tertiary">based on selected window</div>}
      <div className={`absolute bottom-0 left-0 h-0.5 w-full ${accent} opacity-70`} />
    </div>
  );
}

function HorizontalBars({ rows, labelKey, valueKey = "costUsd", format = (v: number) => money(v, 2) }: { rows: GroupRow[]; labelKey: "feature" | "provider" | "model"; valueKey?: "costUsd" | "calls" | "totalTokens"; format?: (v: number) => string }) {
  const topRows = [...rows].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0)).slice(0, 8);
  const max = Math.max(1, ...topRows.map((row) => Number(row[valueKey]) || 0));
  return (
    <div className="space-y-2">
      {topRows.map((row, index) => {
        const value = Number(row[valueKey]) || 0;
        return (
          <div key={`${row[labelKey]}-${index}`} className="grid grid-cols-[minmax(90px,150px)_1fr_74px] items-center gap-3 text-xs">
            <div className="truncate text-right text-linear-text-secondary" title={String(row[labelKey] || "unknown")}>{row[labelKey] || "unknown"}</div>
            <div className="h-5 overflow-hidden rounded bg-linear-bg-tertiary">
              <div className="h-full rounded bg-violet-500/80" style={{ width: `${Math.max(3, (value / max) * 100)}%` }} />
            </div>
            <div className="text-right tabular-nums text-linear-text-tertiary">{format(value)}</div>
          </div>
        );
      })}
      {topRows.length === 0 && <div className="py-6 text-center text-sm text-linear-text-tertiary">No usage in this window.</div>}
    </div>
  );
}

function Timeline({ buckets }: { buckets: TimelineBucket[] }) {
  const maxCost = Math.max(0, ...buckets.map((b) => b.costUsd));
  const maxCalls = Math.max(0, ...buckets.map((b) => b.calls));
  const hasAnyData = buckets.some((bucket) => bucket.calls > 0 || bucket.costUsd > 0);

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[11px] text-linear-text-tertiary">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> Cost</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Calls</span>
      </div>
      <div className="flex h-32 items-end gap-1 rounded-md bg-linear-bg p-3">
        {!hasAnyData && <div className="m-auto text-sm text-linear-text-tertiary">No usage in this window.</div>}
        {hasAnyData && buckets.map((bucket, index) => {
          const costHeight = maxCost > 0 && bucket.costUsd > 0 ? Math.max(8, (bucket.costUsd / maxCost) * 100) : 0;
          const callHeight = maxCalls > 0 && bucket.calls > 0 ? Math.max(8, (bucket.calls / maxCalls) * 100) : 0;
          return (
            <div key={`${bucket.label}-${index}`} className="group relative flex h-full flex-1 items-end gap-[2px]">
              <div
                className="min-w-[3px] flex-1 rounded-t bg-violet-500/85 transition group-hover:bg-violet-400"
                style={{ height: `${costHeight}%` }}
              />
              <div
                className="min-w-[3px] flex-1 rounded-t bg-blue-400/75 transition group-hover:bg-blue-300"
                style={{ height: `${callHeight}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-linear-border bg-linear-bg px-2 py-1 text-[11px] text-linear-text shadow-lg group-hover:block">
                {bucket.label}: {money(bucket.costUsd, 4)} · {bucket.calls} calls · {compact(bucket.tokens)} tokens
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-linear-text-tertiary">
        <span>{buckets[0]?.label || ""}</span>
        <span>{buckets[Math.floor(buckets.length / 2)]?.label || ""}</span>
        <span>{buckets[buckets.length - 1]?.label || ""}</span>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
      <h3 className="mb-4 text-sm font-medium text-linear-text">{title}</h3>
      {children}
    </section>
  );
}

function TokenSplit({ promptTokens, completionTokens }: { promptTokens: number; completionTokens: number }) {
  const total = promptTokens + completionTokens;
  const promptPct = total ? (promptTokens / total) * 100 : 50;
  return (
    <div className="flex items-center gap-6">
      <div
        className="relative h-28 w-28 rounded-full"
        style={{ background: `conic-gradient(rgb(139 92 246) 0% ${promptPct}%, rgb(88 166 255) ${promptPct}% 100%)` }}
      >
        <div className="absolute inset-6 rounded-full bg-linear-bg-secondary" />
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-linear-text-secondary"><span className="h-3 w-3 rounded-sm bg-violet-500" /> Prompt {compact(promptTokens)}</div>
        <div className="flex items-center gap-2 text-linear-text-secondary"><span className="h-3 w-3 rounded-sm bg-blue-400" /> Completion {compact(completionTokens)}</div>
      </div>
    </div>
  );
}

function FeatureBreakdown({ rows }: { rows: FeatureBreakdownRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !q || row.feature.toLowerCase().includes(q) || row.model.toLowerCase().includes(q) || row.provider.toLowerCase().includes(q);
      const matchesProvider = !provider || row.provider === provider;
      const matchesStatus = !status || (status === "error" ? row.errors > 0 : row.errors === 0);
      return matchesQuery && matchesProvider && matchesStatus;
    });
  }, [rows, query, provider, status]);

  const providers = useMemo(() => [...new Set(rows.map((row) => row.provider).filter(Boolean))].sort(), [rows]);
  const totalCalls = filteredRows.reduce((sum, row) => sum + row.calls, 0);
  const totalCost = filteredRows.reduce((sum, row) => sum + row.costUsd, 0);

  return (
    <Panel title="Feature Breakdown">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by feature, provider, model…"
          className="w-full rounded-md border border-linear-border bg-linear-bg px-3 py-1.5 text-xs text-linear-text outline-none placeholder:text-linear-text-tertiary sm:w-64"
        />
        <select value={provider} onChange={(event) => setProvider(event.target.value)} className="rounded-md border border-linear-border bg-linear-bg px-2 py-1.5 text-xs text-linear-text">
          <option value="">All providers</option>
          {providers.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-linear-border bg-linear-bg px-2 py-1.5 text-xs text-linear-text">
          <option value="">All statuses</option>
          <option value="ok">OK only</option>
          <option value="error">With errors</option>
        </select>
        <span className="ml-auto text-xs text-linear-text-tertiary">{filteredRows.length} rows · {integer(totalCalls)} calls · {money(totalCost, 4)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-linear-border text-xs uppercase tracking-wider text-linear-text-tertiary">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left">Feature</th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-right">Calls</th>
              <th className="px-3 py-2 text-right">Prompt tokens</th>
              <th className="px-3 py-2 text-right">Completion tokens</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-left">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isExpanded = expandedId === row.id;
              return (
                <FragmentRow
                  key={row.id}
                  row={row}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedId(isExpanded ? null : row.id)}
                />
              );
            })}
            {filteredRows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-linear-text-tertiary">No matching feature rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function FragmentRow({ row, isExpanded, onToggle }: { row: FeatureBreakdownRow; isExpanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-linear-border hover:bg-linear-bg-tertiary/60">
        <td className="px-2 py-2 text-center">
          <button onClick={onToggle} className="rounded px-1.5 py-0.5 text-xs text-linear-text-tertiary hover:bg-linear-bg hover:text-linear-text" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.feature}`}>
            {isExpanded ? "▼" : "▶"}
          </button>
        </td>
        <td className="px-3 py-2 font-medium text-linear-text">{row.feature}</td>
        <td className="px-3 py-2"><span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-200">{row.provider}</span></td>
        <td className="px-3 py-2 font-mono text-xs text-linear-text-secondary">{row.model}</td>
        <td className="px-3 py-2 text-right tabular-nums text-linear-text-secondary">{integer(row.calls)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-linear-text-secondary">{integer(row.promptTokens)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-linear-text-secondary">{integer(row.completionTokens)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-linear-text">{money(row.costUsd, 4)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-linear-text-tertiary">{row.lastCallAt ? new Date(row.lastCallAt).toLocaleString() : "—"}</td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-linear-border bg-linear-bg">
          <td colSpan={9} className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-linear-text">Recent datapoints — {row.feature}</div>
              <div className="text-[11px] text-linear-text-tertiary">Showing last {Math.min(15, row.recentCalls.length)} of {integer(row.calls)}</div>
            </div>
            <table className="w-full text-xs">
              <thead className="border-b border-linear-border text-linear-text-tertiary">
                <tr>
                  <th className="px-2 py-1.5 text-left">Time</th>
                  <th className="px-2 py-1.5 text-left">User</th>
                  <th className="px-2 py-1.5 text-right">Prompt</th>
                  <th className="px-2 py-1.5 text-right">Compl</th>
                  <th className="px-2 py-1.5 text-right">Cost</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {row.recentCalls.map((call, index) => (
                  <tr key={call.id || index} className="border-b border-linear-border/60 last:border-0">
                    <td className="whitespace-nowrap px-2 py-1.5 text-linear-text-tertiary">{call.createdAt ? new Date(call.createdAt).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-linear-text-secondary" title={call.userId || ""}>{userLabel(call.userId)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-linear-text-secondary">{integer(call.promptTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-linear-text-secondary">{integer(call.completionTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-linear-text-secondary">{money(call.costUsd, 4)}</td>
                    <td className={`px-2 py-1.5 ${call.status === "error" ? "text-red-400" : "text-emerald-400"}`}>{call.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default function LlmUsageDashboard() {
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    setError(null);
    fetch(`/api/handy-job/llm-usage?timeframe=${timeframe}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        return json as DashboardData;
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      })
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [timeframe]);

  if (error) {
    return <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">Failed to load Handy Job LLM data: {error}</div>;
  }

  return (
    <div className="animate-fadeIn space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-linear-text">Handy Job LLM Usage</h2>
          <p className="mt-1 text-sm text-linear-text-tertiary">Real LlmUsage rows from Handy Job · costs projected from llm_prices.json · latency heatmap omitted</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-linear-border bg-linear-bg-secondary p-1">
          {timeframeOptions.map((option) => (
            <button
              key={option.key}
              onClick={() => setTimeframe(option.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${timeframe === option.key ? "bg-violet-600 text-white" : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-8 text-center text-sm text-linear-text-tertiary">Loading LLM usage…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <KpiCard label="Total Cost" value={money(data.totals.costUsd, 2)} delta={data.deltas.costUsd} accent="bg-violet-500" />
            <KpiCard label="Projected / Month" value={money(data.totals.projectedMonthlyUsd, 2)} accent="bg-amber-500" />
            <KpiCard label="Total Calls" value={compact(data.totals.calls)} delta={data.deltas.calls} accent="bg-blue-500" />
            <KpiCard label="Total Tokens" value={compact(data.totals.totalTokens)} delta={data.deltas.totalTokens} accent="bg-emerald-500" />
            <KpiCard label="Error Rate" value={percent(data.totals.errorRate)} delta={data.deltas.errorRate} lowerIsGood accent="bg-red-500" />
            <KpiCard label="Avg Latency" value={latency(data.totals.avgLatencyMs)} delta={data.deltas.avgLatencyMs} lowerIsGood accent="bg-emerald-500" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Cost by Feature"><HorizontalBars rows={data.byFeature} labelKey="feature" /></Panel>
            <Panel title="Cost & Calls Timeline"><Timeline buckets={data.timeline} /></Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Cost by Provider"><HorizontalBars rows={data.byProvider} labelKey="provider" /></Panel>
            <Panel title="Top Models by Tokens"><HorizontalBars rows={data.byModel} labelKey="model" valueKey="totalTokens" format={compact} /></Panel>
            <Panel title="Token Split"><TokenSplit promptTokens={data.tokenSplit.promptTokens} completionTokens={data.tokenSplit.completionTokens} /></Panel>
          </div>

          <FeatureBreakdown rows={data.featureBreakdown} />

          <div className="grid grid-cols-1 gap-4">
            <Panel title="Recent Calls">
              <div className="max-h-[380px] overflow-auto pr-1">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="sticky top-0 border-b border-linear-border bg-linear-bg-secondary uppercase tracking-wider text-linear-text-tertiary">
                    <tr>
                      <th className="px-2 py-2 text-left">Time</th>
                      <th className="px-2 py-2 text-left">Feature</th>
                      <th className="px-2 py-2 text-left">Model</th>
                      <th className="px-2 py-2 text-right">Cost</th>
                      <th className="px-2 py-2 text-right">Latency</th>
                      <th className="px-2 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row, index) => (
                      <tr key={row.id || index} className="border-b border-linear-border last:border-0 hover:bg-linear-bg-tertiary/60">
                        <td className="whitespace-nowrap px-2 py-2 text-linear-text-tertiary">{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td>
                        <td className="px-2 py-2 text-linear-text-secondary">{row.feature}</td>
                        <td className="px-2 py-2 font-mono text-linear-text-tertiary">{row.provider}/{row.model}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-linear-text-secondary">{money(row.costUsd, 4)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-linear-text-secondary">{latency(row.latencyMs)}</td>
                        <td className={`px-2 py-2 ${row.status === "error" ? "text-red-400" : "text-emerald-400"}`}>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
