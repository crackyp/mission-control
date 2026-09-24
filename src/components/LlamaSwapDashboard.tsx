"use client";

// LlamaSwapDashboard — realtime "inference core" monitor for the Mac's
// llama-swap stack. Data: /api/llamaswap (snapshot exported every minute from
// the Mac to the share; the route only adds staleness metadata).
//
// Visual language: Linear-style dark UI, thin gauges, mono numerals, a single
// status halo. No neon soup, no gimmicks — state is communicated by color
// (off = gray, idle/loaded = blue, busy = violet pulse, wedged = amber,
// stale snapshot = dimmed everything).

import { useCallback, useEffect, useRef, useState } from "react";

type RunningModel = {
  model: string;
  state: string;
  proxy: string;
  ttl: number;
  loadingSinceS?: number;
};

type InflightReq = {
  id: number;
  model: string;
  path: string;
  runningS: number;
};

type GateInfo = {
  locked: boolean;
  renderGuard: boolean;
  queues: Record<string, { waiting: number; max_wait: number; served: number }>;
  modelSwitch: { loads?: number; timeouts?: number; held_now?: number; timeout_s?: number };
  activityCounts: Record<string, number>;
};

type Snapshot = {
  schema?: number;
  generatedAt?: number;
  generatedAtIso?: string;
  host?: string;
  state?: "off" | "idle" | "loaded" | "busy" | "wedged" | "unreachable" | string;
  wedged?: { wedged: boolean; reasons: string[] };
  processes?: { name: string; alive: boolean; pid?: string | null; uptime?: string }[];
  gateway?: { http: boolean; error?: string | null; url: string };
  runningModels?: RunningModel[];
  inflight?: InflightReq[];
  inflightCount?: number;
  inflightModels?: string[];
  recentWindowS?: number;
  recentCount?: number;
  recentErrorReqs?: number;
  throughput?: {
    outputTokensPerSec: number | null;
    recentInputTokens: number;
    recentOutputTokens: number;
  };
  hardware?: {
    gpuName?: string | null;
    gpuUtilPercent?: number | null;
    gpuMemUsedBytes?: number | null;
    gpuMemTotalBytes?: number | null;
    sysMemUsedBytes?: number | null;
    sysMemTotalBytes?: number | null;
    swapUsedBytes?: number | null;
    swapTotalBytes?: number | null;
    load1?: number | null;
  };
  gate?: GateInfo | null;
  gateError?: string | null;
  metricsErrors?: string[];
  reqRing?: { bufferLen: number; approxMax: number };
  // added by the API route
  snapshotAgeMs?: number;
  stale?: boolean;
  error?: string;
  hint?: string;
};

const POLL_MS = 5_000;

const STATE_META: Record<
  string,
  { label: string; color: string; halo: string; dot: string; desc: string }
> = {
  off: {
    label: "OFFLINE",
    color: "text-linear-text-tertiary",
    halo: "border-linear-border bg-linear-bg-secondary",
    dot: "bg-linear-text-tertiary",
    desc: "Stack is not running",
  },
  unreachable: {
    label: "NO SIGNAL",
    color: "text-linear-text-tertiary",
    halo: "border-linear-border bg-linear-bg-secondary",
    dot: "bg-linear-text-tertiary",
    desc: "Snapshot missing or unreadable",
  },
  idle: {
    label: "IDLE",
    color: "text-linear-text-secondary",
    halo: "border-linear-border bg-linear-bg-secondary",
    dot: "bg-blue-400",
    desc: "Gateway up, nothing resident",
  },
  loaded: {
    label: "STANDBY",
    color: "text-blue-400",
    halo: "border-blue-500/30 bg-blue-500/5",
    dot: "bg-blue-400",
    desc: "Model resident, awaiting requests",
  },
  busy: {
    label: "GENERATING",
    color: "text-violet-400",
    halo: "border-violet-500/40 bg-violet-500/5",
    dot: "bg-violet-400",
    desc: "Serving requests right now",
  },
  wedged: {
    label: "WEDGED",
    color: "text-amber-400",
    halo: "border-amber-500/40 bg-amber-500/5",
    dot: "bg-amber-400",
    desc: "Responsive but something is stuck",
  },
};

function stateMeta(state?: string) {
  return STATE_META[state || "unreachable"] || STATE_META.unreachable;
}

function gib(bytes?: number | null, digits = 1) {
  if (bytes === null || bytes === undefined) return "—";
  return `${(bytes / 2 ** 30).toFixed(digits)} GiB`;
}

