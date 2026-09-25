"use client";

// MediaStudio — the "Media Studio" tab. Image: prompt Qwen-Image-2.1 on the
// Windows PC's ComfyUI through /api/mediastudio/* (a pass-through to
// H:\programz\media-studio\server.py). Video: the existing H3 Studio.

import { useCallback, useEffect, useRef, useState } from "react";
import H3StudioDashboard from "@/components/H3StudioDashboard";

const BASE = "/api/mediastudio";

type Job = {
  id: string;
  status: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  created: number;
  render_started?: number;
  finished?: number;
  images?: string[];
  error?: string;
  note?: string;
  // Live while rendering, from ComfyUI's websocket (see server.py).
  stage?: string;
  step?: number;
  step_total?: number;
  s_per_step?: number;
};
type Guard = { render_guard: boolean; armed?: boolean; arm_expires_in_s?: number; error?: string } | null;
// comfy: the backend's own ComfyUI. held = kept running from the Start button
// instead of stopping after each render; ours = Media Studio started it.
// queued = renders running or waiting on ComfyUI itself, from anyone.
type Comfy = { up: boolean; held: boolean; starting: boolean; ours: boolean; queued?: number; error: string | null };
type Status = { comfy_up: boolean; busy: boolean; queue: string[]; guard: Guard; comfy?: Comfy };
type GalleryItem = {
  name: string;
  mtime: number;
  prompt?: string;
  negative?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  refs?: string[];
  match_ref?: boolean;
};
// A reference image: `ref` is the name stored on the PC, `src` what we display.
type Ref = { ref: string; src: string; label: string };
const MAX_REFS = 4;
const MATCH_REF = -1; // size option: output sized to the first reference

const SIZES: [string, number, number][] = [
  ["Square 1024", 1024, 1024],
  ["Landscape 1344×768", 1344, 768],
  ["Portrait 768×1344", 768, 1344],
  ["Wide 1536×864", 1536, 864],
  ["Square 1536", 1536, 1536],
];

// Same visual vocabulary as H3StudioDashboard.
const LABEL = "mb-1 block text-[10px] uppercase tracking-[0.16em] text-linear-text-tertiary";
const FIELD =
  "h-8 w-full rounded-md border border-linear-border bg-linear-bg px-2.5 text-xs text-linear-text focus:border-linear-accent focus:outline-none";
const AREA =
  "w-full rounded-md border border-linear-border bg-linear-bg px-2.5 py-2 text-xs text-linear-text focus:border-linear-accent focus:outline-none";
const SMALL_BTN =
  "inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const GHOST_BTN = `${SMALL_BTN} border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text`;
const GREEN_BTN = `${SMALL_BTN} border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10`;
const AMBER_BTN = `${SMALL_BTN} border-amber-500/40 text-amber-400 hover:bg-amber-500/10`;
const SECTION = "rounded-lg border border-linear-border bg-linear-bg-secondary";
const SECTION_HEAD = "flex items-center justify-between gap-3 border-b border-linear-border px-4 py-2.5";
const SECTION_TITLE = "text-xs font-medium text-linear-text-secondary";

const fileUrl = (name: string) => `${BASE}/file/${encodeURIComponent(name)}`;
const refUrl = (name: string) => `${BASE}/ref/${encodeURIComponent(name)}`;

const readDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(f);
  });

