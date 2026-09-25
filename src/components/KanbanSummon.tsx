"use client";

// KanbanSummon — summon Bernie (the default Hermes agent on the Mac) to work
// kanban cards. SummonControls sits in the task modal; SummonPicker is the
// board-level "pick cards" dialog. Both POST /api/tasks/summon, which creates
// one one-shot Hermes cron job that works the cards in order.

import { useEffect, useState } from "react";

type SummonTask = { id: string; title: string; status: "onhold" | "todo" | "inprogress" | "done" };
type ModelOption = { value: string; label: string };

// Only models Hermes can run on the Mac (provider custom:mac): the llama-swap
// catalog plus names Mac jobs already use. The openclaw group is KevBot's.
const HERMES_GROUPS = new Set(["llamaswap", "mac-jobs"]);
// Mirrors MAX_CARDS in /api/tasks/summon: one run working dozens of cards would take hours.
const MAX_CARDS = 10;

function useHermesModels() {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const seen = new Set<string>();
        const list: ModelOption[] = [];
        for (const m of Array.isArray(data?.models) ? data.models : []) {
          if (!HERMES_GROUPS.has(m.group) || !m.value || seen.has(m.value)) continue;
          seen.add(m.value);
          list.push({ value: m.value, label: m.value });
        }
        setModels(list.sort((a, b) => a.value.localeCompare(b.value)));
      })
      .catch(() => setModels([]));
  }, []);
  return models;
}

async function summon(ids: string[], model: string) {
  const res = await fetch("/api/tasks/summon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, model }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `summon failed (${res.status})`);
  return data as { jobId: string; runAt: string; cards: string[] };
}

function ModelSelect({ value, onChange, models }: { value: string; onChange: (v: string) => void; models: ModelOption[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 min-w-0 px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
    >
      <option value="">Bernie&apos;s default model</option>
      {models.map((m) => (
        <option key={m.value} value={m.value}>{m.label}</option>
      ))}
    </select>
  );
}

function resultText(r: { jobId: string; cards: string[] }) {
  return `Bernie summoned for ${r.cards.length} card${r.cards.length === 1 ? "" : "s"} (Hermes job ${r.jobId}) — starts within about a minute; results arrive on Telegram.`;
}

export function SummonControls({ taskId, onSummoned }: { taskId: string; onSummoned: () => void }) {
  const models = useHermesModels();
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div>
      <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Model</label>
      <div className="flex items-center gap-2">
        <ModelSelect value={model} onChange={setModel} models={models} />
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              setMessage({ ok: true, text: resultText(await summon([taskId], model)) });
              onSummoned();
            } catch (e: any) {
              setMessage({ ok: false, text: e.message });
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 text-sm rounded-md bg-linear-accent text-white hover:bg-linear-accent/90 disabled:opacity-60 whitespace-nowrap"
        >
          {busy ? "Summoning…" : "⚡ Summon Bernie"}
        </button>
      </div>
      {message && (
        <div className={`mt-1.5 text-xs ${message.ok ? "text-linear-success" : "text-red-400"}`}>{message.text}</div>
      )}
    </div>
  );
}

export function SummonPicker({ tasks, onClose, onSummoned }: { tasks: SummonTask[]; onClose: () => void; onSummoned: () => void }) {
  const models = useHermesModels();
  const [model, setModel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "onhold");
  // Select all keeps board order; anything already ticked keeps its place first.
  const allSelected = open.length > 0 && open.every((t) => selected.includes(t.id));
  const overLimit = selected.length > MAX_CARDS;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
          <div className="text-sm font-medium text-linear-text">Summon Bernie</div>
          <button onClick={onClose} className="text-linear-text-tertiary hover:text-linear-text text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-linear-text-tertiary">
              Pick the cards to work. Bernie takes them in the order you tick them, in one run.
            </div>
            {open.length > 0 && (
              <button
                onClick={() =>
                  setSelected(allSelected ? [] : [...selected, ...open.map((t) => t.id).filter((id) => !selected.includes(id))])
                }
                className="text-xs text-linear-accent hover:underline whitespace-nowrap"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            )}
          </div>
          <div className="space-y-1">
            {open.length === 0 && <div className="text-sm text-linear-text-tertiary">No open cards.</div>}
            {open.map((t) => {
              const order = selected.indexOf(t.id);
              return (
                <label key={t.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-linear-bg-tertiary cursor-pointer">
                  <input type="checkbox" checked={order >= 0} onChange={() => toggle(t.id)} />
                  <span className="w-4 text-[10px] font-mono text-linear-accent">{order >= 0 ? order + 1 : ""}</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-linear-text">{t.title}</span>
                  <span className="text-[10px] text-linear-text-tertiary whitespace-nowrap">
                    {t.status === "inprogress" ? "In Progress" : "To Do"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-linear-border space-y-2">
          <div className="flex items-center gap-2">
            <ModelSelect value={model} onChange={setModel} models={models} />
            <button
              disabled={busy || selected.length === 0 || overLimit}
              onClick={async () => {
                setBusy(true);
                setMessage(null);
                try {
                  setMessage({ ok: true, text: resultText(await summon(selected, model)) });
                  setSelected([]);
                  onSummoned();
                } catch (e: any) {
                  setMessage({ ok: false, text: e.message });
                } finally {
                  setBusy(false);
                }
              }}
              className="px-3 py-2 text-sm rounded-md bg-linear-accent text-white hover:bg-linear-accent/90 disabled:opacity-60 whitespace-nowrap"
            >
              {busy ? "Summoning…" : `⚡ Summon${selected.length ? ` (${selected.length})` : ""}`}
            </button>
          </div>
          {overLimit && (
            <div className="text-xs text-amber-400">
              {selected.length} cards selected — one run takes at most {MAX_CARDS}. Untick some, or summon in batches.
            </div>
          )}
          {message && <div className={`text-xs ${message.ok ? "text-linear-success" : "text-red-400"}`}>{message.text}</div>}
        </div>
      </div>
    </div>
  );
}
