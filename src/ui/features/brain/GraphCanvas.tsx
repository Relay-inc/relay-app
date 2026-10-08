import { useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { BrainGraph, Glow } from "../../../domain/brain/types";
import { adjacency, glowLevel } from "../../../domain/brain/rules";

type Dot = SimulationNodeDatum & { i: number };
type View = { k: number; x: number; y: number };

// where every note sat, per folder and path, so coming back or a refresh does not lay it all out again
const placed = new Map<string, { x: number; y: number }>();
// ponytail: the layout runs on the main thread, a few ticks per frame (about 2 s for 3,000 notes). Upgrade: a worker
// if a folder of 10,000+ notes makes the view stutter while it settles.
const TICKS_PER_FRAME = 3;

/** The notes of a folder as dots and their links as lines, laid out by a force simulation on a canvas. Wheel or pinch
 *  zooms, dragging pans, a click opens the note. Dots are coloured by kind (`kinds`, 3 at most, the rest grey); with
 *  `glow` only the notes a conversation touched are lit, brighter the more recent, reads and writes in their own
 *  colour. `hideHubs`: the hubs left out. `focus`: the open note, ringed. */
export function GraphCanvas({
  root,
  graph,
  hideHubs,
  kinds,
  glow,
  glowDays,
  focus,
  fitTick,
  onOpen,
  tooltip,
}: {
  root: string;
  graph: BrainGraph;
  hideHubs: boolean;
  kinds: string[];
  glow: Map<string, Glow> | null;
  glowDays: number;
  focus: string;
  fitTick: number;
  onOpen: (path: string) => void;
  tooltip: (i: number) => React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Simulation<Dot, undefined> | null>(null);
  const dots = useRef<Dot[]>([]);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const moved = useRef(false); // the user zoomed or panned: no fitting on their behalf any more
  const hover = useRef(-1);
  const [tip, setTip] = useState<{ i: number; x: number; y: number; w: number } | null>(null);
  // what draw() reads, kept current without restarting the simulation
  const props = useRef({ graph, kinds, glow, glowDays, focus });
  useEffect(() => {
    props.current = { graph, kinds, glow, glowDays, focus };
  });
  const frame = useRef(0);

  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const css = getComputedStyle(c);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const { graph, kinds, glow, glowDays, focus } = props.current;
    const ratio = window.devicePixelRatio || 1;
    const { k, x, y } = view.current;
    const now = Date.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * (c.clientWidth / 2 + x), ratio * (c.clientHeight / 2 + y));
    const byI = new Map(dots.current.map(d => [d.i, d]));
    const near = new Set<number>();
    if (hover.current >= 0) for (const j of adj.current[hover.current] ?? []) near.add(j);
    // the links: one hairline path, those of the hovered note on top in the text colour
    ctx.lineWidth = 0.6 / k;
    ctx.strokeStyle = color("--separator-strong");
    ctx.globalAlpha = glow ? 0.35 : 0.8;
    ctx.beginPath();
    for (let e = 0; e < graph.edges.length; e += 2) {
      const a = byI.get(graph.edges[e]);
      const b = byI.get(graph.edges[e + 1]);
      if (!a || !b) continue;
      ctx.moveTo(a.x!, a.y!);
      ctx.lineTo(b.x!, b.y!);
    }
    ctx.stroke();
    if (hover.current >= 0 && byI.has(hover.current)) {
      const h = byI.get(hover.current)!;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color("--secondary");
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      for (const j of near) {
        const b = byI.get(j);
        if (!b) continue;
        ctx.moveTo(h.x!, h.y!);
        ctx.lineTo(b.x!, b.y!);
      }
      ctx.stroke();
    }
    // the dots: by kind, or lit by the glow
    const slots = [color("--viz-1"), color("--viz-2"), color("--viz-3")];
    const grey = color("--tertiary");
    const surface = color("--bg");
    const lit: Dot[] = [];
    for (const d of dots.current) {
      const node = graph.nodes[d.i];
      const r = radius.current[d.i];
      const g = glow?.get(node.p);
      if (g) {
        lit.push(d);
        continue;
      }
      const slot = kinds.indexOf(node.k);
      ctx.globalAlpha = glow ? 0.18 : 1;
      ctx.fillStyle = glow ? grey : slot >= 0 ? slots[slot] : grey;
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    // lit dots last, so they sit on top, with a soft halo as bright as the touch is recent
    for (const d of lit) {
      const g = glow!.get(graph.nodes[d.i].p)!;
      const level = glowLevel(g.at, now, glowDays);
      const fill = g.write ? slots[1] : slots[0];
      const r = radius.current[d.i] + 1.5;
      ctx.globalAlpha = level * 0.28;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r + 9 / Math.max(k, 0.5), 0, 2 * Math.PI); // the halo stays about 9 px on screen
      ctx.fill();
      ctx.globalAlpha = Math.max(level, 0.55);
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    // rings: the open note, the hovered one; a ring in the surface colour first so it reads on top of the others
    for (const [i, ink] of [
      [focusIndex(graph, focus), color("--label")],
      [hover.current, color("--label")],
    ] as const) {
      const d = byI.get(i);
      if (!d) continue;
      const r = radius.current[i] + 3;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = surface;
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.lineWidth = 1.5 / k;
      ctx.strokeStyle = ink;
      ctx.stroke();
    }
    // a few names, never one on every dot: the biggest hubs, the lit notes, the hovered note's neighbours
    ctx.globalAlpha = 1;
    ctx.font = `${11 / k}px ${css.getPropertyValue("--sans")}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = surface;
    ctx.fillStyle = color("--secondary");
    // in order of importance; a name that would overlap one already drawn is left out
    const named: number[] = [hover.current, ...near];
    if (glow) {
      const recent = [...lit].sort((a, b) => glow.get(graph.nodes[b.i].p)!.at - glow.get(graph.nodes[a.i].p)!.at);
      named.push(...recent.slice(0, 24).map(d => d.i));
    } else named.push(...labelled.current.filter(i => k * radius.current[i] > 4));
    if (k > 2.2) named.push(...dots.current.filter(d => radius.current[d.i] * k > 6).map(d => d.i));
    const boxes: [number, number, number, number][] = [];
    const lineH = 13 / k;
    for (const i of new Set(named)) {
      const d = byI.get(i);
      if (!d) continue;
      const text = graph.nodes[i].t.length > 40 ? `${graph.nodes[i].t.slice(0, 38)}…` : graph.nodes[i].t;
      const ty = d.y! + radius.current[i] + 12 / k;
      const half = ctx.measureText(text).width / 2;
      const box: [number, number, number, number] = [d.x! - half, ty - lineH, d.x! + half, ty + 2 / k];
      if (i !== hover.current && boxes.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
      boxes.push(box);
      ctx.strokeText(text, d.x!, ty);
      ctx.fillText(text, d.x!, ty);
    }
  };

  /** Zoom and pan so every dot is in view. */
  function fit() {
    const c = canvas.current;
    if (!c || !dots.current.length) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const d of dots.current) {
      x0 = Math.min(x0, d.x!);
      y0 = Math.min(y0, d.y!);
      x1 = Math.max(x1, d.x!);
      y1 = Math.max(y1, d.y!);
    }
    const k = Math.min(2, (c.clientWidth - 48) / Math.max(1, x1 - x0), (c.clientHeight - 48) / Math.max(1, y1 - y0));
    view.current = { k, x: -k * (x0 + x1) / 2, y: -k * (y0 + y1) / 2 };
  }
  /** The dot under a point of the canvas (CSS pixels), -1 for none. The hit area is wider than the dot. */
  function dotAt(px: number, py: number) {
    const c = canvas.current!;
    const { k, x, y } = view.current;
    const wx = (px - c.clientWidth / 2 - x) / k;
    const wy = (py - c.clientHeight / 2 - y) / k;
    const d = sim.current?.find(wx, wy, 10 / k + 4);
    return d ? d.i : -1;
  }

  // per graph: links, sizes by number of links, the hubs worth a name
  const adj = useRef<number[][]>([]);
  const radius = useRef<number[]>([]);
  const labelled = useRef<number[]>([]);

  // the simulation, again when the notes or what is hidden change
  useEffect(() => {
    adj.current = adjacency(graph);
    radius.current = adj.current.map(links => Math.min(12, 2.2 + Math.sqrt(links.length) * 0.9));
    const shown = graph.nodes.map((_, i) => i).filter(i => !(hideHubs && graph.nodes[i].h));
    labelled.current = [...shown].sort((a, b) => adj.current[b].length - adj.current[a].length).slice(0, 12);
    const known = shown.filter(i => placed.has(`${root}\n${graph.nodes[i].p}`)).length;
    dots.current = shown.map(i => {
      const at = placed.get(`${root}\n${graph.nodes[i].p}`);
      // a new note starts next to a placed neighbour, so it settles in place instead of flying in
      const friend = !at ? adj.current[i].map(j => placed.get(`${root}\n${graph.nodes[j].p}`)).find(Boolean) : undefined;
      return {
        i,
        x: at?.x ?? (friend ? friend.x + Math.random() * 10 : undefined),
        y: at?.y ?? (friend ? friend.y + Math.random() * 10 : undefined),
      };
    });
    const links: { source: number; target: number }[] = [];
    const visible = new Set(shown);
    for (let e = 0; e < graph.edges.length; e += 2)
      if (visible.has(graph.edges[e]) && visible.has(graph.edges[e + 1]))
        links.push({ source: graph.edges[e], target: graph.edges[e + 1] });
    const s = forceSimulation<Dot>(dots.current)
      .force("link", forceLink<Dot, { source: number; target: number }>(links).id(d => d.i).distance(28))
      .force("charge", forceManyBody<Dot>().strength(-36).distanceMax(420))
      .force("center", forceCenter(0, 0))
      // loose notes stay near instead of drifting off
      .force("x", forceX<Dot>(0).strength(0.04))
      .force("y", forceY<Dot>(0).strength(0.04))
      .stop();
    // everything placed before: a short settle, not a new layout
    s.alpha(known === shown.length && shown.length ? 0.04 : known ? 0.3 : 1);
    sim.current = s;
    if (!known) moved.current = false;
    const run = () => {
      for (let n = 0; n < TICKS_PER_FRAME; n++) s.tick();
      if (!moved.current) fit();
      draw();
      if (s.alpha() > s.alphaMin()) frame.current = requestAnimationFrame(run);
      else for (const d of dots.current) placed.set(`${root}\n${graph.nodes[d.i].p}`, { x: d.x!, y: d.y! });
    };
    frame.current = requestAnimationFrame(run);
    return () => {
      cancelAnimationFrame(frame.current);
      for (const d of dots.current) placed.set(`${root}\n${graph.nodes[d.i].p}`, { x: d.x!, y: d.y! });
    };
  }, [root, graph, hideHubs]);

  // the glow, kinds or open note changed: the same layout drawn again
  useEffect(() => {
    draw();
  });

  // fit on request (the Fit button)
  useEffect(() => {
    if (!fitTick) return;
    moved.current = false;
    fit();
    draw();
  }, [fitTick]);

  // the canvas follows its box at the screen's pixel density; a theme change redraws
  useEffect(() => {
    const c = canvas.current!;
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * ratio);
      c.height = Math.round(c.clientHeight * ratio);
      draw();
    };
    const ro = new ResizeObserver(size);
    ro.observe(c);
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", draw);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    return () => {
      ro.disconnect();
      media.removeEventListener("change", draw);
      mo.disconnect();
    };
  }, []);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <div ref={wrap} className="relative flex-1 min-h-0">
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full"
        onWheel={e => {
          const c = canvas.current!;
          const r = c.getBoundingClientRect();
          const v = view.current;
          // pinch arrives as a wheel with ctrlKey; a plain wheel or two-finger scroll pans like a map
          if (e.ctrlKey || e.metaKey) {
            const k = Math.min(8, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.01)));
            const px = e.clientX - r.left - c.clientWidth / 2;
            const py = e.clientY - r.top - c.clientHeight / 2;
            view.current = { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
          } else view.current = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
          moved.current = true;
          draw();
        }}
        onPointerDown={e => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const r = canvas.current!.getBoundingClientRect();
          if (drag.current) {
            const dx = e.clientX - drag.current.x;
            const dy = e.clientY - drag.current.y;
            if (drag.current.moved || Math.abs(dx) + Math.abs(dy) > 3) {
              drag.current = { x: e.clientX, y: e.clientY, moved: true };
              view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy };
              moved.current = true;
              setTip(null);
              draw();
              return;
            }
          }
          const i = dotAt(e.clientX - r.left, e.clientY - r.top);
          if (i !== hover.current) {
            hover.current = i;
            draw();
          }
          setTip(i >= 0 ? { i, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width } : null);
        }}
        onPointerUp={e => {
          const was = drag.current;
          drag.current = null;
          if (was?.moved) return;
          const r = canvas.current!.getBoundingClientRect();
          const i = dotAt(e.clientX - r.left, e.clientY - r.top);
          if (i >= 0) onOpen(graph.nodes[i].p);
        }}
        onPointerLeave={() => {
          hover.current = -1;
          setTip(null);
          draw();
        }}
        style={{ cursor: tip ? "pointer" : "grab" }}
      />
      {tip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-80 rounded-lg border border-separator bg-raised px-3 py-2 text-xs shadow"
          style={{ left: Math.min(tip.x + 14, tip.w - 330), top: tip.y + 14 }}
        >
          {tooltip(tip.i)}
        </div>
      ) : null}
    </div>
  );
}

const focusIndex = (graph: BrainGraph, path: string) => (path ? graph.nodes.findIndex(n => n.p === path) : -1);