export default function MediaStudio() {
  const [tab, setTab] = useState<"image" | "video">("image");
  return (
    <div className="space-y-4">
      <div className="inline-flex h-8 items-center gap-0.5 rounded-md border border-linear-border bg-linear-bg p-0.5">
        {([["image", "Image"], ["video", "Video (H3)"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`h-full whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${
              tab === k ? "bg-linear-bg-active text-linear-text" : "text-linear-text-tertiary hover:text-linear-text-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "image" ? <ImageStudio /> : <H3StudioDashboard />}
    </div>
  );
}

function ImageStudio() {
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [size, setSize] = useState(0);
  const [steps, setSteps] = useState(25);
  const [seed, setSeed] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [uploading, setUploading] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  // Lightbox position is derived from the open image's NAME, not stored: the
  // gallery re-polls and new renders are prepended, so a stored index would
  // point at the wrong image as soon as the list shifts.
  const viewingIndex = viewing ? gallery.findIndex((g) => g.name === viewing.name) : -1;
  const stepViewing = (delta: number) => {
    if (viewingIndex < 0 || gallery.length < 2) return;
    const n = gallery.length;
    setViewing(gallery[(viewingIndex + delta + n) % n]); // wrap around both ends
  };
  // Arrow keys navigate the lightbox while it is open (left = previous, right = next).
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") stepViewing(-1);
      else if (e.key === "ArrowRight") stepViewing(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, gallery]);
  const [now, setNow] = useState(Date.now() / 1000);
  const [status, setStatus] = useState<Status | null>(null);
  const [guardBusy, setGuardBusy] = useState(false);
  const [comfyBusy, setComfyBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/status`, { cache: "no-store" });
      setStatus(r.ok ? await r.json() : null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, [loadStatus]);

  const setComfy = async (on: boolean) => {
    setComfyBusy(true);
    try {
      const r = await fetch(`${BASE}/api/comfy`, { method: "POST", body: JSON.stringify({ state: on ? "on" : "off" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || `ComfyUI ${on ? "start" : "stop"} failed (${r.status})`);
    } finally {
      setComfyBusy(false);
      loadStatus();
    }
  };

  const setGuard = async (on: boolean) => {
    setGuardBusy(true);
    try {
      const r = await fetch(`${BASE}/api/render-guard`, { method: "POST", body: JSON.stringify({ state: on ? "on" : "off" }) });
      const j = await r.json().catch(() => ({}));
      // The gate refuses to engage when ComfyUI isn't running, and says why.
      if (!r.ok || (on && !j.render_guard)) setError(j.error || "the gate would not engage the guard");
    } finally {
      setGuardBusy(false);
      loadStatus();
    }
  };

  const loadGallery = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/gallery`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `gallery failed (${r.status})`);
      setGallery(j);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  // Poll every unfinished job; refresh the gallery when one completes.
  const active = jobs.filter((j) => j.status !== "done" && j.status !== "error");
  useEffect(() => {
    if (!active.length) return;
    const t = setInterval(async () => {
      setNow(Date.now() / 1000);
      const updated = await Promise.all(
        active.map((j) => fetch(`${BASE}/api/jobs/${j.id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : j)).catch(() => j))
      );
      setJobs((prev) => prev.map((p) => updated.find((u: Job) => u.id === p.id) || p));
      if (updated.some((u: Job) => u.status === "done")) loadGallery();
    }, 2000);
    return () => clearInterval(t);
  }, [active.map((j) => j.id).join(","), loadGallery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size follows the references: adding the first one defaults to matching it,
  // removing the last one drops back to a fixed size.
  const updateRefs = (next: Ref[]) => {
    if (next.length && !refs.length) setSize(MATCH_REF);
    if (!next.length && size === MATCH_REF) setSize(0);
    setRefs(next);
  };

  const addRefs = async (files: File[]) => {
    setError(null);
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_REFS - refs.length);
    if (!imgs.length) return;
    setUploading((n) => n + imgs.length);
    const added: Ref[] = [];
    for (const f of imgs) {
      try {
        const data = await readDataUrl(f);
        const r = await fetch(`${BASE}/api/upload`, { method: "POST", body: JSON.stringify({ name: f.name, data }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `upload failed (${r.status})`);
        added.push({ ref: j.ref, src: data, label: f.name });
      } catch (e: any) {
        setError(`${f.name}: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added.length) updateRefs([...refs, ...added]);
  };

  const generate = async () => {
    setError(null);
    const matchRef = size === MATCH_REF && refs.length > 0;
    const [, width, height] = SIZES[matchRef ? 0 : Math.max(0, size)];
    try {
      const r = await fetch(`${BASE}/api/generate`, {
        method: "POST",
        body: JSON.stringify({
          prompt,
          negative,
          width,
          height,
          steps,
          seed: seed.trim() === "" ? -1 : Number(seed),
          refs: refs.map((x) => x.ref),
          match_ref: matchRef,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `generate failed (${r.status})`);
      setJobs((prev) => [j, ...prev]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const remove = async (g: GalleryItem) => {
    if (!confirm(`Delete ${g.name}?\n\nIt goes to the PC's Recycle Bin, so it can be restored from there.`)) return;
    try {
      const r = await fetch(`${BASE}/api/delete`, { method: "POST", body: JSON.stringify({ name: g.name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `delete failed (${r.status})`);
      setGallery((prev) => prev.filter((x) => x.name !== g.name));
      setViewing(null);
    } catch (e: any) {
      setError(e.message);
      setViewing(null);
    }
  };

  const reuse = (g: GalleryItem) => {
    setPrompt(g.prompt || "");
    setNegative(g.negative || "");
    const r = (g.refs || []).map((name, i) => ({ ref: name, src: refUrl(name), label: `Ref ${i + 1}` }));
    setRefs(r);
    const i = SIZES.findIndex(([, w, h]) => w === g.width && h === g.height);
    if (g.match_ref && r.length) setSize(MATCH_REF);
    else if (i >= 0) setSize(i);
    else if (!r.length && size === MATCH_REF) setSize(0);
    if (g.steps) setSteps(g.steps);
    setSeed(g.seed != null ? String(g.seed) : "");
    setViewing(null);
  };

  const g = status?.guard;
  const guardTitle = !status
    ? "Media Studio backend unreachable"
    : g == null
    ? "Model gate unreachable"
    : g.render_guard
    ? g.armed
      ? "Guard armed"
      : "Render guard on"
    : "Render guard off";
  const guardDetail = !status
    ? "the PC service on :8190 is not answering"
    : g == null
    ? "nothing on :8080 is holding LLM loads during a render"
    : g.render_guard
    ? g.armed
      ? `LLM requests wait until the render finishes · waiting for ComfyUI, expires in ${Math.max(0, Math.round((g.arm_expires_in_s || 0) / 60))} min`
      : "LLM requests wait until the render finishes"
    : status.comfy_up
    ? "ComfyUI is up but unguarded — an LLM can load mid-render"
    : "engages on its own while ComfyUI runs";
  const c = status?.comfy;
  const comfyTitle = !c
    ? "ComfyUI server"
    : c.starting
    ? "ComfyUI starting…"
    : c.up
    ? c.held
      ? "ComfyUI running · kept on"
      : "ComfyUI running"
    : "ComfyUI stopped";
  const comfyDetail = !c
    ? "status unavailable"
    : c.error
    ? `last start failed: ${c.error}`
    : c.starting
    ? "unloading the LLM and loading ComfyUI — about a minute"
    : c.up
    ? c.held
      ? "stays up between renders until you stop it · the PC's LLM stays unloaded"
      : c.ours
      ? "started for a render; stops when the queue is empty"
      : `started outside Media Studio (run_comfyui.bat or an agent)${c.queued ? ` · ${c.queued} render${c.queued === 1 ? "" : "s"} in its queue` : ""}`
    : "starts for each render and stops after · Start keeps it up";
  const comfyTone = !c ? "bg-red-400" : c.starting ? "bg-violet-400 animate-pulse" : c.up ? "bg-emerald-400" : "bg-linear-text-tertiary";
  // An outside ComfyUI (not ours, not held) can be stopped too, but only after a confirm.
  const comfyExternal = !!c && c.up && !c.ours && !c.held && !c.starting;
  const comfyOn = !!c && (c.held || c.starting || comfyExternal);
  const toggleComfy = () => {
    if (comfyExternal) {
      const lost = c?.queued ? ` Its ${c.queued} running/queued render${c.queued === 1 ? "" : "s"} will be lost.` : "";
      if (!window.confirm(`ComfyUI was started outside Media Studio (run_comfyui.bat or an agent).${lost} Stop it?`)) return;
    }
    setComfy(!comfyOn);
  };
  const guardTone = !status || g == null ? "bg-red-400" : g.render_guard ? "bg-emerald-400" : status.comfy_up ? "bg-amber-400" : "bg-linear-text-tertiary";

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className={`h-2 w-2 flex-none rounded-full ${guardTone}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-linear-text">
              {guardTitle}
              {status?.comfy_up && <span className="ml-2 font-mono text-[10px] uppercase text-violet-400">ComfyUI up</span>}
            </div>
            <div className="truncate text-[11px] text-linear-text-tertiary">{guardDetail}</div>
          </div>
          {g && (
            <button type="button" className={g.render_guard ? AMBER_BTN : GREEN_BTN} disabled={guardBusy} onClick={() => setGuard(!g.render_guard)}>
              {g.render_guard ? "Release" : "Protect"}
            </button>
          )}
        </div>
        {c && (
          <div className="flex items-center gap-3 border-t border-linear-border px-4 py-2.5">
            <span className={`h-2 w-2 flex-none rounded-full ${comfyTone}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-linear-text">{comfyTitle}</div>
              <div className={`truncate text-[11px] ${c.error ? "text-red-400" : "text-linear-text-tertiary"}`}>{comfyDetail}</div>
            </div>
            <button type="button" className={comfyOn ? AMBER_BTN : GREEN_BTN} disabled={comfyBusy} onClick={toggleComfy}>
              {comfyBusy && comfyOn ? "Stopping…" : comfyOn ? "Stop server" : c.up ? "Keep on" : "Start server"}
            </button>
          </div>
        )}
      </div>

      <div className={SECTION}>
        <div className={SECTION_HEAD}>
          <span className={SECTION_TITLE}>Generate image · Qwen-Image-2.1 on ComfyUI (PC)</span>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className={LABEL}>Prompt</label>
            <textarea
              className={AREA}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && prompt.trim() && generate()}
              placeholder={refs.length ? "Describe the edit, or refer to “image 1”, “image 2”…" : "Describe the image…"}
            />
          </div>
          <div>
            <label className={LABEL}>
              Reference images · {refs.length}/{MAX_REFS}
            </label>
            <div className="flex flex-wrap items-start gap-2">
              {refs.map((r, i) => (
                <div key={r.ref} className="group relative w-16 flex-none">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.src} alt={r.label} className="block h-16 w-16 rounded-md border border-linear-border object-cover" />
                  <button
                    type="button"
                    onClick={() => updateRefs(refs.filter((x) => x.ref !== r.ref))}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-linear-border bg-linear-bg-tertiary text-[11px] leading-none text-linear-text-secondary hover:text-linear-text sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    ×
                  </button>
                  <div className="mt-1 text-center font-mono text-[10px] text-linear-text-tertiary">image {i + 1}</div>
                </div>
              ))}
              {refs.length + uploading < MAX_REFS && <RefDrop onFiles={addRefs} busy={uploading > 0} />}
            </div>
          </div>
          <div>
            <label className={LABEL}>Negative prompt</label>
            <input className={FIELD} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="blurry, watermark, text…" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <label className={LABEL}>Size</label>
              <select className={`${FIELD} pr-7`} value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {refs.length > 0 && <option value={MATCH_REF}>Match image 1 (best for edits)</option>}
                {SIZES.map(([label], i) => (
                  <option key={label} value={i}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Steps</label>
              <input className={FIELD} type="number" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
            </div>
            <div>
              <label className={LABEL}>Seed</label>
              <input className={FIELD} value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="random" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className={GREEN_BTN} disabled={!prompt.trim()} onClick={generate}>
              Generate
            </button>
            <span className="text-[11px] text-linear-text-tertiary">
              Unloads the local LLM; agent requests wait under the render guard until the render is done. Ctrl+Enter to submit.
            </span>
          </div>
          {error && <div className="rounded-md border border-red-500/40 px-3 py-2 text-xs text-red-400">{error}</div>}
        </div>
      </div>

      {jobs.length > 0 && (
        <div className={SECTION}>
          <div className={SECTION_HEAD}>
            <span className={SECTION_TITLE}>This session</span>
          </div>
          <ul className="divide-y divide-linear-border">
            {jobs.map((j) => {
              const t0 = j.created;
              const t1 = j.finished ?? now;
              const live = j.status !== "done" && j.status !== "error";
              return (
                <li key={j.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center gap-3">
                  <span
                    className={`w-32 flex-none font-mono text-[10px] uppercase ${
                      j.status === "done" ? "text-emerald-400" : j.status === "error" ? "text-red-400" : "text-violet-400"
                    }`}
                  >
                    {j.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-linear-text-secondary" title={j.error || j.prompt}>
                    {j.error || j.prompt}
                  </span>
                  <span className="flex-none font-mono tabular-nums text-linear-text-tertiary">{Math.max(0, Math.round(t1 - t0))}s</span>
                  </div>
                  {live && <JobProgress j={j} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={SECTION}>
        <div className={SECTION_HEAD}>
          <span className={SECTION_TITLE}>Gallery · {gallery.length}</span>
          <button type="button" className={GHOST_BTN} onClick={loadGallery}>Refresh</button>
        </div>
        {gallery.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-linear-text-tertiary">No images yet.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
            {gallery.map((g) => (
              <button key={g.name} type="button" onClick={() => setViewing(g)} className="group text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(g.name)}
                  alt={g.prompt || g.name}
                  loading="lazy"
                  className="aspect-square w-full rounded-md border border-linear-border object-cover group-hover:border-linear-text-tertiary"
                />
                <div className="mt-1 truncate text-[10px] text-linear-text-tertiary">{g.prompt || g.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setViewing(null)}>
          <div className="relative flex max-h-full w-full max-w-5xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {/* Prev / Next — sit on the image, always visible when >1 image */}
            {gallery.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => stepViewing(-1)}
                  aria-label="Previous image (←)"
                  title="Previous (←)"
                  className="absolute left-2 top-[35%] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white/90 transition-colors hover:bg-black/80 hover:text-white"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => stepViewing(1)}
                  aria-label="Next image (→)"
                  title="Next (→)"
                  className="absolute right-2 top-[35%] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white/90 transition-colors hover:bg-black/80 hover:text-white"
                >
                  ›
                </button>
              </>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(viewing.name)} alt={viewing.prompt || viewing.name} className="max-h-[75vh] w-full rounded-md object-contain" />
            <div className="rounded-md border border-linear-border bg-linear-bg-secondary p-3 text-xs text-linear-text-secondary">
              <div className="mb-2 flex items-center gap-2 text-[10px] text-linear-text-tertiary">
                {viewingIndex >= 0 && (
                  <span className="font-mono">
                    {viewingIndex + 1} / {gallery.length}
                  </span>
                )}
                {gallery.length > 1 && <span>· use ← → keys to move between images</span>}
              </div>
              <p className="whitespace-pre-wrap">{viewing.prompt || "(no prompt recorded)"}</p>
              {viewing.refs && viewing.refs.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {viewing.refs.map((name, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={name} src={refUrl(name)} alt={`image ${i + 1}`} title={`image ${i + 1}`} className="h-12 w-12 rounded border border-linear-border object-cover" />
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-linear-text-tertiary">
                {viewing.match_ref ? <span>sized to image 1</span> : viewing.width && <span>{viewing.width}×{viewing.height}</span>}
                {viewing.steps && <span>{viewing.steps} steps</span>}
                {viewing.seed != null && <span>seed {viewing.seed}</span>}
                <span className="flex-1" />
                {viewing.prompt && <button type="button" className={GHOST_BTN} onClick={() => reuse(viewing)}>Reuse settings</button>}
                <a className={GHOST_BTN} href={fileUrl(viewing.name)} download={viewing.name}>Download</a>
                <button type="button" className={`${SMALL_BTN} border-red-500/40 text-red-400 hover:bg-red-500/10`} onClick={() => remove(viewing)}>
                  Delete
                </button>
                <button type="button" className={GHOST_BTN} onClick={() => setViewing(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sampling steps are the only part of a render with a real denominator. The
// stages around them (LLM unload, ComfyUI start, model load) show as a pulsing
// bar with their name; decode/save fill it in amber, as H3 Studio does.
function JobProgress({ j }: { j: Job }) {
  const rendering = j.status === "rendering";
  const decoding = rendering && (j.stage === "decoding" || j.stage === "saving");
  const sampling = rendering && !decoding && j.step != null && !!j.step_total;
  const pct = decoding ? 100 : sampling ? (100 * j.step!) / j.step_total! : 0;
  const left = sampling && j.s_per_step ? Math.round(j.s_per_step * (j.step_total! - j.step!)) : null;
  const label = !rendering ? j.status : sampling ? `step ${j.step} / ${j.step_total}` : j.stage || "starting…";
  return (
    <div className="mt-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-linear-bg-tertiary">
        {sampling || decoding ? (
          <div
            className={`h-full rounded-full transition-all duration-700 ${decoding ? "bg-amber-400" : "bg-violet-500"}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-full bg-violet-500/30" />
        )}
      </div>
      <div className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-linear-text-tertiary">
        <span>{label}</span>
        <span>
          {j.s_per_step ? `${j.s_per_step.toFixed(1)} s/step` : ""}
          {left != null ? ` · ~${left}s left` : ""}
        </span>
      </div>
    </div>
  );
}

// Click or drag-and-drop target for reference images.
function RefDrop({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragEnter={(e) => { e.preventDefault(); setHot(true); }}
      onDragOver={(e) => { e.preventDefault(); setHot(true); }}
      onDragLeave={(e) => { e.preventDefault(); setHot(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setHot(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex h-16 w-16 flex-none cursor-pointer items-center justify-center rounded-md border border-dashed text-center text-[10px] leading-tight transition-colors ${
        hot
          ? "border-linear-accent bg-linear-accent/10 text-linear-accent"
          : "border-linear-border text-linear-text-tertiary hover:border-linear-text-tertiary hover:text-linear-text-secondary"
      }`}
    >
      {busy ? "Uploading…" : "+ Add image"}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
