"use client";

// BlinkDashboard — live camera security panel. Talks to the Mac-side Blink
// bridge (blinkclient/bridge.py, :8766) through /api/blink/[...path]: status +
// local 30-day clip archive, thumbnails, scrubable video playback, arm/disarm,
// snap, archive sync. All state is live from the bridge — no file mirroring.
//
// Visual language: same Linear-dark style as LlamaSwapDashboard. Armed state
// is the single source of color emphasis (green halo); clips grid is dense,
// thumbnails first-class; actions (arm/snap/sync) are one-click with spinner.

import { useCallback, useEffect, useRef, useState } from "react";

type Camera = {
  id: number | string;
  name: string;
  battery?: string | null;
  battery_voltage?: number | null;
  wifi?: number | string | null;
  temp?: number | string | null;
  fw?: string | null;
  status?: string | null;
  thumbnail?: string | null;
  /** When the latest snapshot (Snap or motion) was taken; the bridge serves
   *  the image at /media/camera/<id>.jpg. */
  thumbnail_ts?: number | null;
};

type SyncModule = {
  id: number | string;
  name?: string;
  status?: string | null;
  local_storage?: { status?: string | null; used?: string | null; free?: string | null };
};

// Shape of the bridge's GET /api/status.
type Status = {
  network?: string | null;
  network_id?: number | string | null;
  armed?: boolean | null;
  homescreen?: { cameras?: Camera[]; sync_modules?: SyncModule[] };
  archive?: {
    clips: number;
    bytes: number;
    oldest_ts?: number | null;
    newest_ts?: number | null;
    retention_days: number;
    archiver_running: boolean;
    last_run_ts?: number | null;
  };
  bridge_ts?: number;
  error?: string;
};

type Clip = {
  id: number | string;
  device: string;
  created_ts: number;
  size: number;
  cv_detection?: string[];
  duration?: number | null;
};

const API = "/api/blink";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

