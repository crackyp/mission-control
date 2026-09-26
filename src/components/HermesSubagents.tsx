"use client";

// HermesSubagents — a Hermes agent's delegate_task children on the Agents tab
// (Bernie on the Mac; Edward and Lucy on the PC, via the `agent` prop).
// Data: /api/subagents/hermes?agent=<id> (snapshot of the host's state.db,
// exported every 5s to shared/<id>/subagents.json). Cards show what each child
// is doing now; clicking one opens its reasoning / tool-call / result timeline.
// HermesActivityTimeline renders the same timeline for the agent's own session
// (id "main") inside its agent modal.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { HERMES_AGENT_NAMES } from "@/lib/hermes-agents";

type SubagentEvent = {
  ts: number | null;
  kind: "user" | "reasoning" | "text" | "call" | "result";
  tool?: string;
  callId?: string;
  summary?: string | null;
  args?: string | null;
  text?: string | null;
};

type HermesSubagent = {
  id: string;
  // "subagent" = delegate_task child; "kanban" = Hermes cron run working the
  // board (overnight drain or Summon). Absent on the agent's own "main" entry.
  kind?: "subagent" | "kanban";
  parentSessionId: string | null;
  parentTitle: string | null;
  parentSource: string | null;
  model: string | null;
  status: "running" | "stalled" | "done" | "idle";
  endReason: string | null;
  startedAt: number | null;
  endedAt: number | null;
  lastActivityAt: number | null;
  goal: string | null;
  now: string | null;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  eventsTotal: number;
  recent?: SubagentEvent[];
  // The agent's own session ("main") only
  title?: string | null;
  source?: string | null;
  turnStartedAt?: number | null;
  events?: SubagentEvent[];
};

const LIST_POLL_MS = 5000;
const DETAIL_POLL_MS = 3000;

const STATUS_STYLE: Record<HermesSubagent["status"], { dot: string; label: string }> = {
  running: { dot: "#22c55e", label: "Working" },
  stalled: { dot: "#f59e0b", label: "Stalled" },
  done: { dot: "#6b7280", label: "Done" },
  idle: { dot: "#6b7280", label: "Idle" },
};

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function StatusPill({ status }: { status: HermesSubagent["status"] }) {
  const style = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-linear-border bg-linear-bg text-[10px] text-linear-text-tertiary">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${status === "running" ? "animate-pulse" : ""}`}
        style={{ backgroundColor: style.dot }}
      />
      {style.label}
    </span>
  );
}

function EventRow({ event, defaultOpen }: { event: SubagentEvent; defaultOpen: boolean }) {
  const time = event.ts ? new Date(event.ts).toLocaleTimeString() : "";
  if (event.kind === "user") {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-emerald-300">
          <span>🗣️ You</span>
          <span className="text-[10px] text-linear-text-tertiary">{time}</span>
        </div>
        <div className="mt-2 text-xs text-linear-text whitespace-pre-wrap break-words">{event.text}</div>
      </div>
    );
  }
  if (event.kind === "reasoning") {
    return (
      <details open={defaultOpen} className="group rounded border border-linear-border bg-linear-bg px-3 py-2">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] text-violet-300">
          <span>💭 Reasoning</span>
          <span className="text-[10px] text-linear-text-tertiary">{time}</span>
        </summary>
        <div className="mt-2 text-xs text-linear-text-secondary whitespace-pre-wrap break-words italic">{event.text}</div>
      </details>
    );
  }
  if (event.kind === "text") {
    return (
      <div className="rounded border border-linear-border bg-linear-bg px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-linear-text">
          <span>💬 Response</span>
          <span className="text-[10px] text-linear-text-tertiary">{time}</span>
        </div>
        <div className="mt-2 text-xs text-linear-text whitespace-pre-wrap break-words">{event.text}</div>
      </div>
    );
  }
  if (event.kind === "call") {
    return (
      <details className="rounded border border-sky-500/30 bg-sky-500/5 px-3 py-2">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 min-w-0">
          <span className="text-[11px] text-sky-300 min-w-0 truncate">
            🔧 <span className="font-mono">{event.tool}</span>
            {event.summary && <span className="ml-2 font-mono text-linear-text-secondary">{event.summary}</span>}
          </span>
          <span className="text-[10px] text-linear-text-tertiary whitespace-nowrap">{time}</span>
        </summary>
        {event.args && (
          <pre className="mt-2 text-[11px] text-linear-text-secondary font-mono whitespace-pre-wrap break-all">{event.args}</pre>
        )}
      </details>
    );
  }
  return (
    <details className="rounded border border-linear-border bg-linear-bg-tertiary px-3 py-2">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] text-linear-text-tertiary">
        <span>
          ↳ <span className="font-mono">{event.tool}</span> result
          {event.text ? ` · ${event.text.length.toLocaleString()} chars` : ""}
        </span>
        <span className="text-[10px]">{time}</span>
      </summary>
      <pre className="mt-2 text-[11px] text-linear-text-secondary font-mono whitespace-pre-wrap break-all">{event.text}</pre>
    </details>
  );
}

