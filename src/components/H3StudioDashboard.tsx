"use client";

// H3StudioDashboard — the H3 video studio (MiniMax H3 via native h3.c, plus the
// WAN VACE face swap on ComfyUI), ported from the standalone page served by
// ~/ai/render-studio/h3-dashboard.py on the Mac. That Python server is still
// the backend — renders, uploads and output files live on the Mac — and every
// call goes through /api/h3studio/*, a pass-through to its /api and /file.
//
// Behavioural rules carried over from the original page (each was a bug once):
//  - A Quality preset is pushed into the Steps/Layers/Reuse inputs, not left for
//    the backend to fall back to: the inputs are always sent, so a server-only
//    preset was silently overridden.
//  - Face swap steps/cfg are pinned by the CausVid LoRA; moving one without the
//    other produces garbage, so the mode switch resets both.
//  - Face swap lengths are generated from the source clip (4k+1, inside the
//    clip) so a window can never run past the end.
//  - Reference images are numbered in upload order; the model sees "Picture N",
//    never the filename.
//  - Deleting moves to the Mac's Trash, never unlinks.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

const BASE = "/api/h3studio";
const POLL_MS = 3_000;

type Canvas = [string, number, number];
type Preset = { steps: number; layers: number; reuse: number; label: string };
type Options = {
  canvases: Canvas[];
  lengths: number[];
  negative: string;
  fs_canvases: Canvas[];
  fs_steps: number;
  fs_cfg: number;
  fs_negative: string;
  h3c_canvases?: Canvas[];
  h3c_presets?: Record<string, Preset>;
  h3c_default_preset?: string;
  h3c_ref2va?: boolean;
  h3c_available?: boolean;
};

type Running = {
  renderer?: string;
  prefix?: string;
  mode?: string;
  refs?: number;
  ref_size?: string;
  phase?: string;
  prompt?: string;
  step?: number | null;
  steps?: number;
  pct?: number;
  s_per_step?: number;
  elapsed?: string;
  eta_s?: number | null;
  eta_note?: string;
  width?: number;
  height?: number;
  frames?: number;
  seconds?: number;
  cfg?: number;
  seed?: number;
  detected?: number | null;
  detect_total?: number;
  detect_pct?: number;
  stage_cur?: number | null;
  stage_total?: number;
  stage_pct?: number;
  stage_label?: string;
};

type Serving = {
  gate: boolean;
  swap: boolean;
  models?: string[];
  ram_gb?: number | null;
  locked?: boolean;
  locked_model?: string | null;
  lock_idle_left_min?: number | null;
  render_guard?: boolean;
  render_allowed?: string[];
  render_armed?: boolean;
  arm_expires_in_s?: number | null;
  busy?: boolean;
  last_action?: string | null;
  last_output?: string;
  preparing?: boolean;
  prepare_output?: string;
  keep_model?: string;
};

type Recipe = {
  mode?: string;
  engine?: string;
  preset?: string;
  steps?: number;
  layers?: number;
  reuse?: number;
  cfg?: number;
  seed?: number;
  refs?: number;
  ref_size?: string;
  prefix?: string;
  prompt?: string;
};

type Output = {
  name: string;
  size: number;
  mtime: number;
  meta?: {
    duration?: number;
    width?: number;
    height?: number;
    vcodec?: string;
    fps?: number;
    frames?: number;
    acodec?: string;
    channels?: number;
    sample_rate?: number;
    recipe?: Recipe;
  } | null;
};

type Status = {
  comfy?: string;
  running?: Running | null;
  pending?: number;
  outputs: Output[];
  outputs_total?: number;
  serving?: Serving;
  h3c_ref2va?: boolean;
  error?: string;
};

type Img = { file: string; thumb: string; w: number; h: number; label: string };
type Video = { file: string; width: number; height: number; frames: number; fps: number };
type Mode = "t2va" | "ref2va" | "fl2va" | "faceswap";

const MODES: [Mode, string][] = [
  ["t2va", "Text → video"],
  ["ref2va", "Reference / character"],
  ["fl2va", "First / last frame"],
  ["faceswap", "Face swap"],
];
const FS_WANT = [17, 33, 49, 65, 81, 121, 161, 201, 241, 321];

const hms = (s: number) => {
  s = Math.max(0, Math.round(s));
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : m ? `${m} m ${String(x).padStart(2, "0")} s` : `${x} s`;
};
const mb = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : ((b / 1024) | 0) + " KB");
const secs = (s: number) => (s >= 60 ? `${(s / 60) | 0}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(1)}s`);
const fileUrl = (name: string) => `${BASE}/file/${encodeURIComponent(name)}`;

async function post<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}/api/${path}`, { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} failed (${r.status})`);
  return j as T;
}

const readDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(f);
  });

const imgSize = (src: string) =>
  new Promise<[number, number]>((res) => {
    const im = new Image();
    im.onload = () => res([im.naturalWidth, im.naturalHeight]);
    im.onerror = () => res([0, 0]);
    im.src = src;
  });

// ---------- small styled pieces ----------
// Sized to match the rest of Mission Control: 32px controls, xs text, mono
// numerals. Nothing in this tab should be larger than the Inference Core tab.

const LABEL = "mb-1 block text-[10px] uppercase tracking-[0.16em] text-linear-text-tertiary";
const FIELD =
  "h-8 w-full rounded-md border border-linear-border bg-linear-bg px-2.5 text-xs text-linear-text focus:border-linear-accent focus:outline-none";
const SELECT = `${FIELD} pr-7`;
const SMALL_BTN =
  "inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const GHOST_BTN = `${SMALL_BTN} border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text`;
const GREEN_BTN = `${SMALL_BTN} border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10`;
const AMBER_BTN = `${SMALL_BTN} border-amber-500/40 text-amber-400 hover:bg-amber-500/10`;
const SECTION = "rounded-lg border border-linear-border bg-linear-bg-secondary";
const SECTION_HEAD = "flex items-center justify-between gap-3 border-b border-linear-border px-4 py-2.5";
const SECTION_TITLE = "text-xs font-medium text-linear-text-secondary";

function Seg<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-md border border-linear-border bg-linear-bg p-0.5">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`h-full whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${
            value === k ? "bg-linear-bg-active text-linear-text" : "text-linear-text-tertiary hover:text-linear-text-secondary"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// A file target that accepts both click and drag-and-drop. Rendered as a small
