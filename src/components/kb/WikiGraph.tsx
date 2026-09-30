"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";
import type { FileMeta, GraphResponse, SimilarityStatus } from "@/lib/kb/types";

/* ── Model ──────────────────────────────────────────────────── */

interface GraphNode {
  name: string;
  file: FileMeta;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
  /** Dragged by the user, so the simulation no longer moves it. */
  pinned: boolean;
}

interface GraphEdge {
  a: GraphNode;
  b: GraphNode;
  /** "link" = a markdown link was written; "similar" = the pages embed close together. */
  kind: "link" | "similar";
  /** a → b link exists (link edges only) */
  ab: boolean;
  /** b → a link exists (link edges only) */
  ba: boolean;
}

interface GraphSettings {
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
  nodeSize: number;
  linkThickness: number;
  textFade: number;
  showArrows: boolean;
  showOrphans: boolean;
  showSimilar: boolean;
}

const DEFAULT_SETTINGS: GraphSettings = {
  centerForce: 0.375,
  repelForce: 2.25,
  linkForce: 1.125,
  linkDistance: 90,
  nodeSize: 1,
  linkThickness: 1,
  textFade: 0.35,
  showArrows: false,
  showOrphans: true,
  showSimilar: true,
};

/** Why the similarity layer is unavailable, phrased for the settings panel. */
const SIMILARITY_NOTE: Partial<Record<SimilarityStatus, string>> = {
  not_built: "Build the search index to see semantic edges.",
  not_installed: "Install faiss-cpu to see semantic edges.",
  disabled: "FAISS is disabled in kb.toml.",
  stale: "Index is out of date — rebuild it for accurate edges.",
  error: "Could not read the search index.",
};
const SETTINGS_KEY = "mission-control:kb:explorer-graph-settings";

