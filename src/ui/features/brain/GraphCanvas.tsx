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
const HOVER_MS = 150; // DESIGN.md › Motion
const FIT_MS = 260;
const GROW_MS = 600;
const ease = (t: number) => 1 - (1 - t) ** 3;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches; // no fades, no glides
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
  const [grabbing, setGrabbing] = useState(false);
  const [tip, setTip] = useState(-1); // the note whose card shows in the corner
  // what draw() reads, kept current without restarting the simulation
  const props = useRef({ root, graph, kinds, glow, glowDays, focus });
  useEffect(() => {
    props.current = { root, graph, kinds, glow, glowDays, focus };
  });
  const frame = useRef(0);
  // the hovered note's neighbourhood, faded in and out; `i` stays set while it fades out
  const lit = useRef({ i: -1, from: 0, to: 0, at: 0 });
  const tween = useRef<{ from: View; to: View; at: number } | null>(null); // the Fit button glides
  const born = useRef(0); // a fresh layout: the dots grow in from this moment
  const held = useRef<Dot | null>(null); // the dot being dragged
  const settled = useRef(true);

  // per graph: links, sizes by number of links, the notes biggest first (the order names are given in)
  const adj = useRef<number[][]>([]);
  const radius = useRef<number[]>([]);
  const labelled = useRef<number[]>([]);

  /** The zoom and pan that puts every dot in view. */
  function fitted(): View | null {
    const c = canvas.current;
    if (!c || !dots.current.length) return null;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const d of dots.current) {
      x0 = Math.min(x0, d.x!);
      y0 = Math.min(y0, d.y!);
      x1 = Math.max(x1, d.x!);
      y1 = Math.max(y1, d.y!);
    }
    const k = Math.min(2, (c.clientWidth - 48) / Math.max(1, x1 - x0), (c.clientHeight - 48) / Math.max(1, y1 - y0));
    return { k, x: (-k * (x0 + x1)) / 2, y: (-k * (y0 + y1)) / 2 };
  }
  /** The view in world coordinates: where a point of the canvas (CSS pixels) lands among the dots. */
  function world(px: number, py: number) {
    const c = canvas.current!;
    const { k, x, y } = view.current;
    return { wx: (px - c.clientWidth / 2 - x) / k, wy: (py - c.clientHeight / 2 - y) / k };
  }
  /** The dot under a point of the canvas (CSS pixels), -1 for none. The hit area is wider than the dot. */
  function dotAt(px: number, py: number) {
    const { wx, wy } = world(px, py);
    const d = sim.current?.find(wx, wy, 10 / view.current.k + 4);
    return d ? d.i : -1;
  }

  /** How far the hover highlight is faded in, 0 to 1. */
  const emphasis = (now: number) => {
    const e = lit.current;
    return still() ? e.to : e.from + (e.to - e.from) * ease(Math.min(1, (now - e.at) / HOVER_MS));
  };

  /** Paints the graph as it is now; true while a fade, glide or the grow-in is still under way. */
  const draw = () => {
    const c = canvas.current;
    if (!c) return false;
    const ctx = c.getContext("2d")!;
    const css = getComputedStyle(c);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const { graph, kinds, glow, glowDays, focus } = props.current;
    const ratio = window.devicePixelRatio || 1;
    const now = Date.now();
    const tick = performance.now();
    let busy = false;
    if (tween.current) {
      const { from, to, at } = tween.current;
      const p = still() ? 1 : ease(Math.min(1, (tick - at) / FIT_MS));
      view.current = {
        k: from.k + (to.k - from.k) * p,
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y - from.y) * p,
      };
      if (p < 1) busy = true;
      else tween.current = null;
    }
    const grow = born.current && !still() ? ease(Math.min(1, (tick - born.current) / GROW_MS)) : 1;
    const e = lit.current;
    const t = e.i >= 0 ? emphasis(tick) : 0;
    if (t !== e.to) busy = true;
    if (grow < 1) busy = true;
    const { k, x, y } = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * (c.clientWidth / 2 + x), ratio * (c.clientHeight / 2 + y));
    const byI = new Map(dots.current.map(d => [d.i, d]));
    const near = new Set<number>(t > 0 ? adj.current[e.i] : []);
    const slots = [1, 2, 3, 4, 5, 6].map(n => color(`--viz-${n}`));
    const grey = color("--tertiary");
    const surface = color("--bg");
    const slotOf = (i: number) => kinds.indexOf(graph.nodes[i].k);
    const fade = 1 - 0.88 * t; // what is not around the hovered note steps back
    // the hovered note's colour: its kind's, the accent for a grey one, never black
    const ink = e.i >= 0 && slotOf(e.i) >= 0 && !glow ? slots[slotOf(e.i)] : color("--accent");
    // the links: within one kind in that kind's colour, between kinds a grey hairline
    const paths = [...slots, grey].map(() => new Path2D());
    const mine = new Path2D();
    for (let n = 0; n < graph.edges.length; n += 2) {
      const [i, j] = [graph.edges[n], graph.edges[n + 1]];
      const a = byI.get(i);
      const b = byI.get(j);
      if (!a || !b) continue;
      const same = !glow && slotOf(i) === slotOf(j) && slotOf(i) >= 0;
      const path = t > 0 && (i === e.i || j === e.i) ? mine : paths[same ? slotOf(i) : slots.length];
      path.moveTo(a.x!, a.y!);
      path.lineTo(b.x!, b.y!);
    }
    ctx.lineWidth = 0.7 / k;
    ctx.strokeStyle = color("--separator-strong");
    ctx.globalAlpha = (glow ? 0.35 : 0.9) * fade * grow;
    ctx.stroke(paths[slots.length]);
    ctx.globalAlpha = 0.32 * fade * grow;
    slots.forEach((slot, n) => {
      ctx.strokeStyle = slot;
      ctx.stroke(paths[n]);
    });
    if (t > 0) {
      ctx.globalAlpha = 0.7 * t;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2 / k;
      ctx.stroke(mine);
    }
    // the dots: by kind, or lit by the glow, each with a hairline in the surface colour so a cluster stays apart; the
    // hovered note and its neighbours swell a little
    const size = (i: number) => radius.current[i] * grow * (1 + (i === e.i ? 0.4 : near.has(i) ? 0.15 : 0) * t);
    const dim = (i: number) => (i === e.i || near.has(i) ? 1 : fade);
    const shine: Dot[] = [];
    // a solid dot: a disc in the surface colour under the colour, so a faded dot stays filled and no link shows through
    const solid = (d: Dot, fill: string, alpha: number) => {
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, size(d.i), 0, 2 * Math.PI);
      ctx.globalAlpha = grow;
      ctx.fillStyle = surface;
      ctx.fill();
      ctx.globalAlpha = alpha * grow;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = grow;
      if (k * size(d.i) > 3) ctx.stroke();
    };
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = surface;
    for (const d of dots.current) {
      const node = graph.nodes[d.i];
      if (glow?.get(node.p)) {
        shine.push(d);
        continue;
      }
      if (d.i === e.i && t > 0) continue; // drawn last, over its neighbours
      const slot = slotOf(d.i);
      solid(d, glow ? grey : slot >= 0 ? slots[slot] : grey, (glow ? 0.25 : 1) * dim(d.i));
    }
    // lit dots last, so they sit on top, with a soft halo as bright as the touch is recent
    for (const d of shine) {
      const g = glow!.get(graph.nodes[d.i].p)!;
      const level = glowLevel(g.at, now, glowDays);
      const r = size(d.i) + 1.5;
      ctx.fillStyle = g.write ? slots[1] : slots[0];
      ctx.globalAlpha = level * 0.28 * dim(d.i);
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r + 9 / Math.max(k, 0.5), 0, 2 * Math.PI); // the halo stays about 9 px on screen
      ctx.fill();
      ctx.globalAlpha = Math.max(level, 0.55) * dim(d.i);
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    const top = byI.get(e.i);
    if (top && t > 0 && !glow?.get(graph.nodes[e.i].p)) {
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = surface;
      solid(top, slotOf(e.i) >= 0 && !glow ? slots[slotOf(e.i)] : grey, 1);
      ctx.globalAlpha = t; // a grey note takes the hover colour as the hover fades in
      ctx.fillStyle = ink;
      ctx.fill();
    }
    // rings: the open note, the hovered one in its colour; a ring in the surface colour first so it reads on top
    for (const [i, stroke, alpha] of [
      [focusIndex(graph, focus), color("--label"), 1],
      [e.i, ink, t],
    ] as const) {
      const d = byI.get(i);
      if (!d || !alpha) continue;
      const r = size(i) + 3 / k;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = surface;
      ctx.beginPath();
      ctx.arc(d.x!, d.y!, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.lineWidth = 1.5 / k;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    // the names. The hovered note's sits on a pill on top of everything; around it its neighbours' names. Without a
    // hover the bigger notes are named, more of them as you zoom in, each fading in as its dot grows on screen. A
    // name that would overlap one already placed is left out.
    const sans = css.getPropertyValue("--sans");
    const boxes: [number, number, number, number][] = [];
    const free = (box: [number, number, number, number]) =>
      !boxes.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]);
    const clip = (i: number) => (graph.nodes[i].t.length > 40 ? `${graph.nodes[i].t.slice(0, 38)}…` : graph.nodes[i].t);
    const hovered = byI.get(e.i);
    let pill: { text: string; x: number; y: number; w: number; h: number } | null = null;
    if (hovered && t > 0.01) {
      ctx.font = `600 ${12 / k}px ${sans}`;
      const text = clip(e.i);
      const [w, h] = [ctx.measureText(text).width + 14 / k, 20 / k];
      const y = hovered.y! + size(e.i) + 6 / k;
      pill = { text, x: hovered.x! - w / 2, y, w, h };
      boxes.push([pill.x, y, pill.x + w, y + h]);
    }
    ctx.font = `${11 / k}px ${sans}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4 / k;
    ctx.lineJoin = "round";
    ctx.strokeStyle = surface;
    const label = (i: number, alpha: number, fill: string) => {
      const d = byI.get(i);
      if (!d || alpha <= 0.02) return;
      const text = clip(i);
      const ty = d.y! + size(i) + 12 / k;
      const half = ctx.measureText(text).width / 2;
      const box: [number, number, number, number] = [d.x! - half, ty - 11 / k, d.x! + half, ty + 3 / k];
      if (!free(box)) return;
      boxes.push(box);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.strokeText(text, d.x!, ty);
      ctx.fillText(text, d.x!, ty);
    };
    if (t > 0.01) for (const i of near) label(i, t * grow, color("--label"));
    if (glow) {
      const recent = [...shine].sort((a, b) => glow.get(graph.nodes[b.i].p)!.at - glow.get(graph.nodes[a.i].p)!.at);
      for (const d of recent.slice(0, 24))
        if (d.i !== e.i && !near.has(d.i)) label(d.i, fade * grow, color("--secondary"));
    }
    // by size, biggest first: the dozen biggest from 4 px on screen, the rest from 6 px, fully in at 10 px
    labelled.current.forEach((i, n) => {
      if (i === e.i || near.has(i)) return;
      const r = k * radius.current[i];
      const from = n < 12 ? 4 : 6;
      if (r > from) label(i, Math.min(1, (r - from) / 4 + (n < 12 ? 0.4 : 0)) * fade * grow, color("--secondary"));
    });
    if (pill) {
      ctx.globalAlpha = t;
      ctx.fillStyle = color("--raised");
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.roundRect(pill.x, pill.y, pill.w, pill.h, pill.h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `600 ${12 / k}px ${sans}`;
      ctx.fillStyle = color("--label");
      ctx.textBaseline = "middle";
      ctx.fillText(pill.text, pill.x + pill.w / 2, pill.y + pill.h / 2);
      ctx.textBaseline = "alphabetic";
    }
    return busy;
  };

  /** One frame: the simulation a few ticks further while it runs, then the picture. Asks for the next frame while
   *  anything still moves, so a settled graph costs nothing. */
  const loop = () => {
    frame.current = 0;
    const s = sim.current;
    let busy = false;
    if (s && (s.alpha() > s.alphaMin() || s.alphaTarget() > 0)) {
      for (let n = 0; n < TICKS_PER_FRAME; n++) s.tick();
      if (!moved.current) view.current = fitted() ?? view.current;
      busy = settled.current = false;
    } else if (!settled.current) {
      settled.current = true;
      save();
    }
    if (draw() || busy) frame.current = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!frame.current) frame.current = requestAnimationFrame(loop);
  };
  const save = () => {
    const { root, graph } = props.current;
    for (const d of dots.current) placed.set(`${root}\n${graph.nodes[d.i].p}`, { x: d.x!, y: d.y! });
  };

  // the simulation, again when the notes or what is hidden change
  useEffect(() => {
    adj.current = adjacency(graph);
    radius.current = adj.current.map(links => Math.min(16, 2.4 + Math.sqrt(links.length) * 1.1));
    const shown = graph.nodes.map((_, i) => i).filter(i => !(hideHubs && graph.nodes[i].h));
    labelled.current = [...shown].sort((a, b) => adj.current[b].length - adj.current[a].length);
    const known = shown.filter(i => placed.has(`${root}\n${graph.nodes[i].p}`)).length;
    dots.current = shown.map(i => {
      const at = placed.get(`${root}\n${graph.nodes[i].p}`);
      // a new note starts next to a placed neighbour, so it settles in place instead of flying in
      const friend = !at
        ? adj.current[i].map(j => placed.get(`${root}\n${graph.nodes[j].p}`)).find(Boolean)
        : undefined;
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
      .force(
        "link",
        forceLink<Dot, { source: number; target: number }>(links)
          .id(d => d.i)
          .distance(28),
      )
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
    born.current = known ? 0 : performance.now();
    lit.current = { i: -1, from: 0, to: 0, at: 0 };
    kick();
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      save();
    };
  }, [root, graph, hideHubs]);

  // the glow, kinds or open note changed: the same layout drawn again
  useEffect(() => {
    kick();
  });

  // fit on request (the Fit button): a short glide there
  useEffect(() => {
    if (!fitTick) return;
    moved.current = false;
    const to = fitted();
    if (to) tween.current = { from: view.current, to, at: performance.now() };
    kick();
  }, [fitTick]);

  // the canvas follows its box at the screen's pixel density; a theme change redraws
  useEffect(() => {
    const c = canvas.current!;
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * ratio);
      c.height = Math.round(c.clientHeight * ratio);
      if (draw()) kick();
    };
    const ro = new ResizeObserver(size);
    ro.observe(c);
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", kick);
    const mo = new MutationObserver(kick);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    return () => {
      ro.disconnect();
      media.removeEventListener("change", kick);
      mo.disconnect();
    };
  }, []);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** The note under the pointer, its neighbourhood fading in (or the last one fading out for -1). */
  const hoverTo = (i: number) => {
    if (i === hover.current) return;
    hover.current = i;
    const now = performance.now();
    const from = lit.current.i >= 0 ? emphasis(now) : 0;
    lit.current = i >= 0 ? { i, from, to: 1, at: now } : { ...lit.current, from, to: 0, at: now };
    kick();
  };
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
          tween.current = null;
          kick();
        }}
        onPointerDown={e => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          canvas.current!.setPointerCapture(e.pointerId);
          // on a dot, dragging pulls that note and the graph follows; elsewhere it pans
          const r = canvas.current!.getBoundingClientRect();
          const i = dotAt(e.clientX - r.left, e.clientY - r.top);
          held.current = dots.current.find(d => d.i === i) ?? null;
        }}
        onPointerMove={e => {
          const r = canvas.current!.getBoundingClientRect();
          if (drag.current) {
            const dx = e.clientX - drag.current.x;
            const dy = e.clientY - drag.current.y;
            if (drag.current.moved || Math.abs(dx) + Math.abs(dy) > 3) {
              drag.current = { x: e.clientX, y: e.clientY, moved: true };
              moved.current = true;
              tween.current = null;
              const d = held.current;
              if (d && sim.current) {
                const { wx, wy } = world(e.clientX - r.left, e.clientY - r.top);
                d.fx = wx;
                d.fy = wy;
                sim.current.alphaTarget(0.25);
                setGrabbing(true);
              } else {
                view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy };
                hoverTo(-1);
              }
              setTip(-1);
              kick();
              return;
            }
          }
          const i = dotAt(e.clientX - r.left, e.clientY - r.top);
          hoverTo(i);
          setTip(i);
        }}
        onPointerUp={e => {
          const was = drag.current;
          drag.current = null;
          const d = held.current;
          held.current = null;
          if (d) {
            d.fx = d.fy = null;
            sim.current?.alphaTarget(0);
            setGrabbing(false);
          }
          if (was?.moved) return;
          const r = canvas.current!.getBoundingClientRect();
          const i = dotAt(e.clientX - r.left, e.clientY - r.top);
          if (i >= 0) onOpen(graph.nodes[i].p);
        }}
        onPointerLeave={() => {
          if (held.current) return; // the pointer is captured while a dot is dragged
          hoverTo(-1);
          setTip(-1);
        }}
        style={{ cursor: grabbing ? "grabbing" : tip >= 0 ? "pointer" : "grab" }}
      />
      {/* in a corner, not at the pointer, so it never covers the neighbours being read */}
      {tip >= 0 ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-96 rounded-lg border border-separator bg-raised px-3 py-2 text-xs shadow">
          {tooltip(tip)}
        </div>
      ) : null}
    </div>
  );
}

const focusIndex = (graph: BrainGraph, path: string) => (path ? graph.nodes.findIndex(n => n.p === path) : -1);
