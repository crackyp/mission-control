"use client";

// VideoUpscale — Media Studio › Video › Upscale. SeedVR2 7B on the Windows
// PC's ComfyUI through /api/mediastudio/* (H:\programz\media-studio\server.py).
// The PC cuts the source into frame-exact chunks (32 GB of RAM can't hold a
// long video's upscaled frames at once), upscales each chunk, and stitches
// them back together with the original audio. Sources are uploaded raw, or
// copied PC-side from H3 Studio's outputs on the Mac.

import { useCallback, useEffect, useRef, useState } from "react";

const BASE = "/api/mediastudio";

type Source = {
  video: string; // stored name on the PC
  src_name: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  audio: boolean;
  preview: string; // what the <video> plays locally
};
type UpJob = {
  id: string;
  status: string;
  src_name: string;
  src_w: number;
  src_h: number;
  out_w: number;
  out_h: number;
  frames: number;
  duration: number;
  resolution: number;
  created: number;
  render_started?: number;
  finished?: number;
  chunk?: number;
  chunks?: number;
  stage?: string | null;
  step?: number | null;
  step_total?: number | null;
  output?: string;
  error?: string;
  note?: string;
};
type Upscaled = {
  name: string;
  mtime: number;
  size: number;
  src_name?: string;
  src_w?: number;
  src_h?: number;
  out_w?: number;
  out_h?: number;
  fps?: number;
  frames?: number;
  duration?: number;
  seconds?: number;
};
type H3Output = { name: string; mtime: number; meta?: { width?: number; height?: number; duration?: number } };

// SeedVR2's "resolution" is the target SHORT side.
const TARGETS: [number, string][] = [
  [720, "720p"],
  [1080, "1080p"],
  [1440, "1440p"],
  [2160, "4K"],
];
const VIDEO_TYPES = ".mp4,.mov,.mkv,.webm,.m4v,video/mp4,video/quicktime,video/x-matroska,video/webm";

// Same visual vocabulary as MediaStudio / H3StudioDashboard.
const LABEL = "mb-1 block text-[10px] uppercase tracking-[0.16em] text-linear-text-tertiary";
const FIELD =
  "h-8 w-full rounded-md border border-linear-border bg-linear-bg px-2.5 text-xs text-linear-text focus:border-linear-accent focus:outline-none";
const SMALL_BTN =
  "inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const GHOST_BTN = `${SMALL_BTN} border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text`;
const GREEN_BTN = `${SMALL_BTN} border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10`;
const RED_BTN = `${SMALL_BTN} border-red-500/40 text-red-400 hover:bg-red-500/10`;
const SECTION = "rounded-lg border border-linear-border bg-linear-bg-secondary";
const SECTION_HEAD = "flex items-center justify-between gap-3 border-b border-linear-border px-4 py-2.5";
const SECTION_TITLE = "text-xs font-medium text-linear-text-secondary";

const videoUrl = (name: string) => `${BASE}/video/${encodeURIComponent(name)}`;
const h3Url = (name: string) => `/api/h3studio/file/${encodeURIComponent(name)}`;
const isLive = (j: UpJob) => !["done", "error", "cancelled"].includes(j.status);

// Mirrors server.py out_size(): short side -> target, both sides even.
const outSize = (w: number, h: number, res: number) => {
  const k = res / Math.min(w, h);
  const ev = (x: number) => Math.max(2, Math.round((x * k) / 2) * 2);
  return [ev(w), ev(h)] as const;
};

const fmtDur = (s: number) => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

// XHR rather than fetch: fetch has no upload progress, and a phone video can
// take a while to cross the LAN twice (browser -> Pi -> PC).
function uploadVideo(f: File, onProgress: (p: number) => void) {
  return new Promise<Omit<Source, "preview">>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${BASE}/api/video-upload?name=${encodeURIComponent(f.name)}`);
    x.setRequestHeader("Content-Type", f.type || "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let j: any = {};
      try {
        j = JSON.parse(x.responseText);
      } catch {}
      if (x.status >= 200 && x.status < 300) resolve(j);
      else reject(new Error(j.error || `upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error("upload failed — the PC's Media Studio backend didn't answer"));
    x.send(f);
  });
}

