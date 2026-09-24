"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  AreaChart,
  Area,
} from "recharts";

// Realtime token-usage dashboard for Hermes / llama-swap.
// Reads the snapshot exported by the Mac's token-usage-export cron
// (shared/bernie/token-usage.json) via /api/agents/tokens, auto-refreshing
// every 15s so it stays live while an agent is running.

type Totals = {
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  billedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  apiCalls: number;
};

type MonthRow = {
  month: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  billedTokens: number;
  cacheReadTokens: number;
};

type DayRow = {
  day: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  billedTokens: number;
  cacheReadTokens: number;
};

type ModelRow = {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  billedTokens: number;
  cacheReadTokens: number;
  lastUsedAt?: string | null;
};

type SessionRow = {
  id: string;
  model: string;
  title: string | null;
  source: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  active: boolean;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  billedTokens: number;
  apiCalls: number;
};

type SwapBucket = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  billedTokens: number;
};

type LlamaSwap = {
  error?: string;
  note?: string;
  coverageStartedAt?: string | null;
  newRequestsThisTick?: number;
  restarts?: number;
  bufferGaps?: number;
  totals?: SwapBucket;
  byModel?: (SwapBucket & { model: string })[];
  byDay?: (SwapBucket & { day: string })[];
  byDayModel?: (SwapBucket & { day: string; model: string })[];
};

type Excluded = { baseUrl: string; sessions: number; billedTokens: number };

// One row per (day, model). Every figure on the panel is recomputed from these
// for the selected range, so a day total alone would not be enough -- the KPI
// cards need the cache/apiCall columns too.
type DayModelRow = {
  day: string;
  model: string;
  sessions?: number;
  requests?: number;
  inputTokens: number;
  outputTokens: number;
  billedTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTokens?: number;
  apiCalls?: number;
};

type PcSnapshot = {
  host?: string;
  generatedAtIso?: string;
  llamaSwap?: LlamaSwap;
  snapshotAgeMs?: number;
  stale?: boolean;
  error?: string;
};

type Live = {
  requests_in_tail_window?: number;
  prompt_tokens?: number;
  generated_tokens?: number;
  last_line?: string;
  note?: string;
};

type Data = {
  generatedAt?: number;
  generatedAtIso?: string;
  host?: string;
  data?: {
    totals?: Totals;
    byMonth?: MonthRow[];
    byDay?: DayRow[];
    byModel?: ModelRow[];
    recentSessions?: SessionRow[];
    ytd?: { inputTokens: number; outputTokens: number; billedTokens: number };
    byDayModel?: DayModelRow[];
    excluded?: Excluded[];
    scope?: { baseUrls?: string[]; note?: string };
  };
  llamaSwap?: LlamaSwap;
  pc?: PcSnapshot;
  live?: Live;
  snapshotAgeMs?: number;
  snapshotAgeIso?: string;
  stale?: boolean;
  error?: string;
};

const RANGES: { key: string; label: string; days: number | null; monthStart?: boolean }[] = [
  { key: "1d", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "month", label: "This month", days: null, monthStart: true },
  { key: "all", label: "All", days: null },
];

// Inclusive start of the range as a local YYYY-MM-DD, matching how the exporters
// bucket days (local time, not UTC). null means "no lower bound".
// monthStart overrides days: the range begins on the 1st of the current month.
function startDayFor(days: number | null, monthStart = false): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (monthStart) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  if (days == null) return null;
  d.setDate(d.getDate() - (days - 1));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function inRange<T extends { day: string }>(rows: T[] | undefined, startDay: string | null): T[] {
  const list = rows || [];
  return startDay ? list.filter((r) => r.day >= startDay) : list;
}

function fmt(n: number | undefined | null): string {
  const v = n || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(v);
}

function int(n: number | undefined | null): string {
  return (n || 0).toLocaleString();
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-linear-text-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-linear-text">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-linear-text-tertiary">{sub}</div>}
    </div>
  );
}

