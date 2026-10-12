import "../../styles/crab.css";
import type { Costume } from "../../../domain/orchestrator/rules";

// A worker as a pixel crab: 24 x 22 cells, dressed for the model it runs on, walking while it works (crab.css; still
// under prefers-reduced-motion). Drawn for Relay, after the idea in johnnyvizz/claude-kit's savvy-progress.

const SHELL = "#E0684B";
const SHELL_DARK = "#B9482F";
const INK = "#1F1E1D";

type Px = [x: number, y: number, w: number, h: number, fill: string];
// a group per motion: `bd` the body with what it wears, `la`/`lb` the leg pairs, the rest a prop with its own motion
type Parts = Record<string, Px[]>;

/** Cells from rows of characters: each character a colour from `map`, "." empty. */
const stamp = (x: number, y: number, rows: string[], map: Record<string, string>): Px[] =>
  rows.flatMap((row, dy) => [...row].flatMap((ch, dx): Px[] => (map[ch] ? [[x + dx, y + dy, 1, 1, map[ch]]] : [])));

const body = (): Parts => ({
  bd: [
    [6, 9, 12, 1, SHELL],
    [4, 10, 16, 7, SHELL],
    [5, 17, 14, 1, SHELL_DARK],
    [8, 12, 2, 2, INK],
    [14, 12, 2, 2, INK],
    [2, 12, 2, 2, SHELL],
    [20, 12, 2, 2, SHELL],
    ...stamp(0, 8, ["x.x", "xxx", "xxx"], { x: SHELL }),
    ...stamp(21, 8, ["x.x", "xxx", "xxx"], { x: SHELL }),
  ],
  la: [
    [5, 18, 2, 3, SHELL_DARK],
    [15, 18, 2, 3, SHELL_DARK],
  ],
  lb: [
    [8, 18, 2, 3, SHELL_DARK],
    [18, 18, 2, 3, SHELL_DARK],
  ],
});

const COSTUMES: Record<Costume, (parts: Parts) => void> = {
  // a glass helmet with a blinking aerial; it floats instead of walking
  fable: parts => {
    parts.bd.push(
      [5, 3, 14, 1, "#D7DCE4"],
      [4, 4, 1, 6, "#D7DCE4"],
      [19, 4, 1, 6, "#D7DCE4"],
      [5, 4, 14, 5, "rgba(150,200,240,.35)"],
      [6, 4, 2, 1, "#FFFFFF"],
      [12, 1, 1, 2, "#B8BEC8"],
    );
    parts.tip = [[11, 0, 3, 1, "#7C8CF8"]];
  },
  // a flat cap, and a magnifier that sweeps
  opus: parts => {
    parts.bd.push(
      ...stamp(5, 6, ["..bbbbbbbbbb..", ".bbcbbbbbbcbb.", "dddddddddddddd"], {
        b: "#7A4A26",
        c: "#9C6B3E",
        d: "#4F2F17",
      }),
    );
    parts.prop = [
      ...stamp(19, 1, [".kk.", "k..k", "k..k", ".kk."], { k: "#3A3A3C" }),
      [20, 2, 2, 2, "rgba(150,200,240,.7)"],
      [22, 5, 1, 3, "#7A4A26"],
    ];
  },
  // a toque, and an egg flipping in the pan
  sonnet: parts => {
    parts.bd.push(
      ...stamp(6, 1, [".ww.wwww.ww.", "wwwwwwwwwwww", "wwwwwwwwwwww", ".wwwwwwwwww.", "..wwwwwwww..", "..gggggggg.."], {
        w: "#F6F5F0",
        g: "#D6D4CB",
      }),
    );
    parts.pan = [
      [19, 7, 5, 1, "#4A4A48"],
      [18, 8, 1, 1, "#4A4A48"],
    ];
    parts.egg = [[20, 6, 2, 1, "#F5B731"]];
  },
  // a racing helmet and speed lines; it runs at twice the pace
  haiku: parts => {
    parts.bd.push(
      ...stamp(5, 5, ["...rrrrrrrr...", "..rrrrwwrrrr..", ".rrrrrwwrrrrr.", "kkkkkkkkkkkkkk"], {
        r: "#3E7BEA",
        w: "#F8F6F1",
        k: INK,
      }),
    );
    parts.zip = [
      [0, 15, 3, 1, "#B8BEC8"],
      [1, 17, 2, 1, "#B8BEC8"],
    ];
  },
  // a hard hat, and a wrench that turns
  pipeline: parts => {
    parts.bd.push(
      ...stamp(5, 5, ["....yyyyyy....", "..yyyyhhyyyy..", ".yyyyyhhyyyyy.", "dddddddddddddd"], {
        y: "#F5C542",
        h: "#FBE08A",
        d: "#C99A1E",
      }),
    );
    parts.prop = stamp(0, 3, [".s.s", ".sss", "..s.", "..s.", "..s."], { s: "#8E929A" });
  },
  plain: () => {},
};

const rects = (px: Px[]) =>
  px.map(([x, y, w, h, fill], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />);

/** A worker's crab; `running` walks it, `dim` greys it out (stopped, or ended without a report). */
export function Crab({ costume, running, dim }: { costume: Costume; running: boolean; dim?: boolean }) {
  const parts = body();
  COSTUMES[costume](parts);
  const { bd, la, lb, ...props } = parts;
  return (
    <svg
      className={`crab crab-${costume} ${running ? "run" : ""} ${dim ? "opacity-45" : ""}`}
      viewBox="0 0 24 22"
      width={28}
      height={26}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <g className="bd">
        {rects(bd)}
        {Object.entries(props).map(([name, px]) => (
          <g key={name} className={name}>
            {rects(px)}
          </g>
        ))}
      </g>
      <g className="la">{rects(la)}</g>
      <g className="lb">{rects(lb)}</g>
    </svg>
  );
}