export default function VideoUpscale() {
  const [source, setSource] = useState<Source | null>(null);
  const [uploading, setUploading] = useState<number | null>(null); // 0..1 while uploading
  const [importing, setImporting] = useState(false);
  const [h3, setH3] = useState<H3Output[] | null>(null);
  const [h3Error, setH3Error] = useState<string | null>(null);
  const [h3Pick, setH3Pick] = useState("");
  const [target, setTarget] = useState(1080);
  const [jobs, setJobs] = useState<UpJob[]>([]);
  const [gallery, setGallery] = useState<Upscaled[]>([]);
  const [viewing, setViewing] = useState<Upscaled | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now() / 1000);
  const doneIds = useRef<Set<string> | null>(null); // null until the first poll

  const loadGallery = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/upscales`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `list failed (${r.status})`);
      setGallery(j);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Jobs live on the PC, so a reload (or another device) still sees a
  // running upscale. Refresh the gallery whenever one newly finishes.
  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/jobs`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const list: UpJob[] = await r.json();
      setJobs(list);
      setOffline(false);
      const done = list.filter((j) => j.status === "done").map((j) => j.id);
      const seen = doneIds.current;
      doneIds.current = new Set(done);
      if (seen && done.some((id) => !seen.has(id))) loadGallery();
    } catch {
      setOffline(true);
    }
    setNow(Date.now() / 1000);
  }, [loadGallery]);

  const anyLive = jobs.some(isLive);
  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, anyLive ? 3000 : 15000);
    return () => clearInterval(t);
  }, [loadJobs, anyLive]);
  useEffect(() => {
    loadGallery();
  }, [loadGallery]);
  // Ticks the elapsed clocks between polls.
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [anyLive]);

  // Release the local preview of a replaced upload.
  useEffect(() => {
    const p = source?.preview;
    return () => {
      if (p?.startsWith("blob:")) URL.revokeObjectURL(p);
    };
  }, [source?.preview]);

  const loadH3 = async () => {
    setH3Error(null);
    try {
      const r = await fetch("/api/h3studio/api/status", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `H3 Studio status failed (${r.status})`);
      setH3((j.outputs || []).filter((o: H3Output) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(o.name)));
    } catch (e: any) {
      setH3([]);
      setH3Error(e.message);
    }
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setUploading(0);
    try {
      const s = await uploadVideo(f, setUploading);
      setSource({ ...s, preview: URL.createObjectURL(f) });
    } catch (e: any) {
      setError(`${f.name}: ${e.message}`);
    } finally {
      setUploading(null);
    }
  };

  const importH3 = async (name: string) => {
    setH3Pick(name);
    if (!name) return;
    setError(null);
    setImporting(true);
    try {
      const r = await fetch(`${BASE}/api/video-import`, { method: "POST", body: JSON.stringify({ h3: name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `import failed (${r.status})`);
      setSource({ ...j, preview: h3Url(name) });
    } catch (e: any) {
      setError(`${name}: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  const submit = async () => {
    if (!source) return;
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/upscale`, {
        method: "POST",
        body: JSON.stringify({ video: source.video, resolution: target }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `upscale failed (${r.status})`);
      setJobs((prev) => [j, ...prev.filter((p) => p.id !== j.id)]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (j: UpJob) => {
    if (!confirm(`Cancel the upscale of ${j.src_name}?`)) return;
    await fetch(`${BASE}/api/cancel`, { method: "POST", body: JSON.stringify({ id: j.id }) }).catch(() => {});
    loadJobs();
  };

  const remove = async (g: Upscaled) => {
    if (!confirm(`Delete ${g.name}?\n\nIt goes to the PC's Recycle Bin, so it can be restored from there.`)) return;
    try {
      const r = await fetch(`${BASE}/api/upscale-delete`, { method: "POST", body: JSON.stringify({ name: g.name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `delete failed (${r.status})`);
      setGallery((prev) => prev.filter((x) => x.name !== g.name));
    } catch (e: any) {
      setError(e.message);
    }
    setViewing(null);
  };

  const srcShort = source ? Math.min(source.width, source.height) : 0;
  const [ow, oh] = source ? outSize(source.width, source.height, target) : [0, 0];
  const busy = uploading !== null || importing;

  return (
    <div className="space-y-4">
      {offline && (
        <div className="rounded-md border border-red-500/40 px-3 py-2 text-xs text-red-400">
          Media Studio backend unreachable — it runs on the PC as the scheduled task “media-studio-server”.
        </div>
      )}

      <div className={SECTION}>
        <div className={SECTION_HEAD}>
          <span className={SECTION_TITLE}>Upscale video · SeedVR2 7B on ComfyUI (PC)</span>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Upload a video</label>
              <VideoDrop onFile={pickFile} progress={uploading} disabled={busy} />
            </div>
            <div>
              <label className={LABEL}>…or pick an H3 Studio render</label>
              <select
                className={`${FIELD} pr-7`}
                value={h3Pick}
                disabled={busy}
                onFocus={() => h3 === null && loadH3()}
                onMouseDown={() => h3 === null && loadH3()}
                onChange={(e) => importH3(e.target.value)}
              >
                <option value="">{h3 === null ? "Choose a render…" : h3.length ? `Choose a render (${h3.length})…` : "No H3 videos found"}</option>
                {(h3 || []).map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                    {o.meta?.width ? ` · ${o.meta.width}×${o.meta.height}` : ""}
                    {o.meta?.duration ? ` · ${o.meta.duration.toFixed(1)}s` : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[10px] text-linear-text-tertiary">
                {importing ? "Copying from the Mac to the PC…" : h3Error ? <span className="text-red-400">{h3Error}</span> : "Copied straight from the Mac to the PC."}
              </div>
            </div>
          </div>

          {source && (
            <div className="flex flex-col gap-3 rounded-md border border-linear-border bg-linear-bg p-3 sm:flex-row">
              <video
                key={source.preview}
                src={source.preview}
                controls
                muted
                playsInline
                preload="metadata"
                className="max-h-56 w-full rounded bg-black object-contain sm:w-72"
              />
              <div className="min-w-0 flex-1 space-y-1 text-xs">
                <div className="truncate font-medium text-linear-text" title={source.src_name}>{source.src_name}</div>
                <div className="font-mono text-[11px] text-linear-text-tertiary">
                  {source.width}×{source.height} · {source.fps} fps · {source.frames} frames · {fmtDur(source.duration)}
                  {source.audio ? " · audio" : " · no audio"}
                </div>
                <button type="button" className={`${GHOST_BTN} mt-2`} onClick={() => { setSource(null); setH3Pick(""); }}>
                  Clear
                </button>
              </div>
            </div>
          )}

          <div>
            <label className={LABEL}>Target (short side)</label>
            <div className="inline-flex h-8 items-center gap-0.5 rounded-md border border-linear-border bg-linear-bg p-0.5">
              {TARGETS.map(([res, label]) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => setTarget(res)}
                  title={source && res <= srcShort ? "Not larger than the source — restores detail without adding pixels" : undefined}
                  className={`h-full whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${
                    target === res ? "bg-linear-bg-active text-linear-text" : "text-linear-text-tertiary hover:text-linear-text-secondary"
                  } ${source && res <= srcShort ? "opacity-50" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {source && (
              <div className="mt-1.5 font-mono text-[11px] text-linear-text-tertiary">
                {source.width}×{source.height} → <span className="text-linear-text-secondary">{ow}×{oh}</span>
                {target <= srcShort && <span className="ml-2 text-amber-400">not larger than the source</span>}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={GREEN_BTN} disabled={!source || busy || submitting} onClick={submit}>
              Upscale
            </button>
            <span className="text-[11px] text-linear-text-tertiary">
              Slow: a few minutes per few seconds of video, and 4K is several times slower than 1080p. Unloads the PC&apos;s LLM while it runs; image renders queue behind it.
            </span>
          </div>
          {error && <div className="rounded-md border border-red-500/40 px-3 py-2 text-xs text-red-400">{error}</div>}
        </div>
      </div>

      {jobs.length > 0 && (
        <div className={SECTION}>
          <div className={SECTION_HEAD}>
            <span className={SECTION_TITLE}>Upscales · last 24h</span>
          </div>
          <ul className="divide-y divide-linear-border">
            {jobs.map((j) => (
              <JobRow key={j.id} j={j} now={now} onCancel={() => cancel(j)} onOpen={(name) => {
                const g = gallery.find((x) => x.name === name);
                if (g) setViewing(g);
              }} />
            ))}
          </ul>
        </div>
      )}

      <div className={SECTION}>
        <div className={SECTION_HEAD}>
          <span className={SECTION_TITLE}>Upscaled · {gallery.length}</span>
          <button type="button" className={GHOST_BTN} onClick={loadGallery}>Refresh</button>
        </div>
        {gallery.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-linear-text-tertiary">No upscaled videos yet.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((g) => (
              <button key={g.name} type="button" onClick={() => setViewing(g)} className="group text-left">
                <video
                  src={`${videoUrl(g.name)}#t=0.5`}
                  muted
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full rounded-md border border-linear-border bg-black object-contain group-hover:border-linear-text-tertiary"
                />
                <div className="mt-1 truncate text-[11px] text-linear-text-secondary">{g.src_name || g.name}</div>
                <div className="truncate font-mono text-[10px] text-linear-text-tertiary">
                  {g.src_w ? `${g.src_w}×${g.src_h} → ` : ""}
                  {g.out_w ? `${g.out_w}×${g.out_h}` : ""}
                  {g.duration ? ` · ${fmtDur(g.duration)}` : ""}
                  {g.seconds ? ` · took ${fmtDur(g.seconds)}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/80 p-4 md:items-center"
          onClick={() => setViewing(null)}
        >
          <div className="relative my-auto flex w-full max-w-5xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <video src={videoUrl(viewing.name)} controls autoPlay playsInline className="max-h-[75vh] w-full rounded-md bg-black object-contain" />
            <div className="rounded-md border border-linear-border bg-linear-bg-secondary p-3 text-xs text-linear-text-secondary">
              <div className="truncate text-linear-text" title={viewing.name}>{viewing.name}</div>
              <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-linear-text-tertiary">
                {viewing.src_name && <span>from {viewing.src_name}</span>}
                {viewing.src_w && <span>{viewing.src_w}×{viewing.src_h} → {viewing.out_w}×{viewing.out_h}</span>}
                {viewing.fps && <span>{viewing.fps} fps</span>}
                {viewing.duration && <span>{fmtDur(viewing.duration)}</span>}
                <span>{fmtBytes(viewing.size)}</span>
                {viewing.seconds && <span>took {fmtDur(viewing.seconds)}</span>}
                <span className="flex-1" />
                <a className={GHOST_BTN} href={videoUrl(viewing.name)} download={viewing.name}>Download</a>
                <button type="button" className={RED_BTN} onClick={() => remove(viewing)}>Delete</button>
                <button type="button" className={GHOST_BTN} onClick={() => setViewing(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One job: overall progress across chunks. SeedVR2 reports 0-100 per chunk in
// coarse phases (encode / upscale / decode), so the bar moves in steps and the
// time left is a rough extrapolation from the elapsed time.
function JobRow({ j, now, onCancel, onOpen }: { j: UpJob; now: number; onCancel: () => void; onOpen: (name: string) => void }) {
  const live = isLive(j);
  const rendering = j.status === "rendering" && !!j.chunks;
  const within = j.step != null && j.step_total ? j.step / j.step_total : 0;
  const pct = rendering ? ((j.chunk || 1) - 1 + within) / j.chunks! : j.status === "joining" ? 1 : 0;
  const t0 = j.render_started ?? j.created;
  const elapsed = (j.finished ?? now) - t0;
  const left = rendering && pct > 0.05 ? (elapsed * (1 - pct)) / pct : null;
  const tone =
    j.status === "done" ? "text-emerald-400" : j.status === "error" ? "text-red-400" : j.status === "cancelled" ? "text-linear-text-tertiary" : "text-violet-400";
  const label = rendering
    ? `chunk ${j.chunk} / ${j.chunks}${j.stage ? ` · ${j.stage}` : ""}`
    : j.status === "splitting"
    ? "cutting into chunks"
    : j.status === "joining"
    ? "stitching chunks + audio"
    : j.status;
  return (
    <li className="px-4 py-2 text-xs">
      <div className="flex items-center gap-3">
        <span className={`w-24 flex-none font-mono text-[10px] uppercase ${tone}`}>{j.status}</span>
        <span className="min-w-0 flex-1 truncate text-linear-text-secondary" title={j.error || j.src_name}>
          {j.error ? j.error : (
            <>
              {j.src_name}
              <span className="ml-2 font-mono text-[10px] text-linear-text-tertiary">
                {j.src_w}×{j.src_h} → {j.out_w}×{j.out_h} · {j.frames} frames
              </span>
            </>
          )}
        </span>
        <span className="flex-none font-mono tabular-nums text-linear-text-tertiary">{fmtDur(elapsed)}</span>
        {live && (
          <button type="button" className={RED_BTN} onClick={onCancel}>Cancel</button>
        )}
        {j.status === "done" && j.output && (
          <button type="button" className={GHOST_BTN} onClick={() => onOpen(j.output!)}>Play</button>
        )}
      </div>
      {live && (
        <div className="mt-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-linear-bg-tertiary">
            {pct > 0 ? (
              <div className="h-full rounded-full bg-violet-500 transition-all duration-700" style={{ width: `${Math.max(2, pct * 100)}%` }} />
            ) : (
              <div className="h-full w-full animate-pulse rounded-full bg-violet-500/30" />
            )}
          </div>
          <div className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-linear-text-tertiary">
            <span>{label}{j.note ? ` · ${j.note}` : ""}</span>
            <span>{pct > 0 ? `${Math.round(pct * 100)}%` : ""}{left != null ? ` · ~${fmtDur(left)} left` : ""}</span>
          </div>
        </div>
      )}
    </li>
  );
}

// Click or drag-and-drop target for the source video; shows upload progress.
function VideoDrop({ onFile, progress, disabled }: { onFile: (f: File | undefined) => void; progress: number | null; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => !disabled && (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragEnter={(e) => { e.preventDefault(); setHot(true); }}
      onDragOver={(e) => { e.preventDefault(); setHot(true); }}
      onDragLeave={(e) => { e.preventDefault(); setHot(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setHot(false);
        if (!disabled) onFile(e.dataTransfer.files[0]);
      }}
      className={`relative flex h-8 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed px-2.5 text-[11px] transition-colors ${
        hot
          ? "border-linear-accent bg-linear-accent/10 text-linear-accent"
          : "border-linear-border text-linear-text-tertiary hover:border-linear-text-tertiary hover:text-linear-text-secondary"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      {progress !== null && <div className="absolute inset-y-0 left-0 bg-violet-500/20" style={{ width: `${progress * 100}%` }} />}
      <span className="relative">
        {progress !== null ? (progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Reading the video on the PC…") : "Drop a video here, or click to choose"}
      </span>
      <input
        ref={input}
        type="file"
        accept={VIDEO_TYPES}
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
