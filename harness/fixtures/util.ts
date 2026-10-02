// Shared bits of the fixtures: the fixed "now" every date is relative to, a seeded random, and small images.

/** Thursday 1 October 2026, 09:30 in Brussels. screens.mjs fixes the page clock to the same instant. */
export const NOW = Date.parse("2026-10-01T07:30:00Z");
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const iso = (ms: number) => new Date(ms).toISOString();
export const ymd = (ms: number) => iso(ms).slice(0, 10);

/** mulberry32: the same sequence on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)],
  };
}

/** A deterministic uuid-shaped id. */
export const uuid = (n: number) => {
  const hex = (n * 2654435761).toString(16).padStart(8, "0").slice(-8);
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`;
};

/** A small PNG drawn on a canvas: two colour blocks and a diagonal, as base64 without the data: prefix. */
export function pngBase64(width: number, height: number, a: string, b: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = b;
  ctx.fillRect(width * 0.1, height * 0.15, width * 0.5, height * 0.4);
  ctx.strokeStyle = b;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(width, 0);
  ctx.stroke();
  return canvas.toDataURL("image/png").split(",")[1];
}
