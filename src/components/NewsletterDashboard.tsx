"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// kevteaches.ai Dashboard → Newsletter tab. Plans and reviews the Monday
// newsletter that Bernie drafts (see src/lib/newsletter.ts for the data flow).

type Idea = { id: string; title: string; body: string; createdAt: string; usedIn: string | null };
type Topic = { id: string; title: string; notes: string; issueDate: string | null; createdAt: string; usedIn: string | null };
type Issue = {
  issueDate: string;
  subject: string;
  preheader: string;
  skill: string;
  idea: string;
  topic: string;
  emailId: string;
  status: string;
  held: boolean;
  publishDate: string | null;
  sendAt: string;
  words: number;
  filled: number;
  headlines: string[];
  url: string;
  updatedAt: string;
};
type EditRequest = { id: string; issueDate: string; text: string; createdAt: string; status: string; result: string; doneAt: string | null };
type State = {
  ideas: Idea[];
  topics: Topic[];
  picks: Record<string, string>;
  issues: Record<string, Issue>;
  requests: EditRequest[];
  buttondownError?: string;
};
type Stats = {
  subscribers: number;
  issues: { id: string; subject: string; publishDate: string; url: string; recipients: number; opens: number; clicks: number; unsubscriptions: number }[];
  fetchedAt: string;
  error?: string;
};

const card = "rounded-lg border border-linear-border bg-linear-bg-secondary p-4";
const label = "text-[11px] uppercase tracking-[0.18em] text-linear-text-tertiary";
const input = "w-full px-3 py-2 rounded-md border border-linear-border bg-linear-bg-tertiary text-sm text-linear-text";
const button =
  "px-2.5 py-1 rounded-md border border-linear-border bg-linear-bg-secondary hover:bg-linear-bg-tertiary text-xs text-linear-text disabled:opacity-50 disabled:cursor-not-allowed";
const primary = "px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The issue being worked on: today if it's Monday morning, otherwise the coming Monday.
function upcomingMondays(count: number) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isMondayMorning = now.getDay() === 1 && now.getHours() < 12;
  if (!isMondayMorning) first.setDate(first.getDate() + (((8 - first.getDay()) % 7) || 7));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i * 7);
    return ymd(d);
  });
}

function niceDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function statusLine(issue: Issue | undefined) {
  if (!issue) return { text: "Not drafted yet. Bernie drafts it Sunday at 2 pm.", tone: "text-linear-text-tertiary" };
  if (issue.status === "sent") return { text: "Sent", tone: "text-green-400" };
  if (issue.status === "scheduled") {
    const when = issue.publishDate ? new Date(issue.publishDate).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
    return { text: `Scheduled: sends ${when}`, tone: "text-blue-400" };
  }
  if (issue.held) return { text: "On hold: it will not send", tone: "text-amber-400" };
  if (issue.status === "draft") return { text: "Draft: not scheduled", tone: "text-amber-400" };
  return { text: `Buttondown status: ${issue.status}`, tone: "text-red-400" };
}

