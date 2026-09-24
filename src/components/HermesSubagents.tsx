"use client";

// HermesSubagents — Bernie's delegate_task children on the Agents tab.
// Data: /api/subagents/hermes (snapshot of the Mac's state.db, exported every
// 5s to shared/bernie/subagents.json). Cards show what each child is doing
// now; clicking one opens its reasoning / tool-call / result timeline.
// HermesActivityTimeline renders the same timeline for Bernie's own session
// (id "main") inside Bernie's agent modal.

import { useCallback, useEffect, useRef, useState } from "react";

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
  // Bernie's main session ("main") only
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

function useHermesActivity(id: string) {
  const [entry, setEntry] = useState<HermesSubagent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/subagents/hermes?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setEntry(data.subagent);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load activity");
    }
  }, [id]);

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

// Bernie's own session timeline, for the agent detail modal in page.tsx.
export function HermesActivityTimeline({ id }: { id: string }) {
  const { entry, error } = useHermesActivity(id);
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

function SubagentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { entry: subagent, error } = useHermesActivity(id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-4xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col min-w-0">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-linear-border flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-2xl">🧩</span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-linear-text">Hermes subagent</div>
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

export default function HermesSubagents() {
  const [subagents, setSubagents] = useState<HermesSubagent[]>([]);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/subagents/hermes", { cache: "no-store" });
      const data = await res.json();
      setSubagents(Array.isArray(data.subagents) ? data.subagents : []);
      setStale(Boolean(data.stale));
      setError(data.error || null);
    } catch (e: any) {
      setError(e?.message || "Failed to load Hermes subagents");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { load(); setTick((t) => t + 1); }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const running = subagents.filter((s) => s.status === "running").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider">
          Bernie&apos;s Subagents {running > 0 ? `(${running} working)` : ""}
        </h3>
        {(stale || error) && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10" title={error || undefined}>
            {error && !subagents.length ? "Feed offline" : "Feed stale"}
          </span>
        )}
      </div>

      {subagents.length === 0 ? (
        <div className="rounded-lg border border-linear-border bg-linear-bg-secondary px-4 py-3 text-xs text-linear-text-tertiary">
          No Hermes subagents in the last 24 hours.
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
                <span className="text-2xl">🧩</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-linear-text">Bernie subagent</div>
                  <div className="text-xs text-linear-text-tertiary truncate">
                    {sub.parentTitle ? `for “${sub.parentTitle}”` : sub.id}
                  </div>
                  <div className="mt-1"><StatusPill status={sub.status} /></div>
                  {sub.model && <div className="mt-1 text-[10px] text-linear-accent font-mono">{sub.model}</div>}
                </div>
              </div>

              <div className="text-xs text-linear-text-secondary mb-2 line-clamp-2">{sub.goal || "Delegated task"}</div>

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

      {selectedId && <SubagentModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