function fmtWhen(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtAgo(ts?: number | null): string {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type LiveState = { running: boolean; ready: boolean; error?: string | null };

// Live view. The bridge wakes the camera and turns Blink's stream into HLS;
// Safari plays that natively, elsewhere hls.js does. The bridge ends the
// stream ~20 s after the player stops fetching it, so a closed tab doesn't
// keep draining the camera's battery.
function LivePlayer({ camId, onClose }: { camId: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<"starting" | "playing" | "ended" | "error">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let ended = false;
    let attached = false;
    let hls: { destroy: () => void } | null = null;
    let sawError = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const video = videoRef.current;

    const fail = (text: string) => {
      ended = true;
      sawError = true;
      if (cancelled) return;
      setPhase("error");
      setMessage(text);
    };

    const attach = async () => {
      if (!video) return;
      const src = `${API}/media/live/${camId}/live.m3u8`;
      // Safari: native HLS. Chrome/Edge/Firefox: hls.js. Chrome *advertises*
      // HLS support in canPlayType() but its demuxer cannot parse a live
      // rolling playlist (+omit_endlist) and dies with
      // DEMUXER_ERROR_COULD_NOT_PARSE (crbug.com/1072328), so feature
      // detection alone picks a broken path there — Hls.isSupported() must
      // win in every non-Safari engine.
      const ua = navigator.userAgent;
      const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
      if (isSafari) {
        video.src = src;
        video.play().catch(() => {
          /* autoplay refused: the controls are there */
        });
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      const h = new Hls({ liveSyncDurationCount: 1, liveMaxLatencyDurationCount: 3 });
      h.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          sawError = true;
          hls?.destroy();
          hls = null;
          fail(data.details || "HLS playback error");
        }
      });
      h.loadSource(src);
      h.attachMedia(video);
      hls = h;
      video.play().catch(() => {
        /* autoplay refused: the controls are there */
      });
    };

    // Poll the session: every second until the first segment exists, then
    // every few seconds to notice when Blink ends it.
    const tick = async () => {
      try {
        const s = await api<LiveState>(`/api/live/${camId}`);
        if (cancelled) return;
        if (!s.running) {
          ended = true;
          if (s.error) fail(s.error);
          else setPhase("ended");
          return;
        }
        if (s.ready && !attached) {
          attached = true;
          await attach();
          if (!cancelled) setPhase("playing");
        }
      } catch (e: any) {
        return fail(e?.message || "live view failed");
      }
      if (!cancelled) timer = setTimeout(tick, attached ? 5_000 : 1_000);
    };

    api(`/api/live/${camId}/start`, { method: "POST" }).then(tick, (e) =>
      fail(e?.message || "could not start live view")
    );

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      hls?.destroy();
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
      // An ended session needs no stop — and a stop racing a restart's start
      // could end the new one.
      if (!ended) {
        fetch(`${API}/api/live/${camId}/stop`, { method: "POST", keepalive: true }).catch(() => {});
      }
    };
  }, [camId, attempt]);

  return (
    <div className="mt-2">
      <div className="relative">
        <video ref={videoRef} muted playsInline autoPlay controls className="aspect-video w-full rounded bg-black" />
        {phase !== "playing" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-black/70 p-3 text-center text-xs text-zinc-300">
            {phase === "starting" ? "Waking the camera… (~15 s)" : null}
            {phase === "ended" ? "Live view ended" : null}
            {phase === "error" ? <span className="text-red-300">Live view failed: {message}</span> : null}
            {phase === "ended" || phase === "error" ? (
              <button
                onClick={() => {
                  setPhase("starting");
                  setMessage(null);
                  setAttempt((a) => a + 1);
                }}
                className="rounded-md bg-linear-bg-tertiary px-3 py-1 text-xs font-medium text-linear-text hover:bg-linear-bg-hover"
              >
                Restart
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-linear-text-tertiary">
        <span>{phase === "playing" ? "● Live · a few seconds behind · up to 5 min" : "Live view"}</span>
        <button onClick={onClose} className="rounded px-2 py-0.5 text-linear-text-secondary hover:bg-linear-bg-hover">
          Close
        </button>
      </div>
    </div>
  );
}

export default function BlinkDashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [total, setTotal] = useState(0);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [liveCam, setLiveCam] = useState<string | null>(null);
  const [openClip, setOpenClip] = useState<Clip | null>(null);
  const [filterPerson, setFilterPerson] = useState(false);
  const armedPrev = useRef<boolean | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api<Status>("/api/status");
      setStatus(s);
      setStatusErr(null);
    } catch (e: any) {
      setStatusErr(e?.message || "status failed");
    }
  }, []);

  const loadClips = useCallback(async (before?: number) => {
    setClipsLoading(true);
    try {
      const q = new URLSearchParams({ limit: "60" });
      if (before) q.set("before", String(before));
      const d = await api<{ clips: Clip[]; total: number }>(`/api/clips?${q}`);
      setClips((prev) => (before ? [...prev, ...d.clips] : d.clips));
      setTotal(d.total);
    } catch {
      /* status panel shows connectivity errors */
    } finally {
      setClipsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadClips();
    const t = setInterval(loadStatus, 30_000);
    return () => clearInterval(t);
  }, [loadStatus, loadClips]);

  // if armed state flips (e.g. from another app), refresh clips list too
  useEffect(() => {
    const now = status?.armed ?? null;
    if (now !== null && armedPrev.current !== null && now !== armedPrev.current) {
      loadClips();
    }
    armedPrev.current = now;
  }, [status?.armed, loadClips]);

  // What the last action did, shown under the header for a few seconds.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 10_000);
    return () => clearTimeout(t);
  }, [notice]);

  const act = useCallback(
    async (kind: "arm" | "disarm" | "snap" | "sync") => {
      setBusy(kind);
      setNotice(null);
      try {
        if (kind === "sync") {
          const before = status?.archive?.clips ?? 0;
          await api("/api/sync", { method: "POST" });
          // The archiver runs in the background; follow it until it's done.
          let s: Status | null = null;
          for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 3_000));
            s = await api<Status>("/api/status");
            setStatus(s);
            if (!s.archive?.archiver_running) break;
          }
          await loadClips();
          const added = (s?.archive?.clips ?? before) - before;
          setNotice({
            ok: true,
            text: s?.archive?.archiver_running
              ? "Sync is still running in the background"
              : added > 0
                ? `Sync done — ${added} new clip${added === 1 ? "" : "s"}`
                : "Sync done — no new clips",
          });
        } else if (kind === "snap") {
          const r = await api<{ ok: boolean; results?: { camera: string; ok: boolean; error?: string }[] }>(
            "/api/snap",
            { method: "POST" }
          );
          await loadStatus();
          const failed = (r.results || []).filter((x) => !x.ok);
          setNotice(
            r.ok
              ? { ok: true, text: "Snapshot taken" }
              : { ok: false, text: `Snap failed: ${failed.map((f) => `${f.camera}: ${f.error}`).join("; ") || "no cameras"}` }
          );
        } else {
          await api("/api/arm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ armed: kind === "arm" }),
          });
          await loadStatus();
          setNotice({ ok: true, text: kind === "arm" ? "System armed" : "System disarmed" });
        }
      } catch (e: any) {
        setNotice({ ok: false, text: e?.message || `${kind} failed` });
      } finally {
        setBusy(null);
      }
    },
    [status?.archive?.clips, loadStatus, loadClips]
  );

  const armed = status?.armed === true;
  const shown = filterPerson ? clips.filter((c) => (c.cv_detection || []).includes("person")) : clips;
  const arch = status?.archive;
  const cams = status?.homescreen?.cameras || [];
  const syncs = status?.homescreen?.sync_modules || [];

  return (
    <div className="flex flex-col gap-4">
      {/* header: network + armed + archive strip + actions */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${statusErr || status?.error ? "bg-amber-500" : armed ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-zinc-500"}`}
          />
          <span className="text-sm font-medium text-linear-text">
            {status?.network || "Blink"}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              armed ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"
            }`}
          >
            {armed ? "Armed" : "Disarmed"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => act(armed ? "disarm" : "arm")}
            disabled={!!busy || !!statusErr}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              armed
                ? "bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20"
                : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
            }`}
          >
            {busy === "arm" || busy === "disarm" ? "…" : armed ? "Disarm" : "Arm"}
          </button>
          <button
            onClick={() => act("snap")}
            disabled={!!busy || !!statusErr || !cams.length}
            className="rounded-md bg-linear-bg-tertiary px-3 py-1.5 text-xs font-medium text-linear-text hover:bg-linear-bg-hover disabled:opacity-50"
          >
            {busy === "snap" ? "…" : "Snap"}
          </button>
          <button
            onClick={() => act("sync")}
            disabled={!!busy || !!statusErr || !!arch?.archiver_running}
            className="rounded-md bg-linear-bg-tertiary px-3 py-1.5 text-xs font-medium text-linear-text hover:bg-linear-bg-hover disabled:opacity-50"
          >
            {busy === "sync" || arch?.archiver_running ? "Syncing…" : "Sync Now"}
          </button>
        </div>

        <div className="w-full border-t border-linear-border pt-3 text-xs text-linear-text-secondary">
          <span className="text-linear-text-tertiary">Archive</span>{" "}
          <span className="font-mono text-linear-text">{arch ? arch.clips.toLocaleString() : "—"}</span> clips ·{" "}
          <span className="font-mono text-linear-text">{arch ? fmtBytes(arch.bytes) : "—"}</span> ·{" "}
          <span className="text-linear-text-tertiary">{arch?.retention_days ?? 30}-day window</span> · last run{" "}
          {fmtAgo(arch?.last_run_ts ?? null)}
          {arch?.newest_ts ? (
            <>
              {" "}· newest clip {fmtAgo(arch.newest_ts)}
            </>
          ) : null}
        </div>
        {statusErr ? (
          <div className="w-full rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
            {statusErr}
          </div>
        ) : null}
        {notice ? (
          <div
            className={`w-full rounded border px-2 py-1.5 text-xs ${
              notice.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            {notice.text}
          </div>
        ) : null}
      </div>

      {/* camera + sync module health */}
      <div className="flex flex-wrap gap-3">
        {cams.map((cam) => (
          <div
            key={String(cam.id)}
            className="min-w-64 flex-1 rounded-lg border border-linear-border bg-linear-bg-secondary p-3"
          >
            <div className="text-sm font-medium text-linear-text">{cam.name || `Camera ${cam.id}`}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-linear-text-secondary">
              {cam.battery ? <span>Batt <span className="font-mono text-linear-text">{cam.battery}</span></span> : null}
              {cam.wifi != null && cam.wifi !== "" ? <span>WiFi <span className="font-mono text-linear-text">{cam.wifi}</span></span> : null}
              {cam.temp != null && cam.temp !== "" ? <span>Temp <span className="font-mono text-linear-text">{cam.temp}</span></span> : null}
              {cam.fw ? <span className="text-linear-text-tertiary">fw {cam.fw}</span> : null}
            </div>
            {liveCam === String(cam.id) ? (
              <LivePlayer camId={String(cam.id)} onClose={() => setLiveCam(null)} />
            ) : (
              <button
                onClick={() => setLiveCam(String(cam.id))}
                disabled={liveCam !== null}
                className="mt-2 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50"
              >
                ● Live
              </button>
            )}
            {liveCam !== String(cam.id) && cam.thumbnail_ts ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API}/media/camera/${cam.id}.jpg?ts=${cam.thumbnail_ts}`}
                  alt={`Latest snapshot from ${cam.name}`}
                  className="mt-2 aspect-video w-full rounded object-cover"
                />
                <div className="mt-1 text-[10px] text-linear-text-tertiary">
                  Snapshot {fmtAgo(cam.thumbnail_ts)} · {fmtWhen(cam.thumbnail_ts)}
                </div>
              </>
            ) : null}
          </div>
        ))}
        {syncs.map((sm) => (
          <div
            key={String(sm.id)}
            className="min-w-64 flex-1 rounded-lg border border-linear-border bg-linear-bg-secondary p-3"
          >
            <div className="text-sm font-medium text-linear-text">Sync Module</div>
            <div className="mt-1 text-xs text-linear-text-secondary">
              {sm.status || "unknown"}{sm.local_storage?.status ? ` · storage ${sm.local_storage.status}` : ""}
              {sm.local_storage?.used ? ` · ${sm.local_storage.used} used` : ""}
            </div>
          </div>
        ))}
      </div>

      {/* clips grid */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-linear-text-tertiary">
          Clips <span className="ml-1 font-mono normal-case">{total ? `${shown.length}/${total}` : "0"}</span>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-linear-text-secondary">
          <input
            type="checkbox"
            checked={filterPerson}
            onChange={(e) => setFilterPerson(e.target.checked)}
            className="h-3 w-3 accent-emerald-500"
          />
          person only
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((clip) => (
          <button
            key={String(clip.id)}
            onClick={() => setOpenClip(clip)}
            className="group relative overflow-hidden rounded-lg border border-linear-border bg-linear-bg-secondary text-left transition-colors hover:border-linear-text-tertiary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API}/media/thumb/${clip.id}.jpg`}
              alt=""
              loading="lazy"
              className="aspect-video w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
            <div className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-mono text-zinc-200">
              {fmtWhen(clip.created_ts)}
            </div>
            {(clip.cv_detection || []).includes("person") ? (
              <div className="absolute right-1 top-1 rounded bg-emerald-500/80 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">
                person
              </div>
            ) : null}
            <div className="px-1.5 py-1 text-[10px] text-linear-text-tertiary">
              {clip.device} · {fmtBytes(clip.size)}{clip.duration ? ` · ${clip.duration}s` : ""}
            </div>
          </button>
        ))}
        {clipsLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={`sk-${i}`} className="aspect-video animate-pulse rounded-lg bg-linear-bg-tertiary" />
            ))
          : null}
      </div>

      {!clipsLoading && shown.length < total ? (
        <button
          onClick={() => loadClips(shown.length ? shown[shown.length - 1].created_ts : undefined)}
          className="rounded-md border border-linear-border px-4 py-2 text-xs text-linear-text-secondary hover:bg-linear-bg-hover"
        >
          Load more ({total - shown.length} remaining)
        </button>
      ) : null}

      {/* clip modal player */}
      {openClip ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpenClip(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-lg border border-linear-border bg-linear-bg-secondary"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              key={String(openClip.id)}
              src={`${API}/media/clip/${openClip.id}.mp4`}
              controls
              autoPlay
              className="aspect-video w-full bg-black"
            />
            <div className="flex items-center justify-between p-3 text-xs text-linear-text-secondary">
              <span>
                {openClip.device} · {fmtWhen(openClip.created_ts)} · {fmtBytes(openClip.size)}
                {openClip.duration ? ` · ${openClip.duration}s` : ""}
                {(openClip.cv_detection || []).length ? ` · ${(openClip.cv_detection || []).join(", ")}` : ""}
              </span>
              <button
                onClick={() => setOpenClip(null)}
                className="rounded px-2 py-1 text-linear-text hover:bg-linear-bg-hover"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}