function agoLabel(ms?: number) {
  if (!ms && ms !== 0) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function durLabel(seconds: number) {
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 90) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function Gauge({
  label,
  value,
  max,
  display,
  tone = "violet",
}: {
  label: string;
  value?: number | null;
  max?: number | null;
  display: string;
  tone?: "violet" | "blue" | "amber";
}) {
  const pct =
    value !== null && value !== undefined && max ? Math.min(100, Math.max(0, (value / max) * 100)) : null;
  const bar =
    tone === "violet" ? "bg-violet-500" : tone === "blue" ? "bg-blue-400" : "bg-amber-400";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">{label}</span>
        <span className="font-mono text-xs tabular-nums text-linear-text">{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-linear-bg-tertiary">
        {pct !== null ? (
          <div className={`h-full rounded-full ${bar} transition-all duration-700`} style={{ width: `${Math.max(2, pct)}%` }} />
        ) : (
          <div className="h-full w-full rounded-full bg-linear-bg-hover" />
        )}
      </div>
    </div>
  );
}

function ProcBadge({ name, alive, uptime }: { name: string; alive: boolean; uptime?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] ${
        alive
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-linear-border bg-linear-bg-tertiary text-linear-text-tertiary"
      }`}
      title={uptime ? `up ${uptime}` : "not running"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${alive ? "bg-emerald-400" : "bg-linear-text-tertiary"}`} />
      {name}
      {alive && uptime ? <span className="text-linear-text-tertiary">· {uptime}</span> : null}
    </span>
  );
}