function SwapRow({
  label,
  swap,
  stale,
  startDay,
}: {
  label: string;
  swap?: LlamaSwap;
  stale?: boolean;
  startDay: string | null;
}) {
  if (!swap || swap.error) return null;

  const rows = inRange(swap.byDayModel, startDay);
  const totals = rows.reduce(
    (a, r) => ({
      requests: a.requests + (r.requests || 0),
      billedTokens: a.billedTokens + (r.billedTokens || 0),
      cacheTokens: a.cacheTokens + (r.cacheTokens || 0),
    }),
    { requests: 0, billedTokens: 0, cacheTokens: 0 }
  );

  const models = new Map<string, number>();
  for (const r of rows) models.set(r.model, (models.get(r.model) || 0) + (r.billedTokens || 0));
  const topModels = [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  if (!totals.requests) {
    return (
      <div className="rounded-lg border border-linear-border bg-linear-bg-secondary px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-linear-text-tertiary">{label}</div>
        <div className="mt-1 text-[11px] text-linear-text-tertiary">No requests in this range.</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-linear-text-tertiary">
          {label}
          {stale && <span className="ml-2 text-linear-warning">stale</span>}
        </div>
        <div className="text-[11px] text-linear-text-tertiary">
          since {swap.coverageStartedAt ? swap.coverageStartedAt.slice(0, 16).replace("T", " ") : "\u2014"}
          {swap.restarts ? " · " + swap.restarts + " restarts" : ""}
          {swap.bufferGaps ? " · " + swap.bufferGaps + " buffer gaps" : ""}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm tabular-nums text-linear-text">
        <span>{int(totals.requests)} <span className="text-linear-text-tertiary">requests</span></span>
        <span>{fmt(totals.billedTokens)} <span className="text-linear-text-tertiary">billed</span></span>
        <span>{fmt(totals.cacheTokens)} <span className="text-linear-text-tertiary">cached</span></span>
      </div>
      {topModels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-linear-text-tertiary">
          {topModels.map(([model, billed]) => (
            <span key={model}>{model} · {fmt(billed)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  cron: "bg-sky-500/15 text-sky-400",
  telegram: "bg-violet-500/15 text-violet-400",
  subagent: "bg-amber-500/15 text-amber-400",
  cli: "bg-emerald-500/15 text-emerald-400",
};

// Most titles end in their own start time ("... · Aug 23 14:04"), which is
// already rendered on the line below and is exactly the part the cell's
// truncation cuts off -- leaving rows that look identical. Drop the suffix.
function cleanTitle(t: string): string {
  return t.replace(/\s*·\s*[A-Z][a-z]{2}\s+\d{1,2}\s+\d{1,2}:\d{2}\s*$/, "").trim();
}

// Ids embed their own timestamp; only the trailing hash distinguishes one run
// from another. Every subagent session and nearly every cli one has no title
// and falls back to this, so show the part that actually identifies it.
function shortId(id: string): string {
  const m =
    id.match(/^\d{8}_\d{6}_([0-9a-f]+)$/i) || id.match(/^cron_([0-9a-f]+)_\d{8}_\d{6}$/i);
  return m ? "#" + m[1] : id;
}

function SourceBadge({ source }: { source?: string | null }) {
  const key = (source || "").toLowerCase();
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
        SOURCE_STYLES[key] || "bg-linear-bg-tertiary text-linear-text-tertiary"
      }`}
    >
      {source || "?"}
    </span>
  );
}

const MODEL_COLORS = [
  "#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b", "#22c55e",
  "#ef4444", "#3b82f6", "#a3e635", "#f97316", "#14b8a6",
];

export default function TokenUsageDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeKey, setRangeKey] = useState("7d");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/tokens", { cache: "no-store" });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const j = (await res.json()) as Data;
      if (j.error) throw new Error(j.error);
      setData(j);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 15_000); // live refresh
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  if (loading) {
    return <div className="py-16 text-center text-linear-text-tertiary">Loading token usage…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-linear-warning/40 bg-linear-warning/10 px-4 py-6 text-sm text-linear-text">
        <b>Couldn't load token usage.</b> {error}
        <div className="mt-2 text-xs text-linear-text-tertiary">
          Ensure the token-usage-export cron is running on the Mac and writing to the share.
        </div>
      </div>
    );
  }

  const d = data?.data;
  const totals = d?.totals;
  const live = data?.live;
  const stale = data?.stale;
  const ageSec = data?.snapshotAgeMs != null ? Math.round(data.snapshotAgeMs / 1000) : null;

  // live activity (billed) since last tick — compute delta from generatedAt? No,
  // the exporter reports a tail-window. Show it as a "right now" pulse.
  const activeSessions = (d?.recentSessions || []).filter((s) => s.active);
  const swap = data?.llamaSwap;
  const pc = data?.pc;

  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
  const startDay = startDayFor(range.days, range.monthStart);

  // Everything below is recomputed from the day x model rows for the selected
  // range. Sessions are bucketed by their START day, so a long-running session
  // lands wholly on the day it began.
  const dmRows = inRange(d?.byDayModel, startDay);

  const rangeTotals = dmRows.reduce(
    (a, r) => ({
      sessions: a.sessions + (r.sessions || 0),
      inputTokens: a.inputTokens + (r.inputTokens || 0),
      outputTokens: a.outputTokens + (r.outputTokens || 0),
      billedTokens: a.billedTokens + (r.billedTokens || 0),
      cacheReadTokens: a.cacheReadTokens + (r.cacheReadTokens || 0),
      apiCalls: a.apiCalls + (r.apiCalls || 0),
    }),
    { sessions: 0, inputTokens: 0, outputTokens: 0, billedTokens: 0, cacheReadTokens: 0, apiCalls: 0 }
  );

  const modelAgg = new Map<string, { model: string; billedTokens: number; sessions: number }>();
  for (const r of dmRows) {
    const cur = modelAgg.get(r.model) || { model: r.model, billedTokens: 0, sessions: 0 };
    cur.billedTokens += r.billedTokens || 0;
    cur.sessions += r.sessions || 0;
    modelAgg.set(r.model, cur);
  }
  const byModel = [...modelAgg.values()].sort((a, b) => b.billedTokens - a.billedTokens).slice(0, 10);

  const dayAgg = new Map<string, { day: string; billedTokens: number }>();
  for (const r of dmRows) {
    const cur = dayAgg.get(r.day) || { day: r.day, billedTokens: 0 };
    cur.billedTokens += r.billedTokens || 0;
    dayAgg.set(r.day, cur);
  }
  const byDay = [...dayAgg.values()].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div className="animate-fadeIn space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-linear-text">Hermes / llama-swap Token Usage</h3>
        <div className="flex items-center gap-2 text-[11px]">
          <div className="flex items-center rounded-md border border-linear-border bg-linear-bg-secondary p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  r.key === rangeKey
                    ? "bg-linear-bg-tertiary text-linear-text"
                    : "text-linear-text-tertiary hover:text-linear-text"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${stale ? "bg-linear-warning/20 text-linear-warning" : "bg-emerald-500/15 text-emerald-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-linear-warning" : "bg-emerald-400 animate-pulse"}`} />
            {stale ? "stale" : "live"}
          </span>
          <span className="text-linear-text-tertiary">
            {ageSec != null ? `${ageSec}s ago` : ""}
            {data?.generatedAtIso ? ` · ${data.generatedAtIso.slice(11, 19)}Z` : ""}
          </span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label={`Billed Tokens · ${range.label}`} value={fmt(rangeTotals.billedTokens)} sub={`${int(rangeTotals.inputTokens)} in · ${int(rangeTotals.outputTokens)} out`} />
        <Card label={`Cache-Read · ${range.label}`} value={fmt(rangeTotals.cacheReadTokens)} sub="re-prefill work (free, local)" />
        <Card label={`API Calls · ${range.label}`} value={int(rangeTotals.apiCalls)} sub={`${int(rangeTotals.sessions)} sessions`} />
        <Card label="Live Activity · now" value={`${int(live?.requests_in_tail_window)}`} sub={`${fmt(live?.prompt_tokens)} in · ${fmt(live?.generated_tokens)} out (ds4 tail)`} />
      </div>

      {/* scope note for the Hermes-session KPIs above */}
      <div className="text-[11px] leading-relaxed text-linear-text-tertiary">
        Scoped to the Mac, other servers are excluded.
      </div>

      {/* llama-swap's own request metrics: counts EVERY client, not just Hermes
          (ccr/Claude Code, direct curl, MC's model probes). Accumulated across
          restarts because /api/metrics is a ~1000-entry in-memory ring buffer.
          One row per host -- the Mac and the PC run separate llama-swap servers. */}
      <SwapRow label={"Mac · llama-swap · all clients"} swap={swap} startDay={startDay} />
      <SwapRow
        label={"PC · llama-swap · all clients"}
        swap={pc?.llamaSwap}
        stale={pc?.stale}
        startDay={startDay}
      />

      {/* active sessions */}
      {activeSessions.length > 0 && (
        <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
          <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">
            Active Sessions ({activeSessions.length})
          </div>
          <div className="divide-y divide-linear-border">
            {activeSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-linear-text">
                    {s.title ? cleanTitle(s.title) : shortId(s.id)}
                  </div>
                  <div className="text-[11px] text-linear-text-tertiary">{s.model} · {s.source || "hermes"}</div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-semibold text-linear-text">{fmt(s.billedTokens)}</div>
                  <div className="text-[11px] text-linear-text-tertiary">{s.messageCount} msgs</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* by day (billed) — area chart */}
      <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
        <h4 className="mb-3 text-xs font-medium text-linear-text-secondary">Billed Tokens — {range.label}</h4>
        {byDay.length === 0 ? (
          <div className="py-8 text-center text-sm text-linear-text-tertiary">No data in window.</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={byDay} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="billedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#9ca3af", fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={{ stroke: "#333" }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} tickLine={false} axisLine={false} width={46} />
              <Tooltip
                contentStyle={{ background: "#16161e", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [fmt(v as number) + " tokens", "billed"]}
                labelFormatter={(l) => String(l)}
              />
              <Area type="monotone" dataKey="billedTokens" stroke="#8b5cf6" strokeWidth={2} fill="url(#billedGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* by model — horizontal bars */}
      <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
        <h4 className="mb-3 text-xs font-medium text-linear-text-secondary">Billed Tokens by Model — {range.label}</h4>
        <div className="space-y-2.5">
          {byModel.map((m, i) => {
            const max = Math.max(1, ...byModel.map((x) => x.billedTokens));
            const pct = Math.max(2, Math.round((m.billedTokens / max) * 100));
            return (
              <div key={m.model} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-right text-sm text-linear-text-secondary" title={m.model}>{m.model}</div>
                <div className="h-6 flex-1 overflow-hidden rounded bg-linear-bg-tertiary">
                  <div
                    className="h-full rounded flex items-center justify-end pr-1.5 transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
                  >
                    <span className="text-[10px] font-medium text-white/90 tabular-nums">{fmt(m.billedTokens)}</span>
                  </div>
                </div>
                <div className="w-16 shrink-0 text-right text-[11px] text-linear-text-tertiary tabular-nums">{int(m.sessions)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* recent sessions table */}
      <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
        <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">Recent Sessions</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-linear-border bg-linear-bg-tertiary text-[11px] uppercase tracking-wider text-linear-text-tertiary">
                <th className="text-left px-4 py-2">Session</th>
                <th className="text-left px-4 py-2">Model</th>
                <th className="text-right px-4 py-2">Input</th>
                <th className="text-right px-4 py-2">Output</th>
                <th className="text-right px-4 py-2">Billed</th>
                <th className="text-right px-4 py-2">Msgs</th>
                <th className="text-center px-4 py-2">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linear-border">
              {(d?.recentSessions || []).map((s) => (
                <tr key={s.id} className="hover:bg-linear-bg-tertiary/40">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source={s.source} />
                      <div className="max-w-[200px] truncate text-linear-text" title={s.title || s.id}>
                        {s.title ? (
                          cleanTitle(s.title)
                        ) : (
                          <span className="font-mono text-linear-text-tertiary">{shortId(s.id)}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-linear-text-tertiary">
                      {s.startedAt ? s.startedAt.slice(0, 16).replace("T", " ") : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-linear-text-secondary">{s.model}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{int(s.inputTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{int(s.outputTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-linear-text">{int(s.billedTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{s.messageCount}</td>
                  <td className="px-4 py-2 text-center">
                    {s.active ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">active</span>
                    ) : (
                      <span className="rounded-full bg-linear-bg-tertiary px-2 py-0.5 text-[10px] text-linear-text-tertiary">done</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