function useHermesActivity(id: string, agent: string) {
  const [entry, setEntry] = useState<HermesSubagent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/subagents/hermes?agent=${encodeURIComponent(agent)}&id=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setEntry(data.subagent);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load activity");
    }
  }, [id, agent]);

  useEffect(() => {
    load();
    const timer = setInterval(load, DETAIL_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return { entry, error };
}

function TimelineBody({ entry, error, className }: { entry: HermesSubagent | null; error: string | null; className: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Follow the tail while the agent is working, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entry?.events?.length, entry?.id]);

  const events = entry?.events || [];
  const hidden = entry ? entry.eventsTotal - events.length : 0;

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className={`overflow-y-auto space-y-2 min-w-0 ${className}`}
    >
      {error && <div className="text-xs text-red-400">{error}</div>}
      {entry?.goal && (
        <div className="rounded border border-linear-border bg-linear-bg px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-linear-text-tertiary mb-1">
            Task{entry.parentTitle ? ` · from “${entry.parentTitle}”` : ""}
          </div>
          <div className="text-xs text-linear-text whitespace-pre-wrap break-words">{entry.goal}</div>
        </div>
      )}
      {hidden > 0 && (
        <div className="text-[10px] text-linear-text-tertiary text-center">{hidden} earlier steps not shown</div>
      )}
      {events.map((event, idx) => (
        <EventRow
          key={`${idx}-${event.kind}-${event.ts}`}
          event={event}
          defaultOpen={event.kind === "reasoning" && idx >= events.length - 3}
        />
      ))}
      {entry?.now && (
        <div className="flex items-center gap-2 text-xs text-linear-success">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-linear-success animate-pulse" />
          {entry.now}
        </div>
      )}
      {entry && events.length === 0 && !entry.now && (
        <div className="text-xs text-linear-text-tertiary">No steps recorded.</div>
      )}
    </div>
  );
}

// A Hermes agent's own session timeline, for the agent detail modal in page.tsx.
export function HermesActivityTimeline({ id, agent = "bernie" }: { id: string; agent?: string }) {
  const { entry, error } = useHermesActivity(id, agent);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <div className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Activity</div>
        {entry && (
          <div className="text-[10px] text-linear-text-tertiary truncate">
            {entry.title ? `“${entry.title}” · ` : ""}{entry.source}
            {entry.status === "running" && entry.turnStartedAt
              ? ` · turn running ${formatElapsed(Date.now() - entry.turnStartedAt)}`
              : entry.lastActivityAt ? ` · last active ${new Date(entry.lastActivityAt).toLocaleTimeString()}` : ""}
          </div>
        )}
      </div>
      <TimelineBody
        entry={entry}
        error={error}
        className="max-h-[50vh] rounded-lg border border-linear-border bg-linear-bg-tertiary p-2"
      />
    </div>
  );
}

