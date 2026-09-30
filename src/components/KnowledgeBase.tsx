"use client";

// KnowledgeBase — the "Knowledge Base" tab: the local-kb UI (wiki explorer and
// graph, chat, ingest + compile, quality checks), ported from its standalone
// Next app. The backend — FastAPI, FAISS and the kb/ data — stays on the
// Windows PC (H:\programz\knowledge\GSA-kb); /api/kb/* is a pass-through to it.

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { View } from "@/lib/kb/types";
import { api } from "@/lib/kb/api";
import { StatusProvider, useStatus } from "@/lib/kb/StatusContext";
import { CompileProvider, useCompile } from "@/lib/kb/CompileContext";
import { ChatProvider } from "@/lib/kb/ChatContext";
import { ModelSelect, StatusBadge } from "@/components/kb/shared";
import { ExplorerTab } from "@/components/kb/ExplorerTab";
import { ChatTab } from "@/components/kb/ChatTab";
import { UploadTab } from "@/components/kb/UploadTab";
import { QualityTab } from "@/components/kb/QualityTab";

const VIEWS: [View, string][] = [
  ["explorer", "Explorer"],
  ["chat", "Chat"],
  ["upload", "Upload"],
  ["quality", "Quality"],
];

export default function KnowledgeBase() {
  const [view, setView] = useState<View>("explorer");
  return (
    <StatusProvider>
      <CompileProvider>
        <ChatProvider>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="inline-flex h-8 items-center gap-0.5 rounded-md border border-linear-border bg-linear-bg p-0.5">
                {VIEWS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setView(k)}
                    className={`h-full whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${
                      view === k ? "bg-linear-bg-active text-linear-text" : "text-linear-text-tertiary hover:text-linear-text-secondary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <StatusStrip />
            </div>
            <CompileBanner view={view} onOpen={() => setView("upload")} />
            {view === "explorer" && <ExplorerTab onNavigate={setView} />}
            {view === "chat" && <ChatTab />}
            {view === "upload" && <UploadTab />}
            {view === "quality" && <QualityTab />}
          </div>
        </ChatProvider>
      </CompileProvider>
    </StatusProvider>
  );
}

// What the standalone app's sidebar showed: LLM server + model picker, index
// state and file counts.
function StatusStrip() {
  const { status, offline, refresh, model } = useStatus();
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadedModel = status?.llamacpp.loaded;
  const selectedMatchesLoaded = !!loadedModel && model === loadedModel;

  const handleLoad = async () => {
    if (!model || loadingModel) return;
    setLoadingModel(true);
    setLoadError(null);
    try {
      await api.loadModel(model);
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModel(false);
    }
  };

  if (offline) {
    return (
      <div className="flex w-full min-w-0 items-center gap-2 text-xs lg:w-auto lg:flex-1">
        <span className="h-2 w-2 flex-none rounded-full bg-red-500" />
        <span className="text-red-400">Knowledge Base backend unreachable</span>
        <span className="truncate text-linear-text-tertiary">the PC service on :8765 (scheduled task “kb-server”) is not answering</span>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs lg:w-auto lg:flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-linear-text-tertiary">LLM</span>
        <StatusBadge value={status?.llamacpp.running ? "running" : "not_running"} />
        {status?.llamacpp.running && loadedModel && (
          <span className="max-w-[12rem] truncate text-linear-text-tertiary" title={loadedModel}>
            · {loadedModel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-44">
          <ModelSelect label="" />
        </div>
        {status?.llamacpp.running && (
          <button
            onClick={handleLoad}
            disabled={!model || loadingModel || selectedMatchesLoaded}
            className="h-8 whitespace-nowrap rounded-md border border-linear-border px-2.5 text-xs font-medium text-linear-text-secondary transition-colors hover:bg-linear-bg-tertiary hover:text-linear-text disabled:cursor-not-allowed disabled:opacity-40"
            title={selectedMatchesLoaded ? "Selected model is already loaded" : "Force llama-swap to load the selected model now"}
          >
            {loadingModel ? "Loading…" : selectedMatchesLoaded ? "Loaded" : "Load now"}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-linear-text-tertiary">Index</span>
        <StatusBadge value={status?.faiss ?? "unknown"} />
      </div>
      <div className="flex items-center gap-3 text-linear-text-tertiary">
        <span>Raw <span className="tabular-nums text-linear-text-secondary">{status?.files.raw ?? "—"}</span></span>
        <span>Wiki <span className="tabular-nums text-linear-text-secondary">{status?.files.wiki ?? "—"}</span></span>
        <span>Outputs <span className="tabular-nums text-linear-text-secondary">{status?.files.outputs ?? "—"}</span></span>
      </div>
      <button
        onClick={refresh}
        title="Refresh status"
        aria-label="Refresh status"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-linear-border text-linear-text-secondary transition-colors hover:bg-linear-bg-tertiary hover:text-linear-text"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      {loadError && <span className="w-full break-words text-red-400">{loadError}</span>}
    </div>
  );
}

// A compile keeps running while you browse the other views; the Upload view
// shows its own progress and Stop button.
function CompileBanner({ view, onOpen }: { view: View; onOpen: () => void }) {
  const { compiling, stopCompile } = useCompile();
  if (!compiling || view === "upload") return null;
  return (
    <div className="flex items-center gap-3 rounded-md border border-linear-accent/50 bg-linear-accent/10 px-3 py-2 text-xs">
      <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-linear-accent" />
      <span className="flex-1 text-linear-text">Compile running in the background.</span>
      <button onClick={onOpen} className="h-7 rounded-md border border-linear-border px-2.5 font-medium text-linear-text-secondary transition-colors hover:bg-linear-bg-tertiary hover:text-linear-text">
        Open
      </button>
      <button onClick={stopCompile} className="h-7 rounded-md border border-red-500/40 px-2.5 font-medium text-red-400 transition-colors hover:bg-red-500/10">
        Stop
      </button>
    </div>
  );
}
