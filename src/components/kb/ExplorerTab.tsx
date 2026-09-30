"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "@/lib/kb/api";
import { useStatus } from "@/lib/kb/StatusContext";
import { useFileList, useGraph } from "@/lib/kb/hooks";
import type { FileMeta, TrashItem, View } from "@/lib/kb/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { downloadWikiHtml } from "@/lib/kb/exportHtml";
import { WikiGraph } from "@/components/kb/WikiGraph";
import {
  FileText,
  Trash2,
  RefreshCcw,
  X,
  FolderOpen,
  Network,
  List,
} from "lucide-react";

type Category = "raw" | "wiki" | "outputs";
type WikiView = "graph" | "list";
const CATEGORIES: Category[] = ["wiki", "raw", "outputs"];
const CATEGORY_LABELS: Record<Category, string> = { wiki: "Wiki", raw: "Raw", outputs: "Outputs" };
const CATEGORY_EMPTY_ACTIONS: Record<Category, { action: View; label: string }> = {
  raw: { action: "upload", label: "Open Upload" },
  wiki: { action: "upload", label: "Open Upload" },
  outputs: { action: "chat", label: "Open Chat" },
};
const PREVIEWABLE = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".xml", ".csv", ".html",
  ".py", ".js", ".ts", ".sql", ".log", ".toml", ".ini", ".cfg", ".sh", ".bat",
]);
const TRUNCATION_LIMIT = 100_000;