// dashed tile beside the thumbnails, or as a wide slot for the face-swap inputs.
function DropTarget({
  accept,
  multiple,
  onFiles,
  className,
  children,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className: string;
  children: ReactNode;
}) {
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
      className={`cursor-pointer rounded-md border border-dashed transition-colors ${
        hot
          ? "border-linear-accent bg-linear-accent/10 text-linear-accent"
          : "border-linear-border text-linear-text-tertiary hover:border-linear-text-tertiary hover:text-linear-text-secondary"
      } ${className}`}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Thumb({ src, caption, onRemove }: { src: string; caption: string; onRemove: () => void }) {
  return (
    <div className="group relative w-16 flex-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={caption} className="block h-16 w-16 rounded-md border border-linear-border object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${caption}`}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-linear-border bg-linear-bg-tertiary text-[11px] leading-none text-linear-text-secondary hover:text-linear-text sm:opacity-0 sm:group-hover:opacity-100"
      >
        ×
      </button>
      <div className="mt-1 truncate text-center font-mono text-[10px] text-linear-text-tertiary">{caption}</div>
    </div>
  );
}

function Dot({ tone, pulse }: { tone: "ok" | "warn" | "off" | "busy"; pulse?: boolean }) {
  const c = tone === "ok" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : tone === "busy" ? "bg-violet-400" : "bg-linear-text-tertiary";
  return (
    <span className="relative flex h-2 w-2 flex-none">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${c} opacity-60`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "off" | "busy"; children: ReactNode }) {
  const c =
    tone === "ok"
      ? "border-emerald-500/30 text-emerald-400"
      : tone === "warn"
      ? "border-amber-500/40 text-amber-400"
      : tone === "busy"
      ? "border-violet-500/40 text-violet-400"
      : "border-linear-border text-linear-text-tertiary";
  return <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${c}`}>{children}</span>;
}

export default function H3StudioDashboard() {
  const [opts, setOpts] = useState<Options | null>(null);
  const [optsError, setOptsError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("t2va");
  const [preset, setPreset] = useState("balanced");
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<Img[]>([]);
  const [fl, setFl] = useState<{ first: Img | null; last: Img | null }>({ first: null, last: null });
  const [fsv, setFsv] = useState<Video | null>(null);
  const [fsvInfo, setFsvInfo] = useState("");
  const [fsFace, setFsFace] = useState<Img | null>(null);
  const [canvas, setCanvas] = useState("");
  const [length, setLength] = useState(0);
  const [steps, setSteps] = useState(20);
  const [cfg, setCfg] = useState(3.5);
  const [seed, setSeed] = useState(42);
  const [layers, setLayers] = useState(50);
  const [reuse, setReuse] = useState(2);
  const [negative, setNegative] = useState("");
  const [name, setName] = useState("h3_web");
  const [refSize, setRefSize] = useState("max");
  const [startFrame, setStartFrame] = useState(0);
  const [maskPhrase, setMaskPhrase] = useState("head");
  const [advOpen, setAdvOpen] = useState(false);
  const [est, setEst] = useState<{ total_s: number; s_per_step: number; tokens: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [promptOpen, setPromptOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [svcBusy, setSvcBusy] = useState(false);
  const [svcLogOpen, setSvcLogOpen] = useState(false);

  const [outputs, setOutputs] = useState<Output[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "old" | "big" | "name">("new");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ name: string; left: number; top: number } | null>(null);
  const [propsFor, setPropsFor] = useState<string | null>(null);

  const [, setTick] = useState(0);
  const etaRef = useRef<{ at: number; left: number } | null>(null);
  const sigRef = useRef("");
  const mounted = useRef(true);

  const fs = mode === "faceswap";
  const comfyUp = status?.comfy === "up";
  const ref2vaReady = status?.h3c_ref2va ?? opts?.h3c_ref2va;

  // ---------- options + poll ----------

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/status`, { cache: "no-store" });
      const d = (await r.json()) as Status;
      if (!mounted.current) return;
      if (!r.ok) throw new Error(d.error || `status ${r.status}`);
      setStatus(d);
      setOffline(null);
      if (d.running?.eta_s != null) etaRef.current = { at: Date.now(), left: d.running.eta_s };
      else if (!d.running) etaRef.current = null;
      // Metadata arrives a poll or two after the file does, so it belongs in the
      // signature. Only a changed signature replaces the list, so an unchanged
      // poll never touches the <video> elements mid-playback.
      const sig = JSON.stringify(d.outputs.map((f) => [f.name, f.mtime, !!f.meta]));
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setOutputs(d.outputs);
        setTotal(d.outputs_total || d.outputs.length);
        const live = new Set(d.outputs.map((f) => f.name));
        setSel((s) => new Set(Array.from(s).filter((n) => live.has(n))));
      }
    } catch (e: any) {
      if (mounted.current) setOffline(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/options`, { cache: "no-store" });
        const o = await r.json();
        if (!r.ok) throw new Error(o.error || `options ${r.status}`);
        if (!mounted.current) return;
        setOpts(o);
        setNegative(o.negative);
        const p = o.h3c_default_preset || "balanced";
        setPreset(p);
        const pv = o.h3c_presets?.[p];
        if (pv) { setSteps(pv.steps); setLayers(pv.layers); setReuse(pv.reuse); }
        const list: Canvas[] = o.h3c_canvases || o.canvases;
        const c = list[Math.min(2, list.length - 1)];
        setCanvas(`${c[1]}x${c[2]}`);
        setLength(o.lengths[0]);
      } catch (e: any) {
        if (mounted.current) setOptsError(e?.message || String(e));
      }
    })();
    poll();
    const p = setInterval(poll, POLL_MS);
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      mounted.current = false;
      clearInterval(p);
      clearInterval(t);
    };
  }, [poll]);

  // ---------- derived form options ----------

  const canvasList: Canvas[] = useMemo(() => {
    if (!opts) return [];
    return fs ? opts.fs_canvases : opts.h3c_canvases || opts.canvases;
  }, [opts, fs]);

  const fsLengthList = useMemo(() => {
    const avail = fsv ? Math.max(0, (fsv.frames || 0) - (startFrame || 0)) : 0;
    const fit = FS_WANT.filter((L) => L <= avail);
    if (fsv && avail >= 5 && !fit.includes(avail - ((avail - 1) % 4))) fit.push(avail - ((avail - 1) % 4));
    return fit;
  }, [fsv, startFrame]);

  const lengthOptions: [number, string][] = useMemo(() => {
    if (!opts) return [];
    if (!fs) return opts.lengths.map((L) => [L, `${L} frames · ${(L / 24).toFixed(1)} s`]);
    if (!fsLengthList.length) return [[33, "33 frames"]];
    return fsLengthList.map((L) => [L, `${L} frames${fsv?.fps ? ` · ${(L / fsv.fps).toFixed(1)} s` : ""}`]);
  }, [opts, fs, fsLengthList, fsv]);

  // keep the selected length valid when the list changes under it
  useEffect(() => {
    if (!lengthOptions.length) return;
    if (!lengthOptions.some(([L]) => L === length)) {
      setLength(fs && fsLengthList.length ? fsLengthList[Math.min(1, fsLengthList.length - 1)] : lengthOptions[0][0]);
    }
  }, [lengthOptions, length, fs, fsLengthList]);

  const applyPreset = useCallback(
    (k: string) => {
      setPreset(k);
      const p = opts?.h3c_presets?.[k];
      if (p) { setSteps(p.steps); setLayers(p.layers); setReuse(p.reuse); }
    },
    [opts]
  );

  const switchMode = (m: Mode) => {
    if (!opts || m === mode) return;
    setMode(m);
    setRefs([]);
    setFl({ first: null, last: null });
    if (m === "faceswap") {
      const c = opts.fs_canvases[0];
      setCanvas(`${c[1]}x${c[2]}`);
      setSteps(opts.fs_steps);
      setCfg(opts.fs_cfg);
      setNegative(opts.fs_negative);
      setName("faceswap_web");
    } else {
      const list = opts.h3c_canvases || opts.canvases;
      if (!list.some((c) => `${c[1]}x${c[2]}` === canvas)) {
        const c = list[Math.min(2, list.length - 1)];
        setCanvas(`${c[1]}x${c[2]}`);
      }
      setCfg(3.5);
      setNegative(opts.negative);
      setName("h3_web");
      applyPreset(preset);
    }
  };

  // ---------- params / estimate ----------

  const params = () => {
    const [w, h] = canvas.split("x").map(Number);
    return {
      engine: fs ? "comfy" : "h3c",
      preset,
      mode,
      prompt,
      width: w,
      height: h,
      frames: length,
      steps,
      cfg,
      layers: layers || null,
      reuse: reuse || null,
      seed,
      negative,
      name,
      ref_size: refSize,
      refs: mode === "ref2va" ? refs.map((r) => ({ file: r.file, w: r.w, h: r.h })) : [],
      first_frame: mode === "fl2va" && fl.first ? fl.first.file : null,
      last_frame: mode === "fl2va" && fl.last ? fl.last.file : null,
      video: fsv ? fsv.file : null,
      face: fsFace ? fsFace.file : null,
      start_frame: startFrame || 0,
      mask_phrase: maskPhrase,
    };
  };

  const estKey = JSON.stringify([mode, preset, canvas, length, steps, cfg, layers, reuse, refSize, refs.length, startFrame, fsv?.file]);
  useEffect(() => {
    if (!opts || !canvas || !length) return;
    const t = setTimeout(async () => {
      try {
        setEst(await post("estimate", params()));
      } catch {
        setEst(null);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estKey, opts]);

  // ---------- uploads ----------

  const upload = async (f: File) => {
    const data = await readDataUrl(f);
    const j = await post("upload", { name: f.name, data });
    return { j, data };
  };

  const addImages = async (files: File[]) => {
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      try {
        const { j, data } = await upload(f);
        const [w, h] = await imgSize(data);
        const rec: Img = { file: j.file, thumb: data, w, h, label: f.name };
        if (mode === "ref2va") setRefs((r) => (r.length < 9 ? [...r, rec] : r));
        else setFl((x) => (!x.first ? { first: rec, last: null } : { ...x, last: rec }));
      } catch (e: any) {
        setMsg({ kind: "err", text: "Upload failed: " + e.message });
        return;
      }
    }
  };

  const addVideo = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFsvInfo(`Reading ${f.name} — ${mb(f.size)}…`);
    try {
      const { j } = await upload(f);
      if (j.kind !== "video") throw new Error("that is not a video");
      const v: Video = { file: j.file, ...j.video };
      setFsv(v);
      const dur = v.frames && v.fps ? ` · ${(v.frames / v.fps).toFixed(1)} s` : "";
      setFsvInfo(`${f.name} — ${v.width}×${v.height}, ${v.frames} frames at ${v.fps} fps${dur}`);
      // Offer the canvas matching the source's orientation; a portrait clip on a
      // landscape canvas gets centre-cropped without warning.
      const port = v.height > v.width;
      const c = opts?.fs_canvases.find(([, w, h]) => h > w === port);
      if (c) setCanvas(`${c[1]}x${c[2]}`);
    } catch (e: any) {
      setFsv(null);
      setFsvInfo("");
      setMsg({ kind: "err", text: "Video upload failed: " + e.message });
    }
  };

  const addFace = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const { j, data } = await upload(f);
      if (j.kind !== "image") throw new Error("that is not an image");
      setFsFace({ file: j.file, thumb: data, w: 0, h: 0, label: f.name });
    } catch (e: any) {
      setMsg({ kind: "err", text: "Image upload failed: " + e.message });
    }
  };

  // ---------- submit / cancel ----------

  const engineNote = fs
    ? comfyUp
      ? "Face swap runs the WAN VACE pipeline on ComfyUI (:8188)."
      : 'Face swap needs ComfyUI for the WAN VACE pipeline — start it with the "Start ComfyUI" launcher on the Mac, then this unlocks.'
    : opts && !opts.h3c_available
    ? "The h3 binary is missing or not executable."
    : mode === "ref2va" && opts && !ref2vaReady
    ? "The Ref2VA checkpoint is not available — reference mode is disabled."
    : "Native h3.c (Metal). Faster and much smaller in memory, but no queue — one render at a time.";

  const goDisabled =
    !opts || submitting || (fs ? !comfyUp : !opts.h3c_available || (mode === "ref2va" && !ref2vaReady));

  const submit = async () => {
    const p = params();
    if (!p.prompt.trim()) return setMsg({ kind: "err", text: "Write a prompt first." });
    if (p.mode === "ref2va" && !p.refs.length) return setMsg({ kind: "err", text: "Reference mode needs at least one image." });
    if (p.mode === "fl2va" && !p.first_frame) return setMsg({ kind: "err", text: "First/last mode needs at least a first frame." });
    if (p.mode === "faceswap") {
      if (!p.video) return setMsg({ kind: "err", text: "Face swap needs a source video." });
      if (!p.face) return setMsg({ kind: "err", text: "Face swap needs a photo of the face to swap in." });
      if (fsv && p.start_frame + p.frames > fsv.frames)
        return setMsg({ kind: "err", text: `That window runs past the end of the clip — it has ${fsv.frames} frames.` });
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const j = await post("submit", p);
      setMsg({
        kind: "ok",
        text:
          j.engine === "h3c"
            ? `Started natively as pid ${j.pid} — ${j.frames} frames, estimated ${hms(j.estimate_s)}. Progress appears below.`
            : `Queued as ${String(j.prompt_id).slice(0, 8)} — ${j.frames} frames. Progress appears below.`,
      });
      poll();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    }
    setSubmitting(false);
  };

  const cancel = async () => {
    const r = status?.running;
    const spent = r?.elapsed ? ` ${r.elapsed} of work` : " this render";
    if (!confirm(`Stop the running render?\n\nThis discards${spent} and cannot be undone.`)) return;
    setCancelling(true);
    try {
      const j = await post("cancel", {});
      setMsg(
        j.cancelled
          ? { kind: "ok", text: `Render stopped (${j.engine}${j.signal ? ", " + j.signal : ""}).` }
          : { kind: "err", text: "The render did not stop — it may be unkillable; check the Mac." }
      );
      poll();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    }
    setCancelling(false);
  };

  // ---------- serving controls ----------

  const svc = async (fn: () => Promise<void>) => {
    if (svcBusy) return;
    setSvcBusy(true);
    try {
      await fn();
    } catch (e: any) {
      alert(e.message);
    }
    setSvcBusy(false);
    poll();
  };
  const keepModel = status?.serving?.keep_model || "the small model";

  // ---------- gallery ----------

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = outputs.filter(
      (f) =>
        !needle ||
        f.name.toLowerCase().includes(needle) ||
        (f.meta?.recipe?.prompt || "").toLowerCase().includes(needle)
    );
    const by = {
      new: (a: Output, b: Output) => b.mtime - a.mtime,
      old: (a: Output, b: Output) => a.mtime - b.mtime,
      big: (a: Output, b: Output) => b.size - a.size,
      name: (a: Output, b: Output) => a.name.localeCompare(b.name),
    }[sort];
    return [...list].sort(by);
  }, [outputs, q, sort]);

  const doDelete = async (names: string[]) => {
    if (!names.length) return;
    setPropsFor(null);
    const what = names.length === 1 ? names[0] : `${names.length} renders`;
    if (!confirm(`Move ${what} to the Trash on the Mac?\n\nThey stay recoverable from Finder.`)) return;
    try {
      const j = await post("delete", { names });
      setSel((s) => new Set(Array.from(s).filter((n) => !names.includes(n))));
      if (j.failed?.length) alert("Could not delete:\n" + j.failed.map((f: any) => `${f.name} — ${f.error}`).join("\n"));
      sigRef.current = ""; // force a redraw even if the poll races the filesystem
      poll();
    } catch (e: any) {
      alert(e.message);
    }
  };

  useEffect(() => {
    if (!menu && !propsFor) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenu(null); setPropsFor(null); }
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [menu, propsFor]);

  const openMenu = (e: MouseEvent<HTMLButtonElement>, n: string) => {
    e.stopPropagation();
    // Positioned against the viewport and flipped/clamped so it stays on screen
    // at the bottom of the grid or on a phone. It is fixed, not inside the card,
    // because the card clips its children.
    const r = e.currentTarget.getBoundingClientRect();
    const w = 190, h = 168;
    setMenu({
      name: n,
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
      top: r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6,
    });
  };

  // ---------- render ----------

  const running = status?.running || null;
  const serving = status?.serving;
  const headline = offline
    ? { tone: "warn" as const, pulse: false, label: "OFFLINE", color: "text-amber-400", desc: offline }
    : running
    ? {
        tone: "busy" as const,
        pulse: true,
        label: "RENDERING",
        color: "text-violet-400",
        desc: `${running.prefix || "render"} · ${running.renderer === "h3.c" ? "native h3.c" : "WAN VACE face swap"}`,
      }
    : fs && !comfyUp
    ? { tone: "warn" as const, pulse: false, label: "COMFYUI DOWN", color: "text-amber-400", desc: "Face swap is unavailable until ComfyUI is started on the Mac" }
    : { tone: "off" as const, pulse: false, label: status ? "IDLE" : "CONNECTING", color: "text-linear-text-secondary", desc: "Nothing rendering right now" };

  const etaLeft = etaRef.current ? etaRef.current.left - (Date.now() - etaRef.current.at) / 1000 : null;
  const propsFile = propsFor ? outputs.find((o) => o.name === propsFor) : null;
  const llmUp = !!(serving?.gate && serving?.swap);
  const preset0 = opts?.h3c_presets?.[preset];

  return (
    <div className="animate-fadeIn space-y-4">
      {/* ---------- status strip ---------- */}
      <section
        className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 transition-colors duration-500 ${
          running ? "border-violet-500/40 bg-violet-500/5" : offline ? "border-amber-500/40 bg-amber-500/5" : "border-linear-border bg-linear-bg-secondary"
        }`}
      >
        <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-2.5">
          <Dot tone={headline.tone} pulse={headline.pulse} />
          <span className={`font-mono text-sm font-semibold tracking-wide ${headline.color}`}>{headline.label}</span>
          <span className="truncate text-xs text-linear-text-tertiary">{headline.desc}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {serving && <Chip tone={llmUp ? "ok" : "off"}>{llmUp ? "llm up" : "llm stopped"}</Chip>}
          {serving && <Chip tone={serving.render_guard ? "warn" : "off"}>{serving.render_guard ? "render guard" : "render free"}</Chip>}
          <Chip tone={comfyUp ? "ok" : "off"}>comfyui {comfyUp ? "up" : "off"}</Chip>
          {status && <Chip tone="off">{status.outputs_total ?? outputs.length} renders</Chip>}
        </div>
      </section>

      {optsError && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
          Could not load H3 Studio options — {optsError}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* ---------- live render (only while one runs) ---------- */}
          {running && (
            <section className={`${SECTION} border-violet-500/30`}>
              <div className={SECTION_HEAD}>
                <div className={SECTION_TITLE}>Live Render</div>
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-violet-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                  {running.renderer === "h3.c" ? "h3.c" : "wan vace"}
                </span>
              </div>
              <LiveCard
                r={running}
                etaLeft={etaLeft}
                promptOpen={promptOpen}
                onTogglePrompt={() => setPromptOpen((x) => !x)}
                onCancel={cancel}
                cancelling={cancelling}
              />
            </section>
          )}

          {/* ---------- composer ---------- */}
          <section className={SECTION}>
            <div className="flex items-center gap-4 overflow-x-auto border-b border-linear-border px-4 [scrollbar-width:none] sm:gap-5">
              {MODES.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => switchMode(k)}
                  className={`-mb-px whitespace-nowrap border-b-2 py-2.5 text-xs font-medium transition-colors ${
                    mode === k
                      ? "border-linear-accent text-linear-text"
                      : "border-transparent text-linear-text-tertiary hover:text-linear-text-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-4 p-4">
              {/* face swap inputs */}
              {fs && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className={LABEL}>Source video</span>
                    {fsv ? (
                      <div className="flex h-16 items-center gap-3 rounded-md border border-linear-border bg-linear-bg px-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded bg-linear-bg-tertiary text-linear-text-tertiary">▶</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-linear-text-secondary" title={fsvInfo}>{fsvInfo}</span>
                        <button type="button" onClick={() => { setFsv(null); setFsvInfo(""); }} className="text-xs text-linear-text-tertiary hover:text-linear-text">×</button>
                      </div>
                    ) : (
                      <DropTarget accept="video/mp4,video/quicktime,video/webm" onFiles={addVideo} className="flex h-16 items-center justify-center px-3 text-center text-xs">
                        {fsvInfo || "Drop the footage to alter, or click"}
                      </DropTarget>
                    )}
                  </div>
                  <div>
                    <span className={LABEL}>Face to swap in</span>
                    {fsFace ? (
                      <div className="flex h-16 items-center gap-3 rounded-md border border-linear-border bg-linear-bg px-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={fsFace.thumb} alt="face" className="h-12 w-12 rounded object-cover" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-linear-text-secondary">{fsFace.label}</span>
                        <button type="button" onClick={() => setFsFace(null)} className="px-1 text-xs text-linear-text-tertiary hover:text-linear-text">×</button>
                      </div>
                    ) : (
                      <DropTarget accept="image/png,image/jpeg,image/webp" onFiles={addFace} className="flex h-16 items-center justify-center px-3 text-center text-xs">
                        Drop one clear photo, or click
                      </DropTarget>
                    )}
                  </div>
                </div>
              )}

              <div>
                <span className={LABEL}>{fs ? "Prompt — the person and the shot" : "Prompt — the scene and the sound"}</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !goDisabled) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={5}
                  placeholder={
                    fs
                      ? "A woman in her thirties with short dark hair, facing the camera in soft window light. (No audio — the source keeps its own.)"
                      : "A blacksmith hammers glowing steel in a dim forge, sparks arcing off the anvil. Warm firelight, cinematic 35mm. The ring of hammer on steel, the roar of the furnace."
                  }
                  className="min-h-[120px] w-full resize-y rounded-md border border-linear-border bg-linear-bg px-3 py-2.5 text-sm leading-relaxed text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none"
                />
              </div>

              {/* reference / keyframe images */}
              {(mode === "ref2va" || mode === "fl2va") && (
                <div>
                  <span className={LABEL}>{mode === "ref2va" ? "Reference images · up to 9" : "First frame, then optional last frame"}</span>
                  <div className="flex flex-wrap items-start gap-3 pt-1">
                    {mode === "ref2va"
                      ? refs.map((r, i) => (
                          <Thumb key={r.file + i} src={r.thumb} caption={`Picture ${i + 1}`} onRemove={() => setRefs((x) => x.filter((_, j) => j !== i))} />
                        ))
                      : ([[fl.first, "first"], [fl.last, "last"]] as [Img | null, string][])
                          .filter(([r]) => r)
                          .map(([r, cap], i) => (
                            <Thumb
                              key={cap}
                              src={r!.thumb}
                              caption={cap}
                              onRemove={() => setFl((x) => (i === 0 ? { first: x.last, last: null } : { ...x, last: null }))}
                            />
                          ))}
                    {(mode === "ref2va" ? refs.length < 9 : !fl.last) && (
                      <DropTarget
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onFiles={addImages}
                        className="flex h-16 w-16 flex-none flex-col items-center justify-center gap-0.5"
                      >
                        <span className="text-lg leading-none">+</span>
                        <span className="text-[10px]">Add</span>
                      </DropTarget>
                    )}
                  </div>
                  {mode === "ref2va" && (
                    <p className="mt-2 text-[11px] leading-relaxed text-linear-text-tertiary">
                      {refs.length > 1
                        ? "Name them in the prompt by number — “Picture 1 is the branch manager…”. The model sees this order, never the filenames."
                        : refs.length === 1
                        ? "Loaded as Picture 1 — name it in the prompt (“the person in Picture 1”) or just describe the subject."
                        : "Several angles of one subject lock it hardest; one image each covers more characters."}
                    </p>
                  )}
                </div>
              )}

              {/* settings row */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[180px] flex-1 sm:flex-none">
                  <span className={LABEL}>Canvas</span>
                  <select value={canvas} onChange={(e) => setCanvas(e.target.value)} className={SELECT}>
                    {canvasList.map(([label, w, h]) => (
                      <option key={`${w}x${h}`} value={`${w}x${h}`}>
                        {label.replace(/\s+/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[150px] flex-1 sm:flex-none">
                  <span className={LABEL}>Length</span>
                  <select value={length} onChange={(e) => setLength(+e.target.value)} className={SELECT}>
                    {lengthOptions.map(([L, label]) => (
                      <option key={L} value={L}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {!fs && opts?.h3c_presets && (
                  <div>
                    <span className={LABEL}>Quality</span>
                    <Seg
                      items={Object.entries(opts.h3c_presets).map(([k, p]) => [k, p.label] as [string, string])}
                      value={preset}
                      onChange={applyPreset}
                    />
                  </div>
                )}
                {mode === "ref2va" && (
                  <label className="min-w-[130px]">
                    <span className={LABEL}>Ref detail</span>
                    <select value={refSize} onChange={(e) => setRefSize(e.target.value)} className={SELECT}>
                      <option value="max">Max (full)</option>
                      <option value="match">Match canvas</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setAdvOpen((x) => !x)}
                  aria-expanded={advOpen}
                  className={`${SMALL_BTN} h-8 gap-1 ${
                    advOpen ? "border-linear-border bg-linear-bg-tertiary text-linear-text" : "border-linear-border text-linear-text-secondary hover:bg-linear-bg-tertiary"
                  }`}
                >
                  Advanced <span className="text-[9px]">{advOpen ? "▲" : "▼"}</span>
                </button>
              </div>

              {advOpen && (
                <div className="rounded-md border border-linear-border bg-linear-bg p-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label>
                      <span className={LABEL}>Steps</span>
                      <input type="number" min={1} max={60} value={steps} onChange={(e) => setSteps(+e.target.value)} className={FIELD} />
                    </label>
                    {fs ? (
                      <label>
                        <span className={LABEL}>cfg</span>
                        <input type="number" min={1} max={12} step={0.1} value={cfg} onChange={(e) => setCfg(+e.target.value)} className={FIELD} />
                      </label>
                    ) : (
                      <>
                        <label>
                          <span className={LABEL}>Layers</span>
                          <input type="number" min={1} max={50} value={layers} onChange={(e) => setLayers(+e.target.value)} className={FIELD} />
                        </label>
                        <label>
                          <span className={LABEL}>Reuse</span>
                          <input type="number" min={1} max={3} value={reuse} onChange={(e) => setReuse(+e.target.value)} className={FIELD} />
                        </label>
                      </>
                    )}
                    <label>
                      <span className={LABEL}>Seed</span>
                      <div className="flex gap-1">
                        <input type="number" min={0} value={seed} onChange={(e) => setSeed(+e.target.value)} className={FIELD} />
                        <button
                          type="button"
                          title="Randomise seed"
                          onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
                          className={`${GHOST_BTN} h-8 w-8 flex-none px-0`}
                        >
                          ⟳
                        </button>
                      </div>
                    </label>
                    {fs && (
                      <label>
                        <span className={LABEL}>Start frame</span>
                        <input
                          type="number"
                          min={0}
                          max={fsv ? Math.max(0, fsv.frames - 5) : undefined}
                          value={startFrame}
                          onChange={(e) => setStartFrame(Math.max(0, +e.target.value || 0))}
                          className={FIELD}
                        />
                      </label>
                    )}
                    {fs && (
                      <label className="col-span-2 sm:col-span-4">
                        <span className={LABEL}>What to replace</span>
                        <input value={maskPhrase} onChange={(e) => setMaskPhrase(e.target.value)} placeholder="head" className={FIELD} />
                      </label>
                    )}
                    <label className="col-span-2 sm:col-span-4">
                      <span className={LABEL}>Output name</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
                    </label>
                    {fs && (
                      <label className="col-span-2 sm:col-span-4">
                        <span className={LABEL}>Negative prompt</span>
                        <input value={negative} onChange={(e) => setNegative(e.target.value)} className={FIELD} />
                      </label>
                    )}
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-linear-text-tertiary">
                    {fs
                      ? "Steps and cfg are pinned by the CausVid LoRA — change one and the output breaks. A start frame past 0 drops the audio. Try “head and hands” when skin tone mismatches on the arms."
                      : `${preset0 ? `${preset0.label}: ${preset0.steps} steps · ${preset0.layers} of 50 layers · reuse ${preset0.reuse}. ` : ""}Layers is the depth lever; reuse 1 doubles the work.`}
                  </p>
                </div>
              )}

              {msg && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/5 text-amber-400"
                  }`}
                >
                  {msg.text}
                </div>
              )}
            </div>

            {/* footer: engine note · estimate · action */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-linear-border px-4 py-2.5">
              <span className="w-full text-[11px] leading-snug text-linear-text-tertiary sm:w-auto sm:min-w-0 sm:flex-1">{engineNote}</span>
              <span className="ml-auto font-mono text-[11px] text-linear-text-tertiary sm:ml-0">
                {est ? (
                  <>
                    ≈ <b className="font-semibold text-linear-text">{hms(est.total_s)}</b> · {Math.round(est.s_per_step)} s/step
                    {est.tokens ? ` · ${(est.tokens / 1000).toFixed(0)}k tok` : ""}
                  </>
                ) : (
                  "—"
                )}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={goDisabled}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-linear-accent px-3.5 text-xs font-medium text-white transition-colors hover:bg-linear-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Starting…" : fs ? "Swap face" : "Render"}
                <kbd className="hidden rounded bg-white/15 px-1 font-sans text-[10px] sm:inline">⌘↵</kbd>
              </button>
            </div>
          </section>
        </div>

        {/* ---------- serving stack ---------- */}
        <section className={SECTION}>
          <div className={SECTION_HEAD}>
            <div className={SECTION_TITLE}>LLM Serving</div>
            <span className="font-mono text-[10px] text-linear-text-tertiary">gate :8080</span>
          </div>
          {!serving ? (
            <div className="px-4 py-6 text-center text-xs text-linear-text-tertiary">{offline ? "No signal" : "Loading…"}</div>
          ) : (
            <ServingPanel
              s={serving}
              rendering={!!running}
              busy={svcBusy}
              keepModel={keepModel}
              logOpen={svcLogOpen}
              onToggleLog={() => setSvcLogOpen((x) => !x)}
              onStartStop={(action) => {
                if (action === "stop" && !confirm("Stop the LLM serving stack? Anything using the models will fail until it is started again.")) return;
                svc(async () => { await post("serving", { action }); });
              }}
              onUnpin={() => svc(async () => { await post("lock", {}); })}
              onGuard={(on) =>
                svc(async () => {
                  const j = await post("render-guard", { state: on ? "on" : "off" });
                  // The gate refuses to engage when nothing is rendering, and says why.
                  if (on && !j.render_guard) alert(j.error || "the gate would not engage the guard");
                })
              }
              onPrepare={() => {
                if (
                  !confirm(
                    `Evict all models and reload ${keepModel}?\n\nAgents will be unavailable for roughly 30 seconds while it reloads.\nBig models stay blocked for 10 minutes so you can start a render.`
                  )
                )
                  return;
                svc(async () => { await post("prepare-memory", {}); });
              }}
            />
          )}
        </section>
      </div>

      {/* ---------- gallery ---------- */}
      <section className={SECTION}>
        <div className="flex flex-wrap items-center gap-2 border-b border-linear-border px-4 py-2">
          <div className={`${SECTION_TITLE} mr-1`}>Finished Renders</div>
          <span className="font-mono text-[10px] text-linear-text-tertiary">
            {!outputs.length
              ? ""
              : q.trim()
              ? `${visible.length} match`
              : outputs.length < total
              ? `newest ${outputs.length} of ${total}`
              : `${total}`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {sel.size > 0 && (
              <>
                <button type="button" onClick={() => setSel(new Set())} className={GHOST_BTN}>
                  Clear
                </button>
                <button type="button" onClick={() => doDelete(Array.from(sel))} className={AMBER_BTN}>
                  Delete {sel.size}
                </button>
              </>
            )}
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name or prompt"
              className="h-7 w-44 rounded-md border border-linear-border bg-linear-bg px-2.5 text-[11px] text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none sm:w-56"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-7 rounded-md border border-linear-border bg-linear-bg pl-2 pr-6 text-[11px] text-linear-text"
            >
              <option value="new">Newest</option>
              <option value="old">Oldest</option>
              <option value="big">Largest</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-linear-text-tertiary">
            {outputs.length ? "Nothing matches that filter." : offline ? "No signal" : "No renders yet."}
          </div>
        ) : (
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            {visible.map((f) => {
              const on = sel.has(f.name);
              const vid = /\.(mp4|webm|mov)$/i.test(f.name);
              const overlay = `absolute top-1.5 z-10 flex h-6 items-center justify-center rounded border text-[11px] text-white backdrop-blur transition-opacity ${
                on ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
              }`;
              return (
                <div
                  key={f.name}
                  className={`group relative overflow-hidden rounded-md border bg-linear-bg transition-colors ${
                    on ? "border-linear-accent" : "border-linear-border hover:border-linear-bg-active"
                  }`}
                >
                  <button
                    type="button"
                    aria-label={on ? "Deselect" : "Select"}
                    onClick={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        on ? n.delete(f.name) : n.add(f.name);
                        return n;
                      })
                    }
                    className={`${overlay} left-1.5 w-6 ${on ? "border-linear-accent bg-linear-accent" : "border-white/30 bg-black/50"}`}
                  >
                    {on ? "✓" : ""}
                  </button>
                  <button
                    type="button"
                    aria-label="More"
                    onClick={(e) => openMenu(e, f.name)}
                    className={`${overlay} right-1.5 w-7 border-white/30 bg-black/50`}
                  >
                    ···
                  </button>
                  {vid ? (
                    // controlsList/disablePictureInPicture empty Chrome's own ⋮ menu,
                    // leaving the card's menu as the only one.
                    <video
                      src={fileUrl(f.name)}
                      controls
                      preload="metadata"
                      controlsList="nodownload noplaybackrate noremoteplayback"
                      disablePictureInPicture
                      className="block aspect-video w-full bg-black object-contain"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(f.name)} alt={f.name} loading="lazy" className="block aspect-video w-full bg-black object-contain" />
                  )}
                  <button type="button" onClick={() => setPropsFor(f.name)} className="block w-full px-2.5 py-2 text-left">
                    <div className="truncate font-mono text-[11px] text-linear-text" title={f.name}>
                      {f.name}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-linear-text-tertiary">
                      {new Date(f.mtime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {f.meta?.width ? ` · ${f.meta.width}×${f.meta.height}` : ""}
                      {f.meta?.duration != null ? ` · ${secs(f.meta.duration)}` : ""}
                      {` · ${mb(f.size)}`}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap justify-between gap-2 px-1 font-mono text-[10px] text-linear-text-tertiary">
        <span>poll 3s · backend render-studio/h3-dashboard.py on the Mac</span>
        <span>outputs ~/ai/ComfyUI/output</span>
      </div>

      {/* ---------- card menu ---------- */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 w-[190px] rounded-lg border border-linear-border bg-linear-bg-secondary p-1 shadow-linear-lg"
            style={{ left: menu.left, top: menu.top }}
          >
            {(
              [
                ["Properties", () => setPropsFor(menu.name)],
                ["Open in new tab", null],
                ["Download", null],
                ["Delete", () => doDelete([menu.name])],
              ] as [string, (() => void) | null][]
            ).map(([label, fn]) =>
              fn ? (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setMenu(null); fn(); }}
                  className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-linear-bg-tertiary ${
                    label === "Delete" ? "text-amber-400" : "text-linear-text"
                  }`}
                >
                  {label}
                </button>
              ) : (
                <a
                  key={label}
                  href={fileUrl(menu.name)}
                  target={label === "Download" ? undefined : "_blank"}
                  rel="noopener"
                  download={label === "Download" ? menu.name : undefined}
                  onClick={() => setMenu(null)}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-linear-text hover:bg-linear-bg-tertiary"
                >
                  {label}
                </a>
              )
            )}
          </div>
        </>
      )}

      {/* ---------- properties sheet ---------- */}
      {propsFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => e.target === e.currentTarget && setPropsFor(null)}
        >
          <PropsSheet f={propsFile} onClose={() => setPropsFor(null)} onDelete={() => doDelete([propsFile.name])} />
        </div>
      )}
    </div>
  );
}

// ---------- live card ----------

function LiveCard({
  r,
  etaLeft,
  promptOpen,
  onTogglePrompt,
  onCancel,
  cancelling,
}: {
  r: Running;
  etaLeft: number | null;
  promptOpen: boolean;
  onTogglePrompt: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const dec = r.phase === "decoding";
  // h3.c reports its pre/post-denoise counters as stage_*; ComfyUI reports its
  // detection pass as detect_*. Either is real progress and drives the bar, so a
  // long pre-stage never reads as a dead bar saying "starting…".
  const preStage = r.step == null && (r.detected != null || r.stage_cur != null);
  const pct = preStage ? r.detect_pct ?? r.stage_pct ?? 0 : r.pct ?? 0;
  const where =
    r.step != null
      ? `step ${r.step} / ${r.steps}`
      : r.stage_cur != null
      ? `${r.stage_label || "stage"} ${r.stage_cur} / ${r.stage_total}`
      : preStage
      ? `frame ${r.detected}${r.detect_total ? ` / ${r.detect_total}` : ""}`
      : r.phase === "loading"
      ? "loading model…"
      : "starting…";
  const cell = (k: string, v: ReactNode) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] text-linear-text-tertiary">{k}</div>
      <div className="mt-0.5 truncate font-mono text-xs tabular-nums text-linear-text">{v}</div>
    </div>
  );
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm text-linear-text">{r.prefix || "render"}</span>
          <Chip tone="busy">{r.mode || "?"}</Chip>
          {r.refs ? <Chip tone="off">{r.refs} refs · {r.ref_size || ""}</Chip> : null}
          {dec && <Chip tone="warn">decoding</Chip>}
          {r.step == null && r.phase && r.phase !== "sampling" && !dec && <Chip tone="off">{r.phase}</Chip>}
        </div>
        <div className="text-right">
          <span className="font-mono text-xl font-semibold tabular-nums text-linear-text">{etaLeft != null ? hms(etaLeft) : "—"}</span>
          <span className="ml-1.5 text-[10px] uppercase tracking-[0.16em] text-linear-text-tertiary">left</span>
        </div>
      </div>

      <div>
        <div className="h-1 overflow-hidden rounded-full bg-linear-bg-tertiary">
          <div
            className={`h-full rounded-full transition-all duration-700 ${dec ? "bg-amber-400" : "bg-violet-500"}`}
            style={{ width: `${Math.max(2, dec ? 100 : pct)}%` }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-linear-text-tertiary">
          <span>{where}</span>
          <span>
            {r.s_per_step ? `${Math.round(r.s_per_step)} s/step` : ""}
            {r.elapsed ? ` · elapsed ${r.elapsed}` : ""}
            {r.eta_note ? ` · ${r.eta_note}` : ""}
          </span>
        </div>
      </div>

      {r.prompt && (
        <div>
          <p className={`whitespace-pre-wrap text-xs leading-relaxed text-linear-text-secondary ${promptOpen ? "" : "line-clamp-2"}`}>{r.prompt}</p>
          {r.prompt.length > 150 && (
            <button type="button" onClick={onTogglePrompt} className="mt-1 text-[11px] font-medium text-linear-accent hover:text-linear-accent-hover">
              {promptOpen ? "Show less" : "Show full prompt"}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 border-t border-linear-border pt-3 sm:grid-cols-5">
        {cell("canvas", r.width ? `${r.width}×${r.height}` : "—")}
        {cell("length", r.frames ? `${r.frames} fr · ${r.seconds}s` : "—")}
        {cell("steps", r.steps ?? "—")}
        {cell("cfg", r.cfg ?? "—")}
        {cell("seed", r.seed ?? "—")}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linear-border pt-3">
        <span className="text-[11px] text-linear-text-tertiary">h3.c writes the video only at the end — stopping discards everything so far.</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className={`${SMALL_BTN} border-red-500/50 text-red-400 hover:bg-red-500 hover:text-white`}
        >
          {cancelling ? "Stopping…" : "Stop render"}
        </button>
      </div>
    </div>
  );
}

// ---------- serving panel ----------

function Row({
  tone,
  pulse,
  title,
  detail,
  children,
}: {
  tone: "ok" | "warn" | "off" | "busy";
  pulse?: boolean;
  title: string;
  detail: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3">
      <span className="pt-1.5">
        <Dot tone={tone} pulse={pulse} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-linear-text">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-linear-text-tertiary">{detail}</div>
      </div>
      {children && <div className="flex flex-none gap-1.5">{children}</div>}
    </div>
  );
}

function ServingPanel({
  s,
  rendering,
  busy,
  keepModel,
  logOpen,
  onToggleLog,
  onStartStop,
  onUnpin,
  onGuard,
  onPrepare,
}: {
  s: Serving;
  rendering: boolean;
  busy: boolean;
  keepModel: string;
  logOpen: boolean;
  onToggleLog: () => void;
  onStartStop: (a: "start" | "stop") => void;
  onUnpin: () => void;
  onGuard: (on: boolean) => void;
  onPrepare: () => void;
}) {
  const up = s.gate && s.swap;
  const part = (s.gate || s.swap) && !up;
  const state = s.busy ? (s.last_action === "stop" ? "Stopping…" : "Starting…") : up ? "Running" : part ? "Partially up" : "Stopped";
  const detail = s.busy
    ? "this takes 15–60 s"
    : up
    ? `${s.ram_gb != null ? `${s.ram_gb} GB held` : "serving"}`
    : part
    ? `gate ${s.gate ? "up" : "down"} · swap ${s.swap ? "up" : "down"} — try Stop, then Start`
    : "no memory held by models";
  const allowed = (s.render_allowed || []).join(", ") || "small models";
  const off = busy || !!s.busy;

  return (
    <div className="divide-y divide-linear-border">
      <div>
        <Row tone={s.busy ? "busy" : up ? "ok" : "warn"} pulse={!!s.busy} title={state} detail={detail}>
          {up || s.gate || s.swap ? (
            <button type="button" className={AMBER_BTN} disabled={off} onClick={() => onStartStop("stop")}>Stop</button>
          ) : null}
          {!up && (
            <button type="button" className={GREEN_BTN} disabled={off} onClick={() => onStartStop("start")}>Start</button>
          )}
        </Row>
        {s.models && s.models.length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1 px-4 pb-3 pl-[34px]">
            {s.models.map((m) => (
              <span key={m} className="rounded border border-linear-border bg-linear-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-linear-text-secondary">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      {up && s.locked && (
        <Row
          tone="ok"
          title={`Pinned: ${s.locked_model || "?"}`}
          detail={`held resident${s.lock_idle_left_min != null ? ` · releases after ${Math.round(s.lock_idle_left_min)} min idle` : ""}`}
        >
          <button type="button" className={AMBER_BTN} disabled={off} onClick={onUnpin}>Unpin</button>
        </Row>
      )}

      {up && (
        <Row
          tone={s.render_guard ? "ok" : "warn"}
          title={s.render_guard ? (s.render_armed ? "Guard armed" : "Render guard on") : "Render guard off"}
          detail={
            s.render_guard
              ? s.render_armed
                ? `only ${allowed} can load · expires in ${Math.max(0, Math.round((s.arm_expires_in_s || 0) / 60))} min`
                : `only ${allowed} can load`
              : "a big model can load mid-render"
          }
        >
          <button type="button" className={s.render_guard ? AMBER_BTN : GREEN_BTN} disabled={off} onClick={() => onGuard(!s.render_guard)}>
            {s.render_guard ? "Release" : "Protect"}
          </button>
        </Row>
      )}

      {up && (
        <div>
          <Row
            tone={s.preparing ? "busy" : "off"}
            pulse={!!s.preparing}
            title={s.preparing ? "Freeing memory…" : "Free memory"}
            detail={<>evicts big models, keeps <span className="font-mono">{keepModel}</span> · ~30 s gap</>}
          >
            <button type="button" className={GHOST_BTN} disabled={off || !!s.preparing} onClick={onPrepare}>
              {s.preparing ? "Working…" : "Free"}
            </button>
          </Row>
          {s.prepare_output && (
            <pre className="mx-4 mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-linear-border bg-linear-bg p-2.5 font-mono text-[10px] leading-relaxed text-linear-text-tertiary">
              {s.prepare_output}
            </pre>
          )}
        </div>
      )}

      {rendering && !up && (
        <div className="px-4 py-2.5 text-[11px] text-amber-400">A render is running — starting the LLMs now will contend for memory.</div>
      )}

      {s.last_output && (
        <div className="px-4 py-2.5">
          <button type="button" onClick={onToggleLog} className="text-[11px] font-medium text-linear-accent hover:text-linear-accent-hover">
            {logOpen ? "Hide last output ▴" : "Show last output ▾"}
          </button>
          {logOpen && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-linear-border bg-linear-bg p-2.5 font-mono text-[10px] leading-relaxed text-linear-text-tertiary">
              {s.last_output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- properties sheet ----------

function PropsSheet({ f, onClose, onDelete }: { f: Output; onClose: () => void; onDelete: () => void }) {
  const m = f.meta || {};
  const r: Recipe = (m as any).recipe || {};
  const rows: [string, string][] = [];
  // Unknown fields are left out rather than shown as a dash, so every row
  // present is a fact read off the file.
  const add = (k: string, v: unknown) => {
    if (v != null && v !== "") rows.push([k, String(v)]);
  };
  add("File", f.name);
  add("Modified", new Date(f.mtime * 1000).toLocaleString());
  add("Size", mb(f.size));
  add("Resolution", m.width ? `${m.width} × ${m.height}` : null);
  add("Duration", m.duration != null ? secs(m.duration) : null);
  add("Frames", m.frames ? `${m.frames}${m.fps ? ` at ${m.fps} fps` : ""}` : null);
  add("Video", m.vcodec);
  add(
    "Audio",
    m.acodec
      ? `${m.acodec}${m.channels ? ` · ${m.channels} ch` : ""}${m.sample_rate ? ` · ${m.sample_rate / 1000} kHz` : ""}`
      : m.vcodec && m.duration != null
      ? "none"
      : null
  );
  add("Pipeline", r.mode);
  add("Engine", r.engine);
  add("Quality preset", r.preset);
  add("Steps", r.steps);
  add("Layers", r.layers ? `${r.layers} of 50` : null);
  add("Reuse", r.reuse);
  add("cfg", r.cfg);
  add("Seed", r.seed);
  add("References", r.refs ? `${r.refs}${r.ref_size ? ` · ${r.ref_size} detail` : ""}` : null);
  add("Output name", r.prefix);

  return (
    <div role="dialog" aria-modal="true" aria-label="Properties" className="max-h-[84vh] w-full max-w-md overflow-auto rounded-lg border border-linear-border bg-linear-bg-secondary p-5 shadow-linear-lg">
      <div className="text-sm font-medium text-linear-text">Properties</div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-linear-text-tertiary">{k}</dt>
            <dd className="break-words font-mono tabular-nums text-linear-text">{v}</dd>
          </div>
        ))}
      </dl>
      {!f.meta && <p className="mt-3 text-[11px] text-linear-text-tertiary">Still reading this file — reopen in a moment.</p>}
      {r.prompt && (
        <div className="mt-4 border-t border-linear-border pt-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-linear-text-tertiary">Prompt</div>
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-linear-text-secondary">{r.prompt}</p>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onDelete} className={AMBER_BTN}>
          Delete
        </button>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Close
        </button>
      </div>
    </div>
  );
}