function SubagentModal({ id, agent, onClose }: { id: string; agent: string; onClose: () => void }) {
  const { entry: subagent, error } = useHermesActivity(id, agent);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-4xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col min-w-0">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-linear-border flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-2xl">{subagent?.kind === "kanban" ? "📋" : "🧩"}</span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-linear-text">
                {subagent?.kind === "kanban" ? subagent.title || "Kanban run" : "Hermes subagent"}
              </div>
              <div className="text-[10px] text-linear-text-tertiary font-mono">{id}</div>
              {subagent && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-linear-text-tertiary">
                  <StatusPill status={subagent.status} />
                  {subagent.model && <span className="text-linear-accent font-mono">{subagent.model}</span>}
                  <span>{subagent.toolCallCount} tool calls</span>
                  <span>{formatTokens(subagent.inputTokens)} in / {formatTokens(subagent.outputTokens)} out</span>
                  {subagent.startedAt && (
                    <span>
                      {formatElapsed((subagent.endedAt || Date.now()) - subagent.startedAt)}
                      {subagent.endReason ? ` · ${subagent.endReason}` : ""}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-linear-text-tertiary hover:text-linear-text text-lg leading-none">×</button>
        </div>
        <TimelineBody entry={subagent} error={error} className="p-4 flex-1" />
      </div>
    </div>
  );
}

// hideWhenEmpty: render nothing when the agent has no runs in the window, so
// agents that rarely delegate don't add a permanent empty panel.
export default function HermesSubagents({ agent = "bernie", hideWhenEmpty = false }: { agent?: string; hideWhenEmpty?: boolean }) {
  const name = HERMES_AGENT_NAMES[agent] || agent;
  const [subagents, setSubagents] = useState<HermesSubagent[]>([]);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/subagents/hermes?agent=${encodeURIComponent(agent)}`, { cache: "no-store" });
      const data = await res.json();
      setSubagents(Array.isArray(data.subagents) ? data.subagents : []);
      setStale(Boolean(data.stale));
      setError(data.error || null);
    } catch (e: any) {
      setError(e?.message || "Failed to load Hermes subagents");
    }
  }, [agent]);

  useEffect(() => {
    load();
    const timer = setInterval(() => { load(); setTick((t) => t + 1); }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const running = subagents.filter((s) => s.status === "running").length;

  if (hideWhenEmpty && subagents.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider">
          {name}&apos;s Subagents &amp; Kanban Runs {running > 0 ? `(${running} working)` : ""}
        </h3>
        {(stale || error) && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10" title={error || undefined}>
            {error && !subagents.length ? "Feed offline" : "Feed stale"}
          </span>
        )}
      </div>

      {subagents.length === 0 ? (
        <div className="rounded-lg border border-linear-border bg-linear-bg-secondary px-4 py-3 text-xs text-linear-text-tertiary">
          No Hermes subagents or kanban runs in the last 24 hours.
        </div>
      ) : (
        <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 overflow-hidden ${stale ? "opacity-60" : ""}`}>
          {subagents.map((sub) => (
            <div
              key={sub.id}
              onClick={() => setSelectedId(sub.id)}
              className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4 hover:border-linear-accent/50 cursor-pointer transition-colors overflow-hidden min-w-0"
              style={{ borderLeftWidth: 3, borderLeftColor: sub.status === "running" ? "#0ea5e9" : "#7aa2ff" }}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{sub.kind === "kanban" ? "📋" : "🧩"}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-linear-text">
                    {sub.kind === "kanban" ? "Kanban run" : `${name} subagent`}
                  </div>
                  <div className="text-xs text-linear-text-tertiary truncate">
                    {sub.kind === "kanban"
                      ? sub.title || sub.id
                      : sub.parentTitle ? `for “${sub.parentTitle}”` : sub.id}
                  </div>
                  <div className="mt-1"><StatusPill status={sub.status} /></div>
                  {sub.model && <div className="mt-1 text-[10px] text-linear-accent font-mono">{sub.model}</div>}
                </div>
              </div>

              <div className="text-xs text-linear-text-secondary mb-2 line-clamp-2">{sub.goal || (sub.kind === "kanban" ? "Working the kanban board" : "Delegated task")}</div>

              {(sub.now || (sub.recent && sub.recent.length > 0)) && (
                <div className="mb-2 px-2 py-1.5 rounded border border-linear-border bg-linear-bg">
                  {sub.now && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-linear-text line-clamp-1 font-mono">{sub.now}</div>
                      {sub.lastActivityAt && (
                        <div className="text-[10px] text-linear-text-tertiary whitespace-nowrap">
                          {formatElapsed(Date.now() - sub.lastActivityAt)}
                        </div>
                      )}
                    </div>
                  )}
                  {sub.recent && sub.recent.length > 0 && (
                    <div className={`${sub.now ? "mt-1 " : ""}flex flex-wrap gap-1`}>
                      {sub.recent.map((e, idx) => (
                        <span key={`${sub.id}-${idx}`} className="text-[9px] px-1.5 py-0.5 rounded border border-linear-border text-linear-text-tertiary bg-linear-bg-secondary">
                          {e.kind === "call" ? e.tool : e.kind === "result" ? `${e.tool} ✓` : e.kind === "reasoning" ? "thinking" : "reply"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-linear-text-tertiary">
                <span>{sub.toolCallCount} tool calls</span>
                <span>
                  {sub.startedAt
                    ? sub.status === "running"
                      ? `Running ${formatElapsed(Date.now() - sub.startedAt)}`
                      : `Started ${new Date(sub.startedAt).toLocaleTimeString()}`
                    : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && <SubagentModal id={selectedId} agent={agent} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

type TokenCounts = { inputTokens: number; cacheReadTokens: number; outputTokens: number; apiCalls: number };

type HermesTokenSession = {
  id: string;
  title: string | null;
  source: string | null;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  lastActivityAt: number | null;
  working: boolean;
  total: TokenCounts;
  byModel: (TokenCounts & { model: string; task: string })[];
  subagents: TokenCounts & { count: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A Hermes agent's Token Usage section (agent modal). Replaces the generic
// table for Hermes agents: session rows only ever held the active session, and
// Hermes' session totals omit aux work (vision, memory review, titles,
// compression) and subagents — the exporter folds all of that in per session.
export function HermesTokenUsage({ agent = "bernie" }: { agent?: string }) {
  const [sessions, setSessions] = useState<HermesTokenSession[]>([]);
  const [stale, setStale] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/subagents/hermes?agent=${encodeURIComponent(agent)}&view=tokens`, { cache: "no-store" });
        const data = await res.json();
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
        setStale(Boolean(data.stale));
      } catch {
        setStale(true);
      }
    };
    load();
    const timer = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [agent]);

  if (sessions.length === 0) return null;

  const day = sessions.filter((s) => (s.lastActivityAt || 0) > Date.now() - DAY_MS);
  const sum = (key: keyof TokenCounts) => day.reduce((acc, s) => acc + s.total[key], 0);
  const stats = [
    { label: "Sessions (24h)", value: String(day.length) },
    { label: "New input", value: formatTokens(sum("inputTokens")) },
    { label: "Cached input", value: formatTokens(sum("cacheReadTokens")) },
    { label: "Output", value: formatTokens(sum("outputTokens")) },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Token Usage (Recent Sessions)</div>
        {stale && <span className="text-[10px] text-amber-400">feed stale</span>}
      </div>
      <div className={`rounded-lg border border-linear-border bg-linear-bg overflow-hidden ${stale ? "opacity-60" : ""}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-linear-border bg-linear-bg-tertiary">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="text-[10px] text-linear-text-tertiary uppercase">{stat.label}</div>
              <div className="text-lg font-medium text-linear-text">{stat.value}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-linear-border">
                <th className="text-left px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Session</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Last active</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">New in</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Cached</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Output</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Calls</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const open = expanded === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : s.id)}
                      className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer"
                    >
                      <td className="px-4 py-2 text-sm text-linear-text max-w-[260px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-linear-text-tertiary text-[10px]">{open ? "▾" : "▸"}</span>
                          <span className="truncate">{s.title || s.id}</span>
                          {s.working && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-linear-success/15 text-linear-success whitespace-nowrap">Working</span>
                          )}
                        </div>
                        <div className="text-[10px] text-linear-text-tertiary pl-4">
                          {s.source}{s.model ? ` · ${s.model}` : ""}
                          {s.subagents.count > 0 ? ` · ${s.subagents.count} subagent${s.subagents.count === 1 ? "" : "s"}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-sm text-linear-text-secondary whitespace-nowrap">
                        {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-sm text-linear-text text-right">{formatTokens(s.total.inputTokens)}</td>
                      <td className="px-4 py-2 text-sm text-linear-text-tertiary text-right">{formatTokens(s.total.cacheReadTokens)}</td>
                      <td className="px-4 py-2 text-sm text-linear-text text-right">{formatTokens(s.total.outputTokens)}</td>
                      <td className="px-4 py-2 text-sm text-linear-text-secondary text-right">{s.total.apiCalls}</td>
                    </tr>
                    {open &&
                      [...s.byModel.map((u) => ({ ...u, label: `${u.model} · ${u.task}` })),
                       ...(s.subagents.count > 0 ? [{ ...s.subagents, label: `subagents (${s.subagents.count})` }] : [])].map((u) => (
                        <tr key={`${s.id}-${u.label}`} className="border-b border-linear-border bg-linear-bg-tertiary">
                          <td className="px-4 py-1.5 pl-9 text-[11px] text-linear-text-secondary font-mono" colSpan={2}>{u.label}</td>
                          <td className="px-4 py-1.5 text-[11px] text-linear-text-secondary text-right">{formatTokens(u.inputTokens)}</td>
                          <td className="px-4 py-1.5 text-[11px] text-linear-text-tertiary text-right">{formatTokens(u.cacheReadTokens)}</td>
                          <td className="px-4 py-1.5 text-[11px] text-linear-text-secondary text-right">{formatTokens(u.outputTokens)}</td>
                          <td className="px-4 py-1.5 text-[11px] text-linear-text-tertiary text-right">{u.apiCalls}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-linear-border text-[10px] text-linear-text-tertiary">
          Per session: every model call Hermes made for it, including vision, memory review, titles and its subagents.
          New in = uncached prompt tokens; Cached = prompt tokens served from the KV cache.
        </div>
      </div>
    </div>
  );
}