const COLOR = {
  bgInner: "#191926",
  bgOuter: "#0a0a0f",
  link: "rgba(167,139,250,0.30)",
  linkDim: "rgba(120,113,150,0.07)",
  linkActive: "rgba(196,181,253,0.85)",
  similar: "rgba(45,212,191,0.26)",
  similarDim: "rgba(80,120,120,0.06)",
  similarActive: "rgba(94,234,212,0.75)",
  node: "#8b83b0",
  nodeDim: "#2f2f3d",
  nodeNeighbor: "#a78bfa",
  nodeActive: "#c4b5fd",
  ring: "#ede9fe",
  pin: "rgba(237,233,254,0.35)",
  text: "#b9b6c9",
  textActive: "#f5f3ff",
  textDim: "#4a4a5c",
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const PAN_MS = 320;

/* ── Component ──────────────────────────────────────────────── */

interface WikiGraphProps {
  files: FileMeta[];
  /** Edges from /api/graph. Null while loading or if the request failed. */
  graph: GraphResponse | null;
  selectedRel: string | null;
  filter: string;
  onSelect: (file: FileMeta) => void;
  onDeselect: () => void;
  /** Width in px of the preview panel overlaying the canvas's right edge. */
  getInsetRight?: () => number;
  /** Set when the file listing failed, so "empty" isn't mistaken for "no pages". */
  loadError?: string | null;
  /** Bumped by the Refresh button; releases every node the user pinned by dragging. */
  resetKey?: number;
}

export function WikiGraph({ files, graph, selectedRel, filter, onSelect, onDeselect, getInsetRight, loadError, resetKey = 0 }: WikiGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState({ nodes: 0, links: 0, similar: 0 });

  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map());
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const alphaRef = useRef(1);
  const alphaTargetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const hoverRef = useRef<GraphNode | null>(null);
  const dragNodeRef = useRef<GraphNode | null>(null);
  const fittedRef = useRef(false);
  const panTweenRef = useRef<{ fx: number; fy: number; tx: number; ty: number; t0: number } | null>(null);
  const settingsRef = useRef(settings);
  const selectedRef = useRef(selectedRel);
  const filterRef = useRef(filter);
  const filesRef = useRef(files);
  filesRef.current = files;
  const graphRef = useRef(graph);
  graphRef.current = graph;

  /* ── Preferences ─────────────────────────────────────────── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {}
  }, []);
  useEffect(() => {
    settingsRef.current = settings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  /* ── Simulation ──────────────────────────────────────────── */

  const tick = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const s = settingsRef.current;
    alphaRef.current += (alphaTargetRef.current - alphaRef.current) * 0.0228;
    const alpha = alphaRef.current;

    const repel = 900 * s.repelForce * alpha;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > 1_000_000) continue;
        // Magnitude falls off as 1/d (d3-force manyBody), so the vector is scaled by 1/d².
        const w = repel / d2;
        const fx = dx * w;
        const fy = dy * w;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      // Scale by 1/min(degree) as d3-force's link does. Without it a hub takes one
      // full-strength impulse per edge each tick and overshoots into divergence.
      const inv = 1 / Math.max(1, Math.min(e.a.deg, e.b.deg));
      const f = ((d - s.linkDistance) / d) * s.linkForce * alpha * 0.5 * inv;
      const fx = dx * f;
      const fy = dy * f;
      e.a.vx += fx;
      e.a.vy += fy;
      e.b.vx -= fx;
      e.b.vy -= fy;
    }

    const c = s.centerForce * alpha * 0.5;
    for (const n of nodes) {
      // Held or pinned nodes still push on their neighbours above, they just
      // don't integrate their own velocity — so they stay put.
      if (n === dragNodeRef.current || n.pinned) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx -= n.x * c;
      n.vy -= n.y * c;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
      // A non-finite position would silently blank the canvas; reseed instead.
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
        n.x = (Math.random() - 0.5) * 400;
        n.y = (Math.random() - 0.5) * 400;
        n.vx = 0;
        n.vy = 0;
      }
    }
  }, []);

  /* ── Rendering ───────────────────────────────────────────── */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const s = settingsRef.current;
    const v = viewRef.current;
    const hover = hoverRef.current;
    const q = filterRef.current.trim().toLowerCase();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Radial vignette so the cluster sits in a pool of light.
    const bg = ctx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height) * 0.75,
    );
    bg.addColorStop(0, COLOR.bgInner);
    bg.addColorStop(1, COLOR.bgOuter);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2 + v.x, height / 2 + v.y);
    ctx.scale(v.k, v.k);

    // Hover wins while the pointer is over a node; otherwise the current selection
    // keeps its neighbourhood highlighted (click to pin, click empty space to clear).
    const selectedNode = selectedRef.current
      ? nodesRef.current.find((n) => n.file.rel === selectedRef.current) ?? null
      : null;
    const focus = hover ?? selectedNode;

    const neighbors = focus ? neighborsRef.current.get(focus.name) : null;
    const isLit = (n: GraphNode) =>
      !focus || n === focus || (neighbors?.has(n.name) ?? false);
    const matches = (n: GraphNode) =>
      !q || n.label.toLowerCase().includes(q) || n.name.toLowerCase().includes(q);

    /* edges */
    // Clamped in screen pixels so links stay hairlines when zoomed out and don't
    // turn into ribbons when zoomed in.
    ctx.lineWidth = Math.min(Math.max(s.linkThickness, 0.7 / v.k), 2.5 / v.k);
    // Similar edges first so the authored links read on top of them, and dashed
    // so the two kinds of relation stay distinguishable when colour is dimmed.
    for (const pass of ["similar", "link"] as const) {
      ctx.setLineDash(pass === "similar" ? [4 / v.k, 4 / v.k] : []);
      for (const e of edgesRef.current) {
        if (e.kind !== pass) continue;
        const active = focus != null && (e.a === focus || e.b === focus);
        const dim = (focus != null && !active) || (!!q && !matches(e.a) && !matches(e.b));
        ctx.strokeStyle =
          pass === "similar"
            ? active ? COLOR.similarActive : dim ? COLOR.similarDim : COLOR.similar
            : active ? COLOR.linkActive : dim ? COLOR.linkDim : COLOR.link;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
        if (s.showArrows && pass === "link") {
          if (e.ab) drawArrow(ctx, e.a, e.b, radiusOf(e.b, s, v.k), ctx.strokeStyle);
          if (e.ba) drawArrow(ctx, e.b, e.a, radiusOf(e.a, s, v.k), ctx.strokeStyle);
        }
      }
    }
    ctx.setLineDash([]);

    /* nodes */
    for (const n of nodesRef.current) {
      const r = radiusOf(n, s, v.k);
      const isSelected = n.file.rel === selectedRef.current;
      const lit = isLit(n);
      const hit = matches(n);
      let fill = COLOR.node;
      let glow = r * 0.9;
      if (isSelected) { fill = COLOR.nodeActive; glow = r * 3; }
      else if (focus && lit) {
        fill = n === focus ? COLOR.nodeActive : COLOR.nodeNeighbor;
        glow = r * (n === focus ? 3 : 2);
      } else if (!lit || !hit) { fill = COLOR.nodeDim; glow = 0; }
      else if (q && hit) { fill = COLOR.nodeNeighbor; glow = r * 2; }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.shadowBlur = Math.min(glow, 14 / v.k); // cap the halo at ~14 screen px
      ctx.shadowColor = fill;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3.5 / v.k, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 / v.k;
        ctx.strokeStyle = COLOR.ring;
        ctx.stroke();
      } else if (n.pinned) {
        // Quiet marker so a hand-placed node is identifiable without competing
        // with the selection ring.
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2.5 / v.k, 0, Math.PI * 2);
        ctx.lineWidth = 1 / v.k;
        ctx.strokeStyle = COLOR.pin;
        ctx.stroke();
      }
    }

    /* labels */
    const fade = Math.min(1, Math.max(0, (v.k - s.textFade) / 0.15));
    if (fade > 0.02 || hover || selectedRef.current) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // Clamp the on-screen size: readable at the default fit zoom, never gigantic zoomed in.
      const fontWorld = Math.min(Math.max(11, 9 / v.k), 16 / v.k);
      ctx.font = `500 ${fontWorld}px system-ui, -apple-system, Segoe UI, sans-serif`;
      // Dark halo keeps labels legible where they cross links and other nodes.
      ctx.shadowColor = "rgba(6,6,12,0.95)";
      ctx.shadowBlur = 4 / v.k;
      for (const n of nodesRef.current) {
        const isSelected = n.file.rel === selectedRef.current;
        const forced = n === focus || isSelected;
        const alpha = forced ? 1 : fade;
        if (alpha <= 0.02) continue;
        const lit = isLit(n);
        const hit = matches(n);
        ctx.globalAlpha = alpha * (lit && hit ? 1 : 0.35);
        ctx.fillStyle = forced ? COLOR.textActive : lit && hit ? COLOR.text : COLOR.textDim;
        ctx.fillText(truncate(n.label, 28), n.x, n.y + radiusOf(n, s, v.k) + 4 / v.k);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }, []);

  const ensureLoop = useCallback(() => {
    if (rafRef.current != null) return;
    const frame = () => {
      rafRef.current = null;
      const settling = alphaRef.current > 0.005 || alphaTargetRef.current > 0;
      if (settling) tick();

      const tw = panTweenRef.current;
      if (tw) {
        const p = Math.min(1, (performance.now() - tw.t0) / PAN_MS);
        const e = 1 - Math.pow(1 - p, 3);
        viewRef.current.x = tw.fx + (tw.tx - tw.fx) * e;
        viewRef.current.y = tw.fy + (tw.ty - tw.fy) * e;
        if (p >= 1) panTweenRef.current = null;
      }

      if (!fittedRef.current && alphaRef.current < 0.08 && nodesRef.current.length > 0) {
        fittedRef.current = true;
        fitView(false);
      }
      draw();
      if (settling || panTweenRef.current) {
        rafRef.current = requestAnimationFrame(frame);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, draw]);

  const reheat = useCallback(
    (alpha = 0.5) => {
      alphaRef.current = Math.max(alphaRef.current, alpha);
      ensureLoop();
    },
    [ensureLoop],
  );

  const fitView = useCallback(
    (redraw = true) => {
      const nodes = nodesRef.current;
      const { width, height } = sizeRef.current;
      if (nodes.length === 0 || width === 0) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
      const pad = 60;
      const bw = Math.max(1, maxX - minX) + pad * 2;
      const bh = Math.max(1, maxY - minY) + pad * 2;
      // Cap the fit so a two-node graph doesn't fill the pane with giant circles.
      const k = Math.min(1.5, Math.max(MIN_ZOOM, Math.min(width / bw, height / bh)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      viewRef.current = { k, x: -cx * k, y: -cy * k };
      if (redraw) ensureLoop();
    },
    [ensureLoop],
  );

  /* ── Graph build ─────────────────────────────────────────── */

  const signature = useMemo(
    () =>
      files.map((f) => f.name).join("|") +
      "#" +
      (graph?.edges ?? [])
        .map((e) => `${e.type[0]}${e.a}>${e.b}`)
        .join(","),
    [files, graph],
  );

  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.name, n]));
    const all: GraphNode[] = filesRef.current.map((f) => {
      const p = prev.get(f.name);
      return {
        name: f.name,
        file: f,
        label: f.title || f.name.replace(/\.md$/i, ""),
        x: p?.x ?? NaN,
        y: p?.y ?? NaN,
        vx: 0,
        vy: 0,
        deg: 0,
        // Survives a rebuild: recompiling shouldn't scatter a layout the user
        // arranged by hand. Only Refresh clears pins.
        pinned: p?.pinned ?? false,
      };
    });
    const byName = new Map(all.map((n) => [n.name, n]));

    // The API already dedupes within each edge type and orders every pair
    // a < b, so one map keyed by the pair collapses the two layers. Where a
    // pair has both, the explicit link wins: it's the stronger claim.
    const edgeMap = new Map<string, GraphEdge>();
    for (const e of graphRef.current?.edges ?? []) {
      if (e.type === "similar" && !settings.showSimilar) continue;
      const a = byName.get(e.a);
      const b = byName.get(e.b);
      if (!a || !b || a === b) continue;
      const key = `${e.a}|${e.b}`;
      if (edgeMap.get(key)?.kind === "link") continue;
      edgeMap.set(
        key,
        e.type === "link"
          ? { a, b, kind: "link", ab: e.ab, ba: e.ba }
          : { a, b, kind: "similar", ab: false, ba: false },
      );
    }

    const edges = [...edgeMap.values()];
    for (const e of edges) {
      e.a.deg += 1;
      e.b.deg += 1;
    }

    const nodes = settings.showOrphans ? all : all.filter((n) => n.deg > 0);
    const kept = new Set(nodes.map((n) => n.name));
    const keptEdges = edges.filter((e) => kept.has(e.a.name) && kept.has(e.b.name));

    // Seed fresh nodes on a phyllotaxis spiral so the layout unfolds evenly.
    const spiralStep = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((n, i) => {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
        const r = 30 * Math.sqrt(0.5 + i);
        n.x = r * Math.cos(i * spiralStep);
        n.y = r * Math.sin(i * spiralStep);
      }
    });

    const neighbors = new Map<string, Set<string>>();
    for (const n of nodes) neighbors.set(n.name, new Set());
    for (const e of keptEdges) {
      neighbors.get(e.a.name)?.add(e.b.name);
      neighbors.get(e.b.name)?.add(e.a.name);
    }

    nodesRef.current = nodes;
    edgesRef.current = keptEdges;
    neighborsRef.current = neighbors;
    hoverRef.current = null;
    if (prev.size === 0) fittedRef.current = false;
    setStats({
      nodes: nodes.length,
      links: keptEdges.filter((e) => e.kind === "link").length,
      similar: keptEdges.filter((e) => e.kind === "similar").length,
    });
    reheat(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, settings.showOrphans, settings.showSimilar]);

  /* ── External state → redraw ─────────────────────────────── */

  useEffect(() => {
    selectedRef.current = selectedRel;
    // Nudge the view if the preview panel (or the viewport edge) hides the selection.
    const node = selectedRel ? nodesRef.current.find((n) => n.file.rel === selectedRel) : null;
    if (node) {
      const { width, height } = sizeRef.current;
      const v = viewRef.current;
      const margin = 70;
      const right = width - (getInsetRight?.() ?? 0) - margin;
      const sx = width / 2 + v.x + node.x * v.k;
      const sy = height / 2 + v.y + node.y * v.k;
      let dx = 0;
      let dy = 0;
      if (sx > right) dx = right - sx;
      else if (sx < margin) dx = margin - sx;
      if (sy > height - margin) dy = height - margin - sy;
      else if (sy < margin) dy = margin - sy;
      if (dx !== 0 || dy !== 0) {
        panTweenRef.current = { fx: v.x, fy: v.y, tx: v.x + dx, ty: v.y + dy, t0: performance.now() };
      }
    }
    ensureLoop();
  }, [selectedRel, ensureLoop, getInsetRight]);
  useEffect(() => {
    filterRef.current = filter;
    ensureLoop();
  }, [filter, ensureLoop]);
  // Refresh releases the hand-placed nodes and lets the layout settle again.
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    for (const n of nodesRef.current) n.pinned = false;
    reheat(0.6);
  }, [resetKey, reheat]);
  useEffect(() => {
    reheat(0.4);
  }, [settings, reheat]);

  /* ── Sizing ──────────────────────────────────────────────── */

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ensureLoop();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ensureLoop]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  /* ── Pointer interaction ─────────────────────────────────── */

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const { width, height } = sizeRef.current;
    return {
      x: (clientX - rect.left - width / 2 - v.x) / v.k,
      y: (clientY - rect.top - height / 2 - v.y) / v.k,
    };
  }, []);

  const nodeAt = useCallback(
    (clientX: number, clientY: number): GraphNode | null => {
      const p = toWorld(clientX, clientY);
      const s = settingsRef.current;
      const k = viewRef.current.k;
      const slop = 4 / k;
      let best: GraphNode | null = null;
      let bestD = Infinity;
      for (const n of nodesRef.current) {
        const r = radiusOf(n, s, k) + slop;
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d <= r && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    },
    [toWorld],
  );

  const pointerState = useRef({ down: false, moved: 0, lastX: 0, lastY: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointerState.current = { down: true, moved: 0, lastX: e.clientX, lastY: e.clientY };
      const hit = nodeAt(e.clientX, e.clientY);
      if (hit) {
        dragNodeRef.current = hit;
        alphaTargetRef.current = 0.3;
        reheat(0.3);
      }
    },
    [nodeAt, reheat],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const st = pointerState.current;
      const canvas = e.currentTarget;
      if (!st.down) {
        const hit = nodeAt(e.clientX, e.clientY);
        if (hit !== hoverRef.current) {
          hoverRef.current = hit;
          canvas.style.cursor = hit ? "pointer" : "grab";
          ensureLoop();
        }
        return;
      }
      const dx = e.clientX - st.lastX;
      const dy = e.clientY - st.lastY;
      st.moved += Math.abs(dx) + Math.abs(dy);
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      const node = dragNodeRef.current;
      if (node) {
        const p = toWorld(e.clientX, e.clientY);
        node.x = p.x;
        node.y = p.y;
        node.vx = 0;
        node.vy = 0;
        reheat(0.3);
      } else {
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        canvas.style.cursor = "grabbing";
        ensureLoop();
      }
    },
    [nodeAt, toWorld, reheat, ensureLoop],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const st = pointerState.current;
      const node = dragNodeRef.current;
      const clicked = st.down && st.moved < 5;
      st.down = false;
      dragNodeRef.current = null;
      alphaTargetRef.current = 0;
      e.currentTarget.style.cursor = hoverRef.current ? "pointer" : "grab";
      if (clicked) {
        if (node) onSelect(node.file);
        else onDeselect();
      } else if (node) {
        // A real drag places the node deliberately — leave it where it was put
        // instead of letting the simulation pull it back to equilibrium.
        node.pinned = true;
      }
      ensureLoop();
    },
    [onSelect, onDeselect, ensureLoop],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const { width, height } = sizeRef.current;
      const px = e.clientX - rect.left - width / 2;
      const py = e.clientY - rect.top - height / 2;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-e.deltaY * 0.0015)));
      const ratio = k / v.k;
      v.x = px - (px - v.x) * ratio;
      v.y = py - (py - v.y) * ratio;
      v.k = k;
      ensureLoop();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [ensureLoop]);

  const zoomBy = useCallback(
    (factor: number) => {
      const v = viewRef.current;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const ratio = k / v.k;
      v.x *= ratio;
      v.y *= ratio;
      v.k = k;
      ensureLoop();
    },
    [ensureLoop],
  );

  const update = useCallback(
    <K extends keyof GraphSettings>(key: K, value: GraphSettings[K]) =>
      setSettings((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /* ── Markup ──────────────────────────────────────────────── */

  // The canvas stays mounted even when empty so its size observer keeps running.
  const empty = files.length === 0;
  const similarityNote = graph ? SIMILARITY_NOTE[graph.similarity] ?? null : null;

  const chrome =
    "bg-zinc-900/80 backdrop-blur border border-white/10 text-zinc-400 hover:text-linear-text hover:border-linear-accent/60 shadow-lg transition-colors duration-150 ease-out";

  return (
    <div ref={wrapRef} className="relative flex-1 min-h-0 bg-[#0a0a0f] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {empty ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          {loadError ? (
            <div className="max-w-sm">
              <div className="text-red-300 font-medium mb-1">Couldn&apos;t load wiki pages</div>
              <div className="text-xs text-zinc-500 break-words">{loadError}</div>
              <div className="text-xs text-zinc-600 mt-2">Check that the backend API is running, then hit Refresh.</div>
            </div>
          ) : (
            <div>
              <div className="text-zinc-300 font-medium mb-1">No wiki pages yet</div>
              <div className="text-xs text-zinc-500">Compile your raw sources to build the graph.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="absolute bottom-3 left-3 z-10 text-[10px] uppercase tracking-wider text-zinc-500 pointer-events-none select-none">
          {stats.nodes} node{stats.nodes !== 1 ? "s" : ""} · {stats.links} link{stats.links !== 1 ? "s" : ""}
          {stats.similar > 0 && <span className="text-teal-500/80"> · {stats.similar} similar</span>}
          <span className="ml-2 normal-case tracking-normal text-zinc-600">drag to pin · scroll to zoom · refresh to release</span>
        </div>
      )}

      {/* Settings panel */}
      <div className={`absolute top-2 left-2 z-10 ${empty ? "hidden" : ""}`}>
        {settingsOpen ? (
          <div className="w-56 max-h-[calc(100%-1rem)] overflow-y-auto bg-zinc-900/85 backdrop-blur border border-white/10 rounded-md shadow-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-linear-text-secondary font-semibold">
                Graph settings
              </span>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors duration-150 ease-out"
                aria-label="Close graph settings"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <Group label="Filters">
              <Toggle
                label="Orphans"
                checked={settings.showOrphans}
                onChange={(v) => update("showOrphans", v)}
              />
              <Toggle
                label="Similar pages"
                checked={settings.showSimilar}
                disabled={similarityNote != null}
                onChange={(v) => update("showSimilar", v)}
              />
              {similarityNote && (
                <div className="text-[10px] leading-snug text-amber-300/70">{similarityNote}</div>
              )}
            </Group>

            <Group label="Display">
              <Toggle
                label="Arrows"
                checked={settings.showArrows}
                onChange={(v) => update("showArrows", v)}
              />
              <Slider
                label="Text fade threshold"
                min={0}
                max={2}
                step={0.05}
                value={settings.textFade}
                onChange={(v) => update("textFade", v)}
              />
              <Slider
                label="Node size"
                min={0.4}
                max={3}
                step={0.1}
                value={settings.nodeSize}
                onChange={(v) => update("nodeSize", v)}
              />
              <Slider
                label="Link thickness"
                min={0.4}
                max={3}
                step={0.1}
                value={settings.linkThickness}
                onChange={(v) => update("linkThickness", v)}
              />
            </Group>

            <Group label="Forces">
              <Slider
                label="Center force"
                min={0}
                max={1.5}
                step={0.05}
                value={settings.centerForce}
                onChange={(v) => update("centerForce", v)}
              />
              <Slider
                label="Repel force"
                min={0.1}
                max={3}
                step={0.05}
                value={settings.repelForce}
                onChange={(v) => update("repelForce", v)}
              />
              <Slider
                label="Link force"
                min={0}
                max={1.5}
                step={0.05}
                value={settings.linkForce}
                onChange={(v) => update("linkForce", v)}
              />
              <Slider
                label="Link distance"
                min={30}
                max={300}
                step={5}
                value={settings.linkDistance}
                onChange={(v) => update("linkDistance", v)}
              />
            </Group>

            <button
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="w-full px-2 py-1.5 text-[11px] font-medium rounded-md border border-white/10 text-zinc-400 hover:text-linear-text hover:border-linear-accent/60 transition-colors duration-150 ease-out"
            >
              Restore defaults
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSettingsOpen(true)}
            className={`p-1.5 rounded-md ${chrome}`}
            title="Graph settings"
            aria-label="Open graph settings"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Zoom controls */}
      <div className={`absolute bottom-2 right-2 z-10 flex flex-col gap-1 ${empty ? "hidden" : ""}`}>
        <button
          onClick={() => zoomBy(1.3)}
          className={`p-1.5 rounded-md ${chrome}`}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => zoomBy(1 / 1.3)}
          className={`p-1.5 rounded-md ${chrome}`}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => fitView()}
          className={`p-1.5 rounded-md ${chrome}`}
          title="Fit to view"
          aria-label="Fit graph to view"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

/** World-space radius, floored so a node never shrinks below ~2.2px on screen. */
function radiusOf(n: GraphNode, s: GraphSettings, k: number): number {
  return Math.max(s.nodeSize * (3 + Math.sqrt(n.deg) * 2.4), 2.2 / k);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: GraphNode,
  to: GraphNode,
  targetRadius: number,
  color: string | CanvasGradient | CanvasPattern,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const tipX = to.x - ux * targetRadius;
  const tipY = to.y - uy * targetRadius;
  const size = 5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
  ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-2 text-[11px] ${
        disabled ? "text-zinc-500 cursor-default" : "text-zinc-300 cursor-pointer"
      }`}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-linear-accent"
      />
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-[11px] text-zinc-300">
      <span className="block mb-0.5">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-linear-accent"
      />
    </label>
  );
}