export default function NewsletterDashboard() {
  const [state, setState] = useState<State | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [editText, setEditText] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaBody, setIdeaBody] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [topicNotes, setTopicNotes] = useState("");
  const [topicDate, setTopicDate] = useState("");
  const [showUsed, setShowUsed] = useState(false);

  const mondays = useMemo(() => upcomingMondays(6), []);
  const next = mondays[0];

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/newsletter", { cache: "no-store" });
      setState(await res.json());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadStats = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/newsletter/stats${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const json = await res.json();
      setStats(res.ok ? json : { subscribers: 0, issues: [], fetchedAt: "", error: json.error });
    } catch (e: any) {
      setStats({ subscribers: 0, issues: [], fetchedAt: "", error: e.message });
    }
  }, []);

  useEffect(() => {
    load();
    loadStats();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load, loadStats]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <div className="text-center py-8 text-linear-text-tertiary">Loading newsletter…</div>;

  const issue = state.issues[next];
  const status = statusLine(issue);
  const pickedId = state.picks[next];
  const openIdeas = state.ideas.filter((i) => !i.usedIn);
  const usedIdeas = state.ideas.filter((i) => i.usedIn);
  const pool = state.topics.filter((t) => !t.issueDate && !t.usedIn);
  const planned = (date: string) => state.topics.find((t) => t.issueDate === date && !t.usedIn) ?? state.topics.find((t) => t.usedIn === date);
  const requests = state.requests.filter((r) => r.issueDate === next).slice(0, 5);
  const canHold = issue?.emailId && issue.status === "scheduled";
  const canRelease = issue?.emailId && issue.status === "draft";

  return (
    <div className="animate-fadeIn space-y-4">
      {(error || state.buttondownError) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error || state.buttondownError}</div>
      )}

      {/* Next issue */}
      <div className={card}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={label}>Next issue · {niceDate(next)}</div>
            <div className="mt-1 text-lg font-semibold text-linear-text">{issue?.subject || "Not drafted yet"}</div>
            {issue?.preheader && <div className="text-sm text-linear-text-secondary">{issue.preheader}</div>}
            <div className={`mt-2 text-sm font-medium ${status.tone}`}>{status.text}</div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {canHold && (
              <button className={button} disabled={busy} onClick={() => act(() => send("/api/newsletter/hold", "POST", { issueDate: next, action: "hold" }))}>
                Hold
              </button>
            )}
            {canRelease && (
              <button className={primary} disabled={busy} onClick={() => act(() => send("/api/newsletter/hold", "POST", { issueDate: next, action: "release" }))}>
                Schedule for Mon 7:00 am
              </button>
            )}
            {issue && (
              <button className={button} onClick={() => { setShowPreview(!showPreview); setPreviewKey(previewKey + 1); }}>
                {showPreview ? "Hide preview" : "Preview"}
              </button>
            )}
            {issue?.emailId && (
              <a className={button} href={`https://buttondown.com/emails/${issue.emailId}`} target="_blank" rel="noreferrer">
                Buttondown ↗
              </a>
            )}
          </div>
        </div>

        {issue && (
          <div className="mt-4 grid gap-4 md:grid-cols-3 text-sm">
            <div>
              <div className={label}>Skill</div>
              <div className="mt-1 text-linear-text">{issue.skill || "–"}</div>
            </div>
            <div>
              <div className={label}>News</div>
              <ul className="mt-1 space-y-1 text-linear-text-secondary">
                {issue.headlines.map((h) => <li key={h}>· {h}</li>)}
              </ul>
            </div>
            <div>
              <div className={label}>Draft</div>
              <div className="mt-1 text-linear-text-secondary">
                {issue.words} words
                {issue.filled > 0 && <span className="text-amber-400"> · {issue.filled} made-up bit{issue.filled > 1 ? "s" : ""} to check</span>}
              </div>
              <div className="text-[11px] text-linear-text-tertiary">Updated {new Date(issue.updatedAt).toLocaleString()}</div>
            </div>
          </div>
        )}

        {showPreview && issue && (
          <iframe
            key={previewKey}
            src={`/api/newsletter/preview?date=${next}`}
            className="mt-4 w-full h-[900px] rounded-md border border-linear-border bg-white"
            title="Newsletter preview"
          />
        )}

        {issue && issue.status !== "sent" && (
          <div className="mt-4">
            <div className={label}>Ask Bernie for changes</div>
            <textarea
              className={`${input} mt-1`}
              rows={2}
              placeholder="e.g. Shorten the intro and swap story 3 for the Copilot news"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                className={primary}
                disabled={busy || !editText.trim()}
                onClick={() => act(async () => { await send("/api/newsletter/requests", "POST", { issueDate: next, text: editText }); setEditText(""); })}
              >
                Send to Bernie
              </button>
              <span className="text-[11px] text-linear-text-tertiary">He picks it up within about 5 minutes and sends the new preview to Telegram.</span>
            </div>
            {requests.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-xs">
                {requests.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <span className={r.status === "done" ? "text-green-400" : r.status === "failed" ? "text-red-400" : "text-amber-400"}>
                      {r.status === "pending" ? "Waiting" : r.status === "done" ? "Done" : "Failed"}
                    </span>
                    <span className="text-linear-text-secondary">{r.text}</span>
                    {r.result && <span className="text-linear-text-tertiary">→ {r.result}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ideas */}
        <div className={`${card} min-w-0`}>
          <div className="mb-3 text-xs font-medium text-linear-text-secondary">Since last issue: your ideas</div>
          <div className="text-sm text-linear-text-secondary mb-3">
            {niceDate(next)}:{" "}
            {pickedId ? (
              <span className="text-linear-text">{state.ideas.find((i) => i.id === pickedId)?.title}</span>
            ) : (
              <span className="text-linear-text-tertiary">nothing picked. Bernie will choose on Sunday.</span>
            )}
          </div>
          <input className={input} placeholder="Idea (e.g. Tried the new ramen place on 14th)" value={ideaTitle} onChange={(e) => setIdeaTitle(e.target.value)} />
          <textarea className={`${input} mt-2`} rows={2} placeholder="Details for Bernie (optional)" value={ideaBody} onChange={(e) => setIdeaBody(e.target.value)} />
          <button
            className={`${primary} mt-2`}
            disabled={busy || !ideaTitle.trim()}
            onClick={() => act(async () => { await send("/api/newsletter/ideas", "POST", { title: ideaTitle, body: ideaBody }); setIdeaTitle(""); setIdeaBody(""); })}
          >
            Add idea
          </button>
          <ul className="mt-4 divide-y divide-linear-border">
            {openIdeas.map((idea) => (
              <li key={idea.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-linear-text">{idea.title}</div>
                  {idea.body && <div className="text-xs text-linear-text-tertiary whitespace-pre-wrap">{idea.body}</div>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {pickedId === idea.id ? (
                    <button className={button} disabled={busy} onClick={() => act(() => send("/api/newsletter/pick", "POST", { issueDate: next, ideaId: null }))}>
                      ✓ Picked
                    </button>
                  ) : (
                    <button className={button} disabled={busy} onClick={() => act(() => send("/api/newsletter/pick", "POST", { issueDate: next, ideaId: idea.id }))}>
                      Use {niceDate(next)}
                    </button>
                  )}
                  <button className={button} disabled={busy} onClick={() => confirm(`Delete "${idea.title}"?`) && act(() => send("/api/newsletter/ideas", "DELETE", { id: idea.id }))}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
            {openIdeas.length === 0 && <li className="py-2 text-xs text-linear-text-tertiary">No unused ideas.</li>}
          </ul>
          {usedIdeas.length > 0 && (
            <button className="mt-2 text-[11px] text-linear-text-tertiary hover:text-linear-text" onClick={() => setShowUsed(!showUsed)}>
              {showUsed ? "Hide" : "Show"} {usedIdeas.length} used idea{usedIdeas.length > 1 ? "s" : ""}
            </button>
          )}
          {showUsed && (
            <ul className="mt-1 space-y-1 text-xs text-linear-text-tertiary">
              {usedIdeas.map((i) => <li key={i.id}>{niceDate(i.usedIn!)} · {i.title}</li>)}
            </ul>
          )}
        </div>

        {/* Topic plan */}
        <div className={`${card} min-w-0`}>
          <div className="mb-3 text-xs font-medium text-linear-text-secondary">Skill topics</div>
          <ul className="divide-y divide-linear-border">
            {mondays.map((date) => {
              const topic = planned(date);
              const drafted = state.issues[date];
              return (
                <li key={date} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="w-24 shrink-0 text-linear-text-secondary">{niceDate(date)}</span>
                  <span className="flex-1 min-w-0 truncate">
                    {drafted?.skill ? (
                      <span className="text-linear-text">{drafted.subject} <span className="text-[11px] text-linear-text-tertiary">(drafted)</span></span>
                    ) : topic ? (
                      <span className="text-linear-text">{topic.title}</span>
                    ) : (
                      <span className="text-linear-text-tertiary">Bernie picks</span>
                    )}
                  </span>
                  {topic && !topic.usedIn && !drafted?.skill && (
                    <button className={button} disabled={busy} onClick={() => act(() => send("/api/newsletter/topics", "PATCH", { id: topic.id, issueDate: null }))}>
                      Unplan
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 space-y-2">
            <input className={input} placeholder="Topic (e.g. Prep for a hard conversation)" value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Notes for Bernie (optional)" value={topicNotes} onChange={(e) => setTopicNotes(e.target.value)} />
            <div className="flex items-center gap-2">
              <select className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text" value={topicDate} onChange={(e) => setTopicDate(e.target.value)}>
                <option value="">No date (add to pool)</option>
                {mondays.map((d) => <option key={d} value={d}>{niceDate(d)}</option>)}
              </select>
              <button
                className={primary}
                disabled={busy || !topicTitle.trim()}
                onClick={() => act(async () => {
                  await send("/api/newsletter/topics", "POST", { title: topicTitle, notes: topicNotes, issueDate: topicDate || null });
                  setTopicTitle(""); setTopicNotes(""); setTopicDate("");
                })}
              >
                Add topic
              </button>
            </div>
          </div>

          <div className={`${label} mt-5`}>Pool ({pool.length})</div>
          <ul className="mt-1 max-h-96 overflow-y-auto pr-1 divide-y divide-linear-border">
            {pool.map((topic) => (
              <li key={topic.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-linear-text">{topic.title}</div>
                  {topic.notes && <div className="text-xs text-linear-text-tertiary">{topic.notes}</div>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <select
                    className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text"
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && act(() => send("/api/newsletter/topics", "PATCH", { id: topic.id, issueDate: e.target.value }))}
                  >
                    <option value="">Plan for…</option>
                    {mondays.map((d) => <option key={d} value={d}>{niceDate(d)}</option>)}
                  </select>
                  <button className={button} disabled={busy} onClick={() => confirm(`Delete "${topic.title}"?`) && act(() => send("/api/newsletter/topics", "DELETE", { id: topic.id }))}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
        <div className="px-4 py-2 border-b border-linear-border flex items-center justify-between">
          <span className="text-xs font-medium text-linear-text-secondary">
            Sent issues{stats && !stats.error ? ` · ${stats.subscribers} subscribers` : ""}
          </span>
          <button className={button} onClick={() => loadStats(true)}>Refresh</button>
        </div>
        {stats?.error && <div className="px-4 py-3 text-sm text-red-400">{stats.error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-linear-text-tertiary">
              <tr>
                <th className="text-left px-4 py-2">Sent</th>
                <th className="text-left px-4 py-2">Subject</th>
                <th className="text-right px-4 py-2">Recipients</th>
                <th className="text-right px-4 py-2">Opened</th>
                <th className="text-right px-4 py-2">Clicked</th>
                <th className="text-right px-4 py-2">Unsubscribed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linear-border">
              {(stats?.issues ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-linear-text-secondary whitespace-nowrap">{s.publishDate ? new Date(s.publishDate).toLocaleDateString() : "–"}</td>
                  <td className="px-4 py-2"><a className="text-linear-text hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.subject}</a></td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{s.recipients}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{pct(s.opens, s.recipients)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{pct(s.clicks, s.recipients)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-linear-text-secondary">{s.unsubscriptions}</td>
                </tr>
              ))}
              {stats && !stats.error && stats.issues.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-3 text-xs text-linear-text-tertiary">Nothing sent yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