export default function LlamaSwapDashboard() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // re-render for "x ago" + running timers
  const mounted = useRef(true);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/llamaswap", { cache: "no-store" });
      const json = (await res.json()) as Snapshot;
      if (mounted.current) {
        setData(json);
        setError(json?.error || null);
      }
    } catch (e: any) {
      if (mounted.current) setError(e?.message || String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchSnapshot();
    const poll = setInterval(fetchSnapshot, POLL_MS);
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [fetchSnapshot]);

  const meta = stateMeta(data?.state);
  const stale = !!data?.stale;
  const hw = data?.hardware;
  const gate = data?.gate;
  const proc = (name: string) => data?.processes?.find((p) => p.name === name);
  const running = data?.runningModels || [];
  const inflight = data?.inflight || [];
  const busy = data?.state === "busy";
  const nowTick = tick; // re-render hook

  return (
    <div className="animate-fadeIn space-y-4" data-tick={nowTick}>
      {/* ---------- status banner ---------- */}
      <section
        className={`relative overflow-hidden rounded-lg border p-5 transition-colors duration-500 ${meta.halo} ${
          stale ? "opacity-60" : ""
        }`}
      >
        {busy && !stale && (
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-violet-500/10 blur-3xl"
            aria-hidden
          />
        )}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                {(busy || data?.state === "wedged") && !stale && (
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${meta.dot} opacity-60`} />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
              </span>
              <h2 className={`font-mono text-lg font-semibold tracking-wide ${meta.color}`}>
                {stale && data?.state !== "unreachable" ? `${meta.label} · STALE` : meta.label}
              </h2>
            </div>
            <p className="mt-1 text-xs text-linear-text-secondary">
              {data?.error
                ? `Snapshot unavailable — ${data.error}`
                : stale && data?.snapshotAgeMs
                ? `Last real signal ${agoLabel(data.snapshotAgeMs)} · exporter may be down`
                : meta.desc}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">mac-studio · llama-swap</div>
            <div className="mt-1 font-mono text-[11px] text-linear-text-tertiary">
              {data?.snapshotAgeMs !== undefined ? `snapshot ${agoLabel(data.snapshotAgeMs)}` : ""}
            </div>
          </div>
        </div>

        {/* headline numbers */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-linear-border bg-linear-bg-secondary px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">In-flight</div>
            <div className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${busy ? "text-violet-400" : "text-linear-text"}`}>
              {data?.inflightCount ?? "—"}
            </div>
          </div>
          <div className="rounded-md border border-linear-border bg-linear-bg-secondary px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">Resident</div>
            <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-linear-text">{running.length}</div>
          </div>
          <div className="rounded-md border border-linear-border bg-linear-bg-secondary px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">Out tok/s</div>
            <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-linear-text">
              {data?.throughput?.outputTokensPerSec !== null && data?.throughput?.outputTokensPerSec !== undefined
                ? data.throughput.outputTokensPerSec.toFixed(1)
                : "—"}
            </div>
          </div>
          <div className="rounded-md border border-linear-border bg-linear-bg-secondary px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">5-min errors</div>
            <div className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${(data?.recentErrorReqs || 0) > 0 ? "text-red-400" : "text-linear-text"}`}>
              {data?.recentErrorReqs ?? "—"}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- wedged reasons ---------- */}
      {data?.wedged?.wedged && data.wedged.reasons?.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-xs font-medium text-amber-400">Wedge detected</div>
          <ul className="mt-2 space-y-1">
            {data.wedged.reasons.map((r, i) => (
              <li key={i} className="font-mono text-[11px] text-linear-text-secondary">· {r}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- in-flight requests ---------- */}
      <section className="rounded-lg border border-linear-border bg-linear-bg-secondary">
        <div className="flex items-center justify-between border-b border-linear-border px-4 py-2.5">
          <div className="text-xs font-medium text-linear-text-secondary">Active Requests</div>
          {busy && !stale && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-violet-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
              live
            </span>
          )}
        </div>
        {inflight.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-linear-text-tertiary">
            {stale ? "No signal — snapshot stale" : busy === false && (data?.recentCount || 0) > 0 ? "None right now — last exchange finished recently" : "Nothing generating"}
          </div>
        ) : (
          <div className="divide-y divide-linear-border">
            {inflight.map((req) => (
              <div key={req.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                  <span className="truncate font-mono text-xs text-linear-text">{req.model}</span>
                  <span className="font-mono text-[10px] text-linear-text-tertiary">{req.path}</span>
                </div>
                <span className="font-mono text-xs tabular-nums text-linear-text-secondary">{durLabel(req.runningS)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- resident models ---------- */}
      <section className="rounded-lg border border-linear-border bg-linear-bg-secondary">
        <div className="flex items-center justify-between border-b border-linear-border px-4 py-2.5">
          <div className="text-xs font-medium text-linear-text-secondary">Resident Models</div>
          <span className="font-mono text-[10px] text-linear-text-tertiary">state from /running</span>
        </div>
        {running.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-linear-text-tertiary">No models loaded — first request will cold-start one</div>
        ) : (
          <div className="divide-y divide-linear-border">
            {running.map((m) => {
              const generating = inflight.some((r) => r.model === m.model);
              return (
                <div key={m.model} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${generating ? "animate-pulse bg-violet-400" : m.state === "ready" ? "bg-emerald-400" : "bg-amber-400"}`}
                    />
                    <span className="truncate font-mono text-xs text-linear-text">{m.model}</span>
                    {generating && <span className="font-mono text-[10px] uppercase tracking-wider text-violet-400">generating</span>}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] text-linear-text-tertiary">
                    <span>{m.proxy?.replace("http://127.0.0.1:", "port ") || ""}</span>
                    <span className={`rounded border px-1.5 py-0.5 ${m.state === "ready" ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}>
                      {m.state}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- hardware ---------- */}
      <section className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-xs font-medium text-linear-text-secondary">Hardware</div>
          <div className="font-mono text-[10px] text-linear-text-tertiary">{hw?.gpuName || "—"}{hw?.load1 != null ? ` · load ${hw.load1.toFixed(2)}` : ""}</div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Gauge
            label="GPU util"
            value={hw?.gpuUtilPercent ?? null}
            max={100}
            display={hw?.gpuUtilPercent != null ? `${Math.round(hw.gpuUtilPercent)}%` : "—"}
            tone="violet"
          />
          <Gauge
            label="GPU memory"
            value={hw?.gpuMemUsedBytes ?? null}
            max={hw?.gpuMemTotalBytes ?? null}
            display={`${gib(hw?.gpuMemUsedBytes)} / ${gib(hw?.gpuMemTotalBytes, 0)}`}
            tone="blue"
          />
          <Gauge
            label="System memory"
            value={hw?.sysMemUsedBytes ?? null}
            max={hw?.sysMemTotalBytes ?? null}
            display={`${gib(hw?.sysMemUsedBytes)} / ${gib(hw?.sysMemTotalBytes, 0)}`}
            tone="blue"
          />
          <Gauge
            label="Swap"
            value={hw?.swapUsedBytes ?? null}
            max={hw?.swapTotalBytes ?? null}
            display={gib(hw?.swapUsedBytes, 2)}
            tone="amber"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data?.processes?.map((p) => (
            <ProcBadge key={p.name} name={p.name} alive={p.alive} uptime={p.uptime} />
          ))}
        </div>
      </section>

      {/* ---------- gate / queues ---------- */}
      <section className="rounded-lg border border-linear-border bg-linear-bg-secondary">
        <div className="flex items-center justify-between border-b border-linear-border px-4 py-2.5">
          <div className="text-xs font-medium text-linear-text-secondary">Gate &amp; Queues</div>
          {data?.gateError ? (
            <span className="font-mono text-[10px] text-amber-400">gate unreachable</span>
          ) : (
            <div className="flex gap-2">
              <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${gate?.locked ? "border-amber-500/40 text-amber-400" : "border-linear-border text-linear-text-tertiary"}`}>
                {gate?.locked ? "LOCK HELD" : "unlocked"}
              </span>
              <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${gate?.renderGuard ? "border-amber-500/40 text-amber-400" : "border-linear-border text-linear-text-tertiary"}`}>
                {gate?.renderGuard ? "RENDER GUARD" : "render free"}
              </span>
            </div>
          )}
        </div>
        <div className="grid gap-px bg-linear-border" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {(Object.entries(gate?.queues || {}).length
            ? Object.entries(gate!.queues)
            : []
          ).map(([model, q]) => (
            <div key={model} className="bg-linear-bg-secondary px-4 py-3">
              <div className="truncate font-mono text-[11px] text-linear-text-secondary" title={model}>{model}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className={`font-mono text-lg font-semibold tabular-nums ${q.waiting > 0 ? "text-amber-400" : "text-linear-text"}`}>{q.waiting}</span>
                <span className="text-[10px] text-linear-text-tertiary">queued</span>
              </div>
              <div className="font-mono text-[10px] text-linear-text-tertiary">{q.served} served · max wait {q.max_wait < 1 ? "<1" : Math.round(q.max_wait)}s</div>
            </div>
          ))}
          {Object.keys(gate?.queues || {}).length === 0 && (
            <div className="bg-linear-bg-secondary px-4 py-5 text-center text-xs text-linear-text-tertiary">
              No serializer queues active
            </div>
          )}
        </div>
        {gate?.modelSwitch && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-linear-border px-4 py-2.5 font-mono text-[10px] text-linear-text-tertiary">
            <span>loads {gate.modelSwitch.loads ?? "—"}</span>
            <span>timeouts {gate.modelSwitch.timeouts ?? "—"}</span>
            {gate.modelSwitch.held_now ? <span className="text-amber-400">switch lock held {Math.round(gate.modelSwitch.held_now)}s</span> : null}
          </div>
        )}
      </section>

      {/* ---------- activity counts (lifetime) ---------- */}
      {gate?.activityCounts && Object.keys(gate.activityCounts).length > 0 && (
        <section className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
          <div className="mb-2 text-xs font-medium text-linear-text-secondary">Lifetime Requests by Model</div>
          <div className="flex h-2 overflow-hidden rounded-full bg-linear-bg-tertiary">
            {(() => {
              const entries = Object.entries(gate.activityCounts).sort((a, b) => b[1] - a[1]);
              const total = Math.max(1, entries.reduce((s, [, v]) => s + v, 0));
              const colors = ["bg-violet-500", "bg-blue-400", "bg-emerald-500", "bg-amber-400", "bg-rose-400", "bg-cyan-400", "bg-fuchsia-400", "bg-lime-400"];
              return entries.map(([model, count], i) => (
                <div
                  key={model}
                  className={`${colors[i % colors.length]} h-full opacity-80`}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${model}: ${count}`}
                />
              ));
            })()}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(gate.activityCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([model, count], i) => (
                <span key={model} className="flex items-center gap-1.5 font-mono text-[10px] text-linear-text-tertiary">
                  <span className={`h-1.5 w-1.5 rounded-sm ${["bg-violet-500", "bg-blue-400", "bg-emerald-500", "bg-amber-400", "bg-rose-400", "bg-cyan-400", "bg-fuchsia-400", "bg-lime-400"][i % 8]} opacity-80`} />
                  {model} <span className="tabular-nums text-linear-text-secondary">{count.toLocaleString()}</span>
                </span>
              ))}
          </div>
        </section>
      )}

      {/* ---------- footer diagnostics ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[10px] text-linear-text-tertiary">
        <span>
          poll 15s · window {data?.recentWindowS ? `${Math.round(data.recentWindowS / 60)}m` : "—"} ·
          {" "}{data?.recentCount ?? 0} recent reqs
          {data?.reqRing ? ` · ring buffer ${data.reqRing.bufferLen}/${data.reqRing.approxMax}` : ""}
        </span>
        <span>
          {data?.generatedAtIso ? `exported ${data.generatedAtIso}` : ""}
          {data?.metricsErrors?.length ? ` · ${data.metricsErrors.join("; ")}` : ""}
        </span>
      </div>
      {error && (
        <div className="rounded border border-linear-border bg-linear-bg-tertiary px-3 py-2 font-mono text-[11px] text-linear-text-tertiary">
          {error} {data?.hint ? `— ${data.hint}` : ""}
        </div>
      )}
    </div>
  );
}