function isPreviewable(name: string): boolean {
  const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  return PREVIEWABLE.has(ext);
}
function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function formatCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function getTopFolder(rel: string): string | null {
  const normalized = rel.replace(/\\/g, "/");
  const i = normalized.indexOf("/");
  return i >= 0 ? normalized.slice(0, i) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Toast { id: number; message: string; type: "info" | "success" | "error" | "undo"; undoAction?: () => void; undoLabel?: string; }
let toastIdCounter = 0;

function InlineConfirm({ message, confirmLabel, confirmVariant, onConfirm, onCancel }: {
  message: string; confirmLabel: string; confirmVariant?: "danger" | "primary";
  onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}
      className="absolute right-0 top-full mt-1 z-50 bg-linear-bg-secondary border border-linear-border rounded-md shadow-lg p-3 min-w-[220px] transition-colors duration-150 ease-out">
      <div className="text-sm text-linear-text mb-3">{message}</div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">Cancel</button>
        <button onClick={onConfirm}
          className={`px-3 py-1.5 text-xs font-medium rounded-md text-white ${confirmVariant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-linear-accent hover:bg-linear-accent-hover"} transition-colors duration-150 ease-out`}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function TrashDrawer({ open, onClose, onRestore, onEmptyTrash }: {
  open: boolean; onClose: () => void; onRestore: () => void; onEmptyTrash: () => void;
}) {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchTrash = useCallback(async () => {
    setLoading(true); setError(null);
    try { const res = await api.listTrash(); setTrashItems(res.files); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (open) fetchTrash(); }, [open, fetchTrash]);

  const handleRestore = async (item: TrashItem) => {
    try {
      await api.restoreTrash(item.name, item.category);
      setTrashItems(p => p.filter(t => !(t.original_name === item.original_name && t.category === item.category)));
      onRestore();
    } catch (e: unknown) {
      const message = errorMessage(e);
      if (message.includes("ALREADY_EXISTS") || message.includes("409")) {
        setError(`"${item.original_name}" already exists in ${item.category}/ — rename or delete the current one first.`);
      } else { setError(message); }
    }
  };
  const handleEmpty = async () => {
    try { await api.emptyTrash(); setTrashItems([]); setConfirmEmpty(false); onEmptyTrash(); }
    catch (e) { setError(String(e)); }
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="Trash" className="ml-auto w-full max-w-md bg-linear-bg-secondary border-l border-linear-border shadow-xl h-full flex flex-col z-10 transition-colors duration-150 ease-out">
        <div className="flex items-center justify-between px-5 py-4 border-b border-linear-border">
          <h2 className="font-semibold text-linear-text tracking-tight">Trash</h2>
          <button onClick={onClose} className="text-linear-text-tertiary hover:text-linear-text-secondary text-lg leading-none transition-colors duration-150 ease-out" aria-label="Close trash"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <div className="text-sm text-linear-text-tertiary text-center py-8">Loading…</div>}
          {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/40 rounded-md p-3">{error}</div>}
          {!loading && trashItems.length === 0 && <div className="text-sm text-linear-text-tertiary text-center py-8">Trash is empty</div>}
          {trashItems.map((item, idx) => (
            <div key={`${item.category}-${item.original_name}-${idx}`}
              className="flex items-center justify-between p-3 rounded-md border border-linear-border-subtle hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-linear-text truncate">{item.original_name}</div>
                <div className="text-xs text-linear-text-tertiary flex gap-2 mt-0.5">
                  <span className="bg-linear-bg-tertiary px-1.5 py-0.5 rounded-md text-[10px] uppercase">{item.category}</span>
                  <span>{item.trashed_at}</span>
                </div>
              </div>
              <button onClick={() => handleRestore(item)}
                className="ml-3 px-3 py-1.5 text-xs font-medium rounded-md bg-linear-accent text-white hover:bg-linear-accent-hover transition-colors duration-150 ease-out whitespace-nowrap">Restore</button>
            </div>
          ))}
        </div>
        {trashItems.length > 0 && (
          <div className="p-4 border-t border-linear-border">
            {confirmEmpty ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-linear-text-secondary flex-1">Empty all trash?</span>
                <button onClick={() => setConfirmEmpty(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">Cancel</button>
                <button onClick={handleEmpty}
                  className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors duration-150 ease-out">Empty all</button>
              </div>
            ) : (
              <button onClick={() => setConfirmEmpty(true)}
                className="w-full px-3 py-2 text-xs font-medium rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors duration-150 ease-out">
                Empty trash ({trashItems.length} items)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkList({ targets, wikiFiles, onNavigateTo }: {
  targets: string[]; wikiFiles: FileMeta[]; onNavigateTo: (file: FileMeta) => void;
}) {
  return (
    <div className="space-y-1">
      {targets.map((target) => {
        const found = wikiFiles.find((f) => f.name === target);
        return (
          <button key={target} onClick={() => found && onNavigateTo(found)} disabled={!found}
            className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors duration-150 ease-out ${
              found ? "text-linear-accent hover:bg-linear-accent/10 cursor-pointer" : "text-linear-text-tertiary cursor-default"
            }`}
            title={found ? `Open "${found.title || found.name}"` : "Page not found in wiki"}>
            <span className={found ? "" : "opacity-60"}>{found?.title || target}</span>
          </button>
        );
      })}
    </div>
  );
}

function PageLinks({ linksTo, linkedFrom, wikiFiles, onNavigateTo, onClose }: {
  linksTo: string[]; linkedFrom: string[]; wikiFiles: FileMeta[];
  onNavigateTo: (file: FileMeta) => void; onClose: () => void;
}) {
  return (
    <div className="w-56 border-l border-linear-border bg-linear-bg flex flex-col flex-shrink-0 transition-colors duration-150 ease-out">
      <div className="flex items-center justify-between px-3 py-2 border-b border-linear-border">
        <span className="text-[10px] uppercase tracking-wider text-linear-text-secondary font-semibold">Links</span>
        <button onClick={onClose} className="text-linear-text-tertiary hover:text-linear-text-secondary text-xs transition-colors duration-150 ease-out" aria-label="Close links sidebar"><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {linksTo.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-linear-text-tertiary">Links to</div>
            <LinkList targets={linksTo} wikiFiles={wikiFiles} onNavigateTo={onNavigateTo} />
          </div>
        )}
        {linkedFrom.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-linear-text-tertiary">Linked from</div>
            <LinkList targets={linkedFrom} wikiFiles={wikiFiles} onNavigateTo={onNavigateTo} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Outbound + inbound wiki links for a page. */
function linkCount(file: FileMeta): number {
  return (file.links_to?.length ?? 0) + (file.linked_from?.length ?? 0);
}

interface ExplorerTabProps { onNavigate?: (view: View) => void; }

export function ExplorerTab({ onNavigate }: ExplorerTabProps) {
  const { refresh: refreshStatus } = useStatus();

  const [activeTab, setActiveTab] = useState<Category>(() => {
    if (typeof window !== "undefined") {
      try {
        const v = localStorage.getItem("mission-control:kb:explorer-tab");
        if (v && CATEGORIES.includes(v as Category)) return v as Category;
      } catch {}
    }
    return "wiki";
  });
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<string>("");

  // Load sort from localStorage on mount
  const sortLoaded = useRef(false);
  useEffect(() => {
    if (sortLoaded.current) return;
    sortLoaded.current = true;
    try {
      const v = localStorage.getItem("mission-control:kb:explorer-sort-" + activeTab);
      if (v) setSort(v);
    } catch {}
  }, [activeTab]);
  const [selected, setSelected] = useState<FileMeta | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<FileMeta | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wikiFiles, setWikiFiles] = useState<FileMeta[]>([]);
  const [outboundOpen, setOutboundOpen] = useState(false);
  const [folderCollapsed, setFolderCollapsed] = useState<Record<string, boolean>>({});
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  // ── Phase 3: Line-wrap toggle (localStorage) ────────────
  const [wrapCode, setWrapCode] = useState<boolean>(true);
  // Load saved wrap preference after mount to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mission-control:kb:explorer-wrapCode");
      if (saved !== null) setWrapCode(saved !== "false");
    }
  }, []);
  useEffect(() => { localStorage.setItem("mission-control:kb:explorer-wrapCode", String(wrapCode)); }, [wrapCode]);

  // ── Phase 3: Filter chips ────────────────────────────────
  const [filterChip, setFilterChip] = useState<string>("");

  // ── Wiki graph view (default) vs. flat list ───────────────
  const [wikiView, setWikiView] = useState<WikiView>("graph");
  // Load saved preference after mount to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("mission-control:kb:explorer-wikiView") === "list")
      setWikiView("list");
  }, []);
  useEffect(() => { localStorage.setItem("mission-control:kb:explorer-wikiView", wikiView); }, [wikiView]);

  const graphMode = activeTab === "wiki" && wikiView === "graph";

  // ── Resizable split pane ──────────────────────────────────
  const SPLIT_MIN = 240;
  const SPLIT_MAX = 600;
  const SPLIT_DEFAULT = 340;
  // Graph mode's preview overlays the canvas, so its width is measured from the right.
  const PREVIEW_MIN = 320;
  const PREVIEW_MAX = 900;
  const PREVIEW_DEFAULT = 520;
  const [masterWidth, setMasterWidth] = useState<number>(SPLIT_DEFAULT);
  const [previewWidth, setPreviewWidth] = useState<number>(PREVIEW_DEFAULT);
  // Load saved widths after mount to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mission-control:kb:explorer-masterWidth");
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n)) setMasterWidth(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, n)));
      }
      const savedPreview = localStorage.getItem("mission-control:kb:explorer-previewWidth");
      if (savedPreview) {
        const n = parseInt(savedPreview, 10);
        if (!isNaN(n)) setPreviewWidth(Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, n)));
      }
    }
  }, []);
  const dragging = useRef<"master" | "preview" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback((target: "master" | "preview") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = target;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const target = dragging.current;
      if (!target || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (target === "master") {
        setMasterWidth(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, e.clientX - rect.left)));
      } else {
        // Always leave a usable strip of canvas beside the preview.
        const max = Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, rect.width - 260));
        setPreviewWidth(Math.max(PREVIEW_MIN, Math.min(max, rect.right - e.clientX)));
      }
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const wiki = useFileList("wiki");
  const raw = useFileList("raw");
  const outputs = useFileList("outputs");
  const { graph } = useGraph(graphMode);
  const [graphResetKey, setGraphResetKey] = useState(0);
  const lists = useMemo<Record<Category, ReturnType<typeof useFileList>>>(
    () => ({ wiki, raw, outputs }),
    [wiki, raw, outputs],
  );
  const active = lists[activeTab];

  // ── Phase 3: Filter chips (needs `active`) ────────────────
  const extensionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of active.files) {
      const ext = getExt(f.name);
      if (ext) counts[ext] = (counts[ext] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [active.files]);

  // No mount-refresh here: each useFileList already fetches on mount. Refreshing
  // off `lists` re-ran on every render (new object identity) and spun the API.
  useEffect(() => { if (wiki.files.length > 0) setWikiFiles(wiki.files); }, [wiki.files]);

  // ── Phase 3: Save preferences ─────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("mission-control:kb:explorer-tab", activeTab);
  }, [activeTab]);
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("mission-control:kb:explorer-sort-" + activeTab, sort);
  }, [sort, activeTab]);
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("mission-control:kb:explorer-masterWidth", String(masterWidth));
  }, [masterWidth]);
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("mission-control:kb:explorer-previewWidth", String(previewWidth));
  }, [previewWidth]);

  const effectiveSort = sort || (activeTab === "wiki" ? "name_asc" : "newest");

  const filteredFiles = useMemo(() => {
    return active.files
      .filter((f) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return f.name.toLowerCase().includes(q) || (f.title?.toLowerCase().includes(q) ?? false) || f.rel.toLowerCase().includes(q);
      })
      .filter((f) => {
        if (!filterChip) return true;
        return getExt(f.name) === filterChip;
      })
      .sort((a, b) => {
        // Phase 3: Pin INDEX.md to the top in wiki view
        if (activeTab === "wiki") {
          if (a.name === "INDEX.md") return -1;
          if (b.name === "INDEX.md") return 1;
        }
        const aLabel = a.title || a.name;
        const bLabel = b.title || b.name;
        if (effectiveSort === "newest") return b.modified - a.modified;
        if (effectiveSort === "oldest") return a.modified - b.modified;
        if (effectiveSort === "name_asc") return aLabel.localeCompare(bLabel);
        if (effectiveSort === "name_desc") return bLabel.localeCompare(aLabel);
        if (effectiveSort === "largest") return b.size - a.size;
        return 0;
      });
  }, [active.files, filter, filterChip, effectiveSort, activeTab]);

  const groupedFiles = useMemo(() => {
    if (activeTab !== "raw") return null;
    const groups: Record<string, FileMeta[]> = {};
    const ungrouped: FileMeta[] = [];
    for (const f of filteredFiles) {
      const folder = getTopFolder(f.rel);
      if (folder) { if (!groups[folder]) groups[folder] = []; groups[folder].push(f); }
      else { ungrouped.push(f); }
    }
    return { groups, ungrouped };
  }, [filteredFiles, activeTab]);

  const flatList = useMemo(() => {
    if (!groupedFiles) return filteredFiles;
    const result: FileMeta[] = [];
    const addFiles = (files: FileMeta[]) => result.push(...files);
    for (const [name, files] of Object.entries(groupedFiles.groups)) {
      if (!folderCollapsed[name]) addFiles(files);
    }
    if (!folderCollapsed["__ungrouped__"]) addFiles(groupedFiles.ungrouped);
    return result;
  }, [groupedFiles, filteredFiles, folderCollapsed]);

  const addToast = useCallback((message: string, type: Toast["type"] = "info", undoAction?: () => void, undoLabel?: string) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type, undoAction, undoLabel }]);
    if (type !== "undo") setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const handleSelect = useCallback(async (file: FileMeta) => {
    setSelected(file); setContent(null); setOutboundOpen(false);
    if (!isPreviewable(file.name)) return;
    setContentLoading(true);
    try { const res = await api.getFile(activeTab, file.rel); if (res.previewable) setContent(res.content); }
    catch (e) { console.error(e); } finally { setContentLoading(false); }
  }, [activeTab]);

  const handleDelete = useCallback(async (file: FileMeta) => {
    setDeleteConfirm(null);
    try {
      const deleted = await api.deleteFile(activeTab, file.rel);
      active.removeLocal(file.rel);
      if (selected?.rel === file.rel) { setSelected(null); setContent(null); }
      refreshStatus();
      const undoAction = async () => {
        try {
          await api.restoreTrash(deleted.trash_name || file.name, activeTab);
          active.refresh();
          addToast(`"${file.title || file.name}" restored`, "success");
        } catch (e: unknown) {
          const message = errorMessage(e);
          if (message.includes("ALREADY_EXISTS") || message.includes("409")) {
            addToast(`"${file.name}" already exists — rename or delete the current one first`, "error");
          } else { addToast(`Failed to restore: ${message}`, "error"); }
        }
      };
      addToast(`"${file.title || file.name}" moved to trash`, "undo", undoAction, "Undo");
    } catch (e) { console.error(e); addToast(`Failed to delete: ${e}`, "error"); }
  }, [activeTab, selected, active, refreshStatus, addToast]);

  const clearSelection = useCallback(() => {
    setSelected(null); setContent(null); setOutboundOpen(false);
  }, []);

  // Lets the graph know how much of its right edge the preview overlay covers.
  const previewRef = useRef<HTMLDivElement>(null);
  const getInsetRight = useCallback(
    () => (graphMode && selected ? previewRef.current?.offsetWidth ?? 0 : 0),
    [graphMode, selected],
  );

  const handleRefresh = useCallback(() => {
    active.refresh();
    refreshStatus();
    setGraphResetKey((k) => k + 1);
  }, [active, refreshStatus]);
  const switchTab = useCallback((tab: Category) => {
    setActiveTab(tab); setSelected(null); setContent(null); setDeleteConfirm(null);
    // Extension chips are per-tab; carrying one over can filter the new tab to
    // nothing while its chip row is hidden, leaving no way to clear it.
    setFocusIndex(-1); setSort(""); setFilterChip(""); lists[tab].refresh();
  }, [lists]);

  const handleDownload = useCallback(() => {
    if (!selected || !content) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = selected.name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [selected, content]);

  const handleCopyContent = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => addToast("Content copied", "success"), () => addToast("Failed to copy", "error"));
  }, [content, addToast]);

  const handleCopyPath = useCallback(() => {
    if (!selected) return;
    navigator.clipboard.writeText(`${activeTab}/${selected.rel}`).then(
      () => addToast("Path copied", "success"), () => addToast("Failed to copy", "error"));
  }, [selected, activeTab, addToast]);

  const handlePromote = useCallback(async () => {
    if (!selected) return;
    try { await api.promote(selected.name); addToast("Saved to raw/", "success"); }
    catch (e) { addToast(`Failed to promote: ${e}`, "error"); }
  }, [selected, addToast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key !== "Escape" && e.key !== "/") return;
      }
      if (e.key === "/" && tag !== "INPUT") { e.preventDefault(); filterRef.current?.focus(); return; }
      if (e.key === "Escape") {
        if (deleteConfirm) { setDeleteConfirm(null); return; }
        if (trashOpen) { setTrashOpen(false); return; }
        if (filter) { setFilter(""); filterRef.current?.focus(); return; }
        return;
      }
      if (e.key === "1") { switchTab("wiki"); return; }
      if (e.key === "2") { switchTab("raw"); return; }
      if (e.key === "3") { switchTab("outputs"); return; }
      if (graphMode) return; // list-row navigation is meaningless on the canvas
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (flatList.length === 0) return;
        let next = focusIndex;
        if (e.key === "ArrowDown") next = Math.min(focusIndex + 1, flatList.length - 1);
        else next = Math.max(focusIndex - 1, 0);
        setFocusIndex(next);
        const el = listRef.current?.querySelector(`[data-index="${next}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && focusIndex >= 0 && focusIndex < flatList.length) {
        e.preventDefault(); handleSelect(flatList[focusIndex]); return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && focusIndex >= 0 && focusIndex < flatList.length && tag !== "INPUT") {
        e.preventDefault(); setDeleteConfirm(flatList[focusIndex]); return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filter, deleteConfirm, trashOpen, focusIndex, flatList, switchTab, handleSelect, graphMode]);

  useEffect(() => {
    if (focusIndex >= flatList.length) setFocusIndex(flatList.length > 0 ? 0 : -1);
  }, [flatList.length, focusIndex]);

  const renderRow = (file: FileMeta, index: number) => {
    const isSelected = selected?.rel === file.rel;
    const isFocused = focusIndex === index;
    const label = file.title || file.name;
    return (
      <div key={file.rel} data-index={index} role="option" aria-selected={isSelected} tabIndex={-1}
        onClick={() => { handleSelect(file); setFocusIndex(index); }}
        onMouseEnter={() => setFocusIndex(index)}
        className={`flex items-center gap-3 px-3 py-2.5 md:py-2 cursor-pointer transition-colors duration-150 ease-out ${isSelected ? "bg-linear-accent/10" : "hover:bg-linear-bg-tertiary"} ${isFocused && !isSelected ? "bg-linear-bg-tertiary" : ""}`}
        style={{ borderLeft: isSelected ? "3px solid #5e6ad2" : "3px solid transparent" }}>
        <FileText className="w-4 h-4 text-linear-text-tertiary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-linear-text truncate">{label}</span>
            {file.name === "INDEX.md" && <span className="text-[10px] font-semibold uppercase px-1 py-0.5 rounded-md bg-amber-500/15 text-amber-300 flex-shrink-0">index</span>}
            {file.words && <span className="text-[10px] text-linear-text-tertiary flex-shrink-0">{formatCount(file.words)}w</span>}
          </div>
          <div className="text-xs text-linear-text-tertiary truncate">{file.rel} · {file.size_h} · {file.modified_h}</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(file); }}
          className={`text-linear-text-tertiary hover:text-red-400 text-xs px-1.5 py-1 rounded-md hover:bg-red-500/10 flex-shrink-0 transition-colors duration-150 ease-out ${
            isFocused || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
          aria-label={`Delete ${file.name}`} tabIndex={-1}><X className="w-3 h-3" /></button>
      </div>
    );
  };

  const renderFolderGroup = (folderName: string, files: FileMeta[], startIndex: number) => {
    const collapsed = folderCollapsed[folderName] ?? false;
    return (
      <div key={`folder-${folderName}`}>
        <button onClick={() => setFolderCollapsed((prev) => ({ ...prev, [folderName]: !collapsed }))}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">
          <span className="text-xs">{collapsed ? "▸" : "▾"}</span>
          <FolderOpen className="w-3.5 h-3.5" />
          <span>{folderName}</span>
          <span className="text-linear-text-tertiary font-normal normal-case">({files.length})</span>
        </button>
        {!collapsed && files.map((f, i) => renderRow(f, startIndex + i))}
      </div>
    );
  };

  const truncationBanner = content && content.length > TRUNCATION_LIMIT
    ? `Showing first ${formatCount(TRUNCATION_LIMIT)} of ${formatCount(content.length)} characters — Download to view in full.`
    : null;
  const displayContent = content && content.length > TRUNCATION_LIMIT ? content.slice(0, TRUNCATION_LIMIT) : content;

  const resolveLink = useCallback((href: string): FileMeta | null => {
    const targetName = href.split("#")[0].split("/").pop()!;
    return wikiFiles.find((f) => f.name === targetName) || null;
  }, [wikiFiles]);

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-9.5rem)] min-h-[24rem] bg-linear-bg-secondary rounded-lg border border-linear-border overflow-hidden">
        {/* Command bar. Every control is h-8 so the row shares one baseline; groups are
            separated by gap-3, items within a group by gap-2. */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-linear-border bg-linear-bg-secondary flex-shrink-0 md:flex-nowrap md:gap-3">
          <div className="flex items-center gap-0.5 bg-linear-bg-tertiary rounded-md p-0.5">
            {CATEGORIES.map((tab) => (
              <button key={tab} onClick={() => switchTab(tab)}
                className={`h-7 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors duration-150 ease-out ${
                  activeTab === tab ? "bg-linear-bg-active text-linear-text" : "text-linear-text-secondary hover:text-linear-text"
                }`}>
                {CATEGORY_LABELS[tab]}
                <span className="tabular-nums text-linear-text-tertiary">
                  {lists[tab].count}
                </span>
              </button>
            ))}
          </div>
          {activeTab === "wiki" && (
            <div className="flex items-center gap-0.5 bg-linear-bg-tertiary rounded-md p-0.5 flex-shrink-0">
              {([
                { mode: "graph" as const, icon: Network, label: "Graph view" },
                { mode: "list" as const, icon: List, label: "List view" },
              ]).map(({ mode, icon: Icon, label }) => (
                <button key={mode} onClick={() => setWikiView(mode)}
                  aria-pressed={wikiView === mode} title={label} aria-label={label}
                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150 ease-out ${
                    wikiView === mode ? "bg-linear-bg-active text-linear-text" : "text-linear-text-secondary hover:text-linear-text"
                  }`}>
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          )}
          <div className="relative w-full md:w-64 flex-shrink-0">
            <input ref={filterRef} type="text" value={filter}
              onChange={(e) => { setFilter(e.target.value); setFocusIndex(-1); }}
              placeholder="Filter…  (/)"
              className={`w-full h-9 md:h-8 pl-3 ${filter ? "pr-20" : "pr-3"} text-xs border border-linear-border rounded-md focus:border-linear-accent focus:outline-none bg-linear-bg text-linear-text placeholder:text-linear-text-tertiary`} />
            {filter && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-linear-text-tertiary pointer-events-none">{filteredFiles.length} of {active.files.length}</span>}
          </div>
          {/* Phase 3: Filter chips — only when there's more than one extension to pick
              between (the Wiki tab is all .md, so a lone ".md 67" chip filters nothing). */}
          {extensionCounts.length > 1 && !filter && (
            <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
              {filterChip && (
                <button onClick={() => setFilterChip("")}
                  className="h-6 px-2 inline-flex items-center gap-1 text-[10px] font-medium rounded-md bg-linear-bg-active text-linear-text-secondary hover:bg-linear-bg-hover whitespace-nowrap flex-shrink-0 transition-colors duration-150 ease-out">
                  <X className="w-3 h-3" /> clear
                </button>
              )}
              {extensionCounts.slice(0, 6).map(([ext, count]) => (
                <button key={ext} onClick={() => setFilterChip(filterChip === ext ? "" : ext)}
                  className={`h-6 px-2 inline-flex items-center gap-1 text-[10px] font-medium rounded-md whitespace-nowrap flex-shrink-0 transition-colors duration-150 ease-out ${
                    filterChip === ext
                      ? "bg-linear-accent text-white"
                      : "bg-linear-bg-tertiary text-linear-text-secondary hover:bg-linear-bg-hover"
                  }`}>
                  .{ext}
                  <span className={`tabular-nums ${filterChip === ext ? "text-white/70" : "text-linear-text-tertiary"}`}>{count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            {!graphMode && (
              <select value={effectiveSort} onChange={(e) => setSort(e.target.value)}
                className="h-9 md:h-8 pl-2 pr-1 text-xs border border-linear-border rounded-md bg-linear-bg text-linear-text focus:border-linear-accent focus:outline-none">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name_asc">A→Z</option>
                <option value="name_desc">Z→A</option>
                <option value="largest">Largest</option>
              </select>
            )}
            <div className="w-px h-5 bg-linear-border" aria-hidden="true" />
            <button onClick={() => { setTrashOpen(true); setDeleteConfirm(null); }}
              className="h-9 md:h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text transition-colors duration-150 ease-out">
              <Trash2 className="w-3.5 h-3.5" />
              Trash
            </button>
            <button onClick={handleRefresh} title="Refresh" aria-label="Refresh"
              className="h-9 md:h-8 w-9 md:w-8 inline-flex items-center justify-center rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text transition-colors duration-150 ease-out">
              <RefreshCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Master-detail. In graph mode the canvas is full-bleed and the preview overlays it. */}
        <div ref={containerRef} className={`flex flex-1 min-h-0 ${graphMode ? "relative" : ""}`}>
          {graphMode ? (
            <WikiGraph
              files={active.files}
              graph={graph}
              selectedRel={selected?.rel ?? null}
              filter={filter}
              onSelect={handleSelect}
              onDeselect={clearSelection}
              getInsetRight={getInsetRight}
              loadError={active.error}
              resetKey={graphResetKey}
            />
          ) : (
          <>
          {/* Master column */}
          <div
            style={{ width: masterWidth, minWidth: SPLIT_MIN, maxWidth: SPLIT_MAX }}
            className="border-r border-linear-border flex flex-col flex-shrink-0">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-linear-text-tertiary border-b border-linear-border-subtle flex-shrink-0">
              {filteredFiles.length === active.files.length
                ? `${active.files.length} file${active.files.length !== 1 ? "s" : ""}`
                : `${filteredFiles.length} of ${active.files.length} match`}
              <span className="ml-2 text-linear-text-tertiary">· sorted {effectiveSort === "name_asc" ? "A→Z" : effectiveSort === "name_desc" ? "Z→A" : effectiveSort === "newest" ? "newest" : effectiveSort === "oldest" ? "oldest" : "largest"}</span>
            </div>
            <div ref={listRef} role="listbox" aria-label="File list" className="flex-1 overflow-y-auto divide-y divide-linear-border-subtle group">
              {filteredFiles.length === 0 ? (
                <div className="p-6 text-center">
                  <FileText className="w-8 h-8 text-linear-text-tertiary mx-auto mb-2" />
                  {active.error && !filter ? (
                    <>
                      <div className="text-red-400 font-medium mb-1">Couldn&apos;t load {activeTab} files</div>
                      <div className="text-xs text-linear-text-secondary break-words mb-3">{active.error}</div>
                    </>
                  ) : (
                  <div className="text-linear-text-secondary font-medium mb-1">{filter ? "No matching files" : `No ${activeTab} files yet`}</div>
                  )}
                  {!filter && !active.error && <div className="text-xs text-linear-text-tertiary mb-3">
                    {activeTab === "raw" && "Head to the Upload tab to add files, URLs, or PDFs."}
                    {activeTab === "wiki" && "Head to the Upload tab to compile wiki pages from your raw sources."}
                    {activeTab === "outputs" && "Ask a question or run a health check to generate output."}
                  </div>}
                  {active.error && !filter && (
                    <button onClick={handleRefresh}
                      className="px-4 py-2 text-xs font-medium rounded-md bg-linear-accent text-white hover:bg-linear-accent-hover transition-colors duration-150 ease-out">
                      Retry
                    </button>
                  )}
                  {!filter && !active.error && onNavigate && (
                    <button onClick={() => onNavigate(CATEGORY_EMPTY_ACTIONS[activeTab].action)}
                      className="px-4 py-2 text-xs font-medium rounded-md bg-linear-accent text-white hover:bg-linear-accent-hover transition-colors duration-150 ease-out">
                      {CATEGORY_EMPTY_ACTIONS[activeTab].label}
                    </button>
                  )}
                </div>
              ) : activeTab === "raw" && groupedFiles ? (
                <>
                  {Object.entries(groupedFiles.groups).map(([name, files], gi) => {
                    const startIndex = Object.entries(groupedFiles.groups).slice(0, gi).reduce((sum, [, fs]) => sum + (folderCollapsed[name] ? 0 : fs.length), 0);
                    return renderFolderGroup(name, files, startIndex);
                  })}
                  {groupedFiles.ungrouped.length > 0 && renderFolderGroup("Ungrouped", groupedFiles.ungrouped,
                    Object.entries(groupedFiles.groups).reduce((sum, [, fs]) => sum + (folderCollapsed["__ungrouped__"] ? 0 : fs.length), 0))}
                </>
              ) : (
                filteredFiles.map((f, i) => renderRow(f, i))
              )}
            </div>
          </div>

          {/* Draggable divider */}
          <div
            onMouseDown={startDrag("master")}
            className="w-1.5 cursor-col-resize bg-transparent hover:bg-linear-accent/60 active:bg-linear-accent flex-shrink-0 transition-colors duration-150 ease-out relative"
            style={{ marginLeft: "-1px" }}
            title="Drag to resize"
          />
          </>
          )}

          {/* Resize handle for the graph-mode preview overlay */}
          {graphMode && selected && (
            <div
              onMouseDown={startDrag("preview")}
              className="absolute inset-y-0 z-30 w-1.5 cursor-col-resize bg-transparent hover:bg-linear-accent/60 active:bg-linear-accent transition-colors duration-150 ease-out"
              style={{ right: previewWidth - 3 }}
              title="Drag to resize"
            />
          )}

          {/* Detail pane: a column in list mode, an overlay panel in graph mode */}
          <div ref={previewRef}
            style={graphMode ? { width: previewWidth, maxWidth: "80%" } : undefined}
            className={graphMode
            ? `absolute inset-y-0 right-0 flex flex-col bg-linear-bg-secondary border-l border-linear-border shadow-2xl z-20 ${selected ? "" : "hidden"}`
            : "flex-1 flex flex-col min-w-0"}>
            {graphMode && selected && (
              <div className="flex items-center justify-end px-2 py-1 border-b border-linear-border-subtle flex-shrink-0">
                <button onClick={clearSelection} aria-label="Close preview"
                  className="p-1 rounded-md text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {selected ? (
              <>
                <div className="px-5 py-3 border-b border-linear-border flex-shrink-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[180px] flex-1">
                      <h3 className="font-semibold text-linear-text truncate text-base tracking-tight">{selected.title || selected.name}</h3>
                      <div className="text-xs text-linear-text-tertiary mt-0.5 flex gap-3 flex-wrap">
                        <span>{selected.rel}</span>
                        <span>{selected.size_h}</span>
                        <span>{selected.modified_h}</span>
                        {selected.words && <span>{formatCount(selected.words)} words</span>}
                        {selected.links_to && selected.links_to.length > 0 && (
                          <span>{selected.links_to.length} outbound</span>
                        )}
                        {selected.linked_from && selected.linked_from.length > 0 && (
                          <span>{selected.linked_from.length} inbound</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                      {content && (activeTab === "wiki" || selected.name.endsWith(".md")) && (
                        <button onClick={() => downloadWikiHtml(selected.title || selected.name, selected.name, content)}
                          className="text-xs px-2.5 py-1 rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">HTML</button>
                      )}
                      <button onClick={handleDownload}
                        className="text-xs px-2.5 py-1 rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">Download</button>
                      {content && <button onClick={handleCopyContent}
                        className="text-xs px-2.5 py-1 rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">Copy</button>}
                      <button onClick={handleCopyPath}
                        className="text-xs px-2.5 py-1 rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">Path</button>
                      {content && !(activeTab === "wiki" || selected.name.endsWith(".md")) && (
                        <button onClick={() => setWrapCode((w) => !w)}
                          className={`text-xs px-2.5 py-1 rounded-md border transition-colors duration-150 ease-out ${
                            wrapCode
                              ? "bg-linear-accent/10 border-linear-accent/50 text-linear-accent"
                              : "border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary"
                          }`}>
                          {wrapCode ? "Wrap" : "No wrap"}
                        </button>
                      )}
                      {activeTab === "outputs" && (
                        <button onClick={handlePromote}
                          className="text-xs px-2.5 py-1 rounded-md bg-linear-accent text-white hover:bg-linear-accent-hover transition-colors duration-150 ease-out">Promote</button>
                      )}
                      {linkCount(selected) > 0 && (
                        <button onClick={() => setOutboundOpen((o) => !o)}
                          className="text-xs px-2.5 py-1 rounded-md border border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary transition-colors duration-150 ease-out">Links ({linkCount(selected)})</button>
                      )}
                      <div className="relative">
                        <button onClick={() => setDeleteConfirm(selected)}
                          className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/40 hover:bg-red-500/20 transition-colors duration-150 ease-out">Delete</button>
                        {deleteConfirm?.rel === selected.rel && (
                          <InlineConfirm
                            message={`Move "${selected.title || selected.name}" to trash?`}
                            confirmLabel="Delete" confirmVariant="danger"
                            onConfirm={() => handleDelete(selected)}
                            onCancel={() => setDeleteConfirm(null)} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 min-h-0">
                  <div className="flex-1 overflow-y-auto">
                    {contentLoading ? (
                      <div className="p-4 space-y-2">
                        {/* Skeleton loader for content */}
                        <div className="h-3 bg-linear-bg-active rounded-md animate-pulse w-3/4" />
                        <div className="h-3 bg-linear-bg-active rounded-md animate-pulse w-full" />
                        <div className="h-3 bg-linear-bg-active rounded-md animate-pulse w-5/6" />
                        <div className="h-3 bg-linear-bg-active rounded-md animate-pulse w-2/3" />
                        <div className="h-3 bg-linear-bg-active rounded-md animate-pulse w-full" />
                      </div>
                    ) : displayContent ? (
                      <>
                        {truncationBanner && (
                          <div className="mx-4 mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs text-amber-300">
                            {truncationBanner}
                          </div>
                        )}
                        {activeTab === "wiki" || selected.name.endsWith(".md") ? (
                          <div className="kb-markdown p-4 max-h-full overflow-visible">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ href, children, ...props }) => {
                                  const isInternalMd =
                                    !!href &&
                                    !/^[a-z]+:\/\//i.test(href) &&
                                    !href.startsWith("/") &&
                                    !href.startsWith("#") &&
                                    href.split("#")[0].toLowerCase().endsWith(".md");
                                  if (isInternalMd) {
                                    const target = resolveLink(href!);
                                    return (
                                      <a
                                        href={href}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          if (target) {
                                            handleSelect(target);
                                          }
                                        }}
                                        className={target ? "" : "text-linear-text-tertiary cursor-default"}
                                        title={target ? "" : "No matching page in wiki"}
                                      >
                                        {children}
                                      </a>
                                    );
                                  }
                                  return (
                                    <a href={href} target="_blank" rel="noreferrer" {...props}>
                                      {children}
                                    </a>
                                  );
                                },
                              }}
                            >
                              {displayContent}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <pre className={`text-xs text-linear-text-secondary p-4 ${wrapCode ? "whitespace-pre-wrap" : "whitespace-pre overflow-x-auto"}`}>
                            {displayContent}
                          </pre>
                        )}
                      </>
                    ) : selected && isPreviewable(selected.name) ? (
                      <div className="p-4 text-sm text-linear-text-tertiary">Could not load preview</div>
                    ) : selected ? (
                      <div className="p-4 text-sm text-linear-text-tertiary flex items-center gap-3">
                        <FileText className="w-6 h-6 text-linear-text-tertiary flex-shrink-0" />
                        <div>
                          <div className="font-medium text-linear-text-secondary">Binary file — preview not available</div>
                          <div className="text-xs text-linear-text-tertiary mt-1">{selected.size_h} · {selected.name}</div>
                          <button onClick={handleDownload}
                            className="mt-2 px-3 py-1.5 text-xs font-medium rounded-md bg-linear-accent text-white hover:bg-linear-accent-hover transition-colors duration-150 ease-out">
                            Download
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {activeTab === "wiki" && outboundOpen && selected && linkCount(selected) > 0 && (
                    <PageLinks
                      linksTo={selected.links_to ?? []}
                      linkedFrom={selected.linked_from ?? []}
                      wikiFiles={wikiFiles}
                      onNavigateTo={(file) => {
                        if (activeTab !== "wiki") switchTab("wiki");
                        handleSelect(file);
                      }}
                      onClose={() => setOutboundOpen(false)}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <FolderOpen className="w-10 h-10 text-linear-text-tertiary mx-auto mb-2" />
                  <div className="text-sm text-linear-text-tertiary">Select a file to preview</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-md shadow-lg text-sm flex items-center gap-3 min-w-[280px] max-w-md transition-all ${
              toast.type === "error"
                ? "bg-red-600 text-white"
                : toast.type === "success"
                ? "bg-green-600 text-white"
                : "bg-linear-bg-active border border-linear-border text-white"
            }`}
            role={toast.type === "undo" ? "alert" : "status"}
            aria-live={toast.type === "undo" ? "assertive" : "polite"}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.type === "undo" && toast.undoAction && (
              <button
                onClick={() => {
                  toast.undoAction!();
                  dismissToast(toast.id);
                }}
                className="text-xs font-semibold uppercase tracking-wide text-linear-accent hover:text-linear-accent-hover whitespace-nowrap"
              >
                {toast.undoLabel || "Undo"}
              </button>
            )}
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-white/60 hover:text-white text-xs"
              aria-label="Dismiss"
            ><X className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* Trash drawer */}
      <TrashDrawer
        open={trashOpen}
        onClose={() => { setTrashOpen(false); }}
        onRestore={() => { active.refresh(); refreshStatus(); }}
        onEmptyTrash={() => { active.refresh(); refreshStatus(); }}
      />
    </>
  );
}
