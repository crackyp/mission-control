"use client";

import type { ReactNode } from "react";
import type { CommandResponse, Recommendation } from "@/lib/kb/types";
import { useStatus } from "@/lib/kb/StatusContext";

/* ── SectionCard ────────────────────────────────────────────── */

export function SectionCard({
  title,
  description,
  children,
  accent = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`bg-linear-bg-secondary rounded-lg border border-linear-border p-4 ${accent ? "border-l-2 border-l-linear-accent" : ""}`}>
      <h2 className="text-sm font-medium text-linear-text mb-1">{title}</h2>
      {description && (
        <p className="text-xs text-linear-text-secondary mb-4">{description}</p>
      )}
      {children}
    </div>
  );
}

/* ── CommandResultPanel ─────────────────────────────────────── */

export function CommandResultPanel({
  result,
  maxHeight = "max-h-64",
}: {
  result: Pick<CommandResponse, "returncode" | "output"> | null;
  maxHeight?: string;
}) {
  if (!result) return null;
  return (
    <div className="bg-linear-bg border border-linear-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        {result.returncode === 0 ? (
          <span className="text-green-400 text-sm">Done</span>
        ) : (
          <span className="text-red-400 text-sm">
            Failed (exit {result.returncode})
          </span>
        )}
      </div>
      <pre className={`text-xs text-linear-text-secondary overflow-auto ${maxHeight}`}>
        {result.output}
      </pre>
    </div>
  );
}

/* ── ModelSelect ────────────────────────────────────────────── */

/** Short provider name used for disambiguating prefixes. Must match
 *  `list_models()` / `resolve_provider()` in local_kb/llamacpp.py. */
function providerShort(name: string): string {
  return name === "llamacpp" ? "local" : name.replace("llamacpp_", "");
}

export function ModelSelect({
  value,
  onChange,
  label = "Model",
}: {
  value?: string;
  onChange?: (model: string) => void;
  /** Pass "" to drop the label, as the header strip does. */
  label?: string;
}) {
  const { status, model: globalModel, setModel: setGlobalModel } = useStatus();
  const current = value ?? globalModel;
  const handleChange = onChange ?? setGlobalModel;

  const selectClass = `h-8 w-full ${label ? "mt-1" : ""} px-2 border border-linear-border rounded-md text-xs bg-linear-bg text-linear-text focus:border-linear-accent focus:outline-none`;
  const labelEl = label ? <label className="text-xs text-linear-text-secondary">{label}</label> : null;

  const providers = (status?.providers ?? []).filter((p) => p.models.length > 0);

  if (providers.length > 0) {
    // Mirror list_models(): only a name served by more than one provider gets
    // a `short/model` prefix, so option values stay unambiguous.
    const counts = new Map<string, number>();
    for (const p of providers)
      for (const m of p.models) counts.set(m, (counts.get(m) ?? 0) + 1);

    return (
      <div>
        {labelEl}
        <select value={current} onChange={(e) => handleChange(e.target.value)} className={selectClass}>
          {providers.map((p) => {
            const short = providerShort(p.name);
            const groupLabel = short.charAt(0).toUpperCase() + short.slice(1);
            return (
              <optgroup key={p.name} label={p.running ? groupLabel : `${groupLabel} (offline)`}>
                {p.models.map((m) => {
                  const v = (counts.get(m) ?? 0) > 1 ? `${short}/${m}` : m;
                  return (
                    <option key={v} value={v}>
                      {m}
                    </option>
                  );
                })}
              </optgroup>
            );
          })}
        </select>
      </div>
    );
  }

  // Fallback: flat list (backend without a `providers` payload).
  if (status?.llamacpp.models && status.llamacpp.models.length > 0) {
    return (
      <div>
        {labelEl}
        <select value={current} onChange={(e) => handleChange(e.target.value)} className={selectClass}>
          {status.llamacpp.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      {labelEl}
      <input
        type="text"
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        className={`${selectClass} text-linear-text-tertiary cursor-not-allowed`}
        placeholder="No models available"
        disabled
      />
    </div>
  );
}

/* ── StatusBadge ────────────────────────────────────────────── */

const BADGE_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  ready: { dot: "bg-green-500", text: "text-green-400", label: "Ready" },
  running: { dot: "bg-green-500", text: "text-green-400", label: "Running" },
  stale: { dot: "bg-yellow-500", text: "text-yellow-400", label: "Stale" },
  not_built: { dot: "bg-zinc-500", text: "text-linear-text-tertiary", label: "Not Built" },
  not_running: { dot: "bg-red-500", text: "text-red-400", label: "Not Running" },
  not_installed: { dot: "bg-zinc-500", text: "text-linear-text-secondary", label: "Not installed" },
};

export function StatusBadge({ value }: { value: string }) {
  const style = BADGE_STYLES[value];
  if (!style) return <span className="text-xs text-linear-text-secondary">{value}</span>;
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
      <span className={`text-xs ${style.text}`}>{style.label}</span>
    </div>
  );
}

/* ── RecommendationBar ──────────────────────────────────────── */

export function RecommendationBar({
  recommendations,
  onAction,
  loading,
}: {
  recommendations: Recommendation[];
  onAction?: (rec: Recommendation) => void;
  loading?: boolean;
}) {
  if (!recommendations.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {recommendations.map((rec, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-md transition-colors duration-150 ease-out"
        >
          <span className="text-sm text-amber-300">{rec.message}</span>
          {rec.action && onAction && (
            <button
              onClick={() => onAction(rec)}
              disabled={loading}
              className="px-2 py-1 bg-amber-500/20 text-amber-300 rounded-md text-xs font-medium hover:bg-amber-500/30 disabled:opacity-50 transition-colors duration-150 ease-out"
            >
              Go
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── ActionButton ───────────────────────────────────────────── */

export function ActionButton({
  onClick,
  loading,
  disabled,
  loadingText,
  children,
  variant = "primary",
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  loadingText?: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const base =
    variant === "primary"
      ? "bg-linear-accent text-white hover:bg-linear-accent-hover"
      : "border border-linear-border bg-linear-bg-secondary text-linear-text hover:bg-linear-bg-tertiary";
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${base}`}
    >
      {loading ? (loadingText ?? "Working...") : children}
    </button>
  );
}
