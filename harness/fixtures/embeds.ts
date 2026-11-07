// Fixture embeds (K4): a project's page with files inside it, and the answers embed_info and the relay-file scheme
// give for them. Fictional data only; the files are drawn here (a chart as SVG, a silent WAV), no file is read.
import { pngBase64 } from "./util";
import { VAULT } from "./vault";

export const PROJECT_NOTE = "Contexts/Agency/Projects/Northwind Portal/Northwind Portal.md";
export const FINDINGS_NOTE = "Contexts/Agency/Projects/Northwind Portal/Documents/Rate limit findings.md";
export const CHART = "traffic-7d.png";
export const QUOTE = "Hosting quote cluster 2026.pdf";
export const TALK = "2026-11-04 Portal sync.m4a";
/** A file big enough to be refused: the design's example, 312 MB. */
export const DUMP = "configurator-db-dump.sql.gz";

const findings = `---\ntype: Document\nstatus: Active\n---\n# Rate limit findings\n\n## Authentication\nAn API key per client, sent as a header.\n\n## Rate limits\n- 60 requests per minute per API key; after that 429 with Retry-After.\n- Cache value lookups per plate for 24 hours.\n\n## Errors\nA 5xx is retried twice with a pause.\n`;
const project = `---\ntype: Project\nstatus: Active\ncreated: 2026-09-21\n---\n# Northwind Portal\n\nConfigurator traffic is lowest on Saturday morning, so we plan the migration for 15 November between 06:00 and 08:00.\n\n![[${CHART}|Configurator traffic, last 7 days. Low point Saturday 06:00–08:00|560]]\n\n![[${QUOTE}]]\n\n![[${TALK}]]\n\n![[Rate limit findings#Rate limits]]\n\nNext: confirm the window with the client.\n`;
export const texts: Record<string, string> = { [PROJECT_NOTE]: project, [FINDINGS_NOTE]: findings };

const KIND: Record<string, string> = { png: "image", jpg: "image", jpeg: "image", pdf: "pdf", m4a: "audio", mp3: "audio" };
/** embed_info (src-tauri/src/attach.rs): per target what it is; a name with no extension is a note. */
export function info(targets: string[]) {
  return targets.map(target => {
    const ext = target.includes(".") ? target.split(".").pop()!.toLowerCase() : "";
    const kind = KIND[ext];
    if (target.startsWith("missing")) return { target, missing: true };
    if (!kind) {
      const note = target === "Rate limit findings";
      return note
        ? { target, path: `${VAULT}/${FINDINGS_NOTE}`, rel: FINDINGS_NOTE, kind: "note", size: findings.length, text: findings }
        : { target, missing: true };
    }
    const rel = `Attachments/2026/${target}`;
    const base = { target, path: `${VAULT}/${rel}`, rel, kind };
    if (kind === "pdf") return { ...base, size: 1_200_000, pages: 6, thumb: `data:image/png;base64,${pngBase64(88, 112, "#fbfbfa", "#3a5ffb")}` };
    return { ...base, size: kind === "audio" ? 31_000_000 : 184_000 };
  });
}

/** What a workspace file answers the webview (convertFileSrc is replaced by the harness): a chart, or a silent clip. */
export function fileSrc(path: string): string {
  if (/\.(m4a|mp3)$/i.test(path)) return wav(32);
  if (/banner\.(png|jpe?g)$/i.test(path)) return banner();
  if (/\.(png|jpe?g)$/i.test(path)) return chart(path);
  return "";
}
/** A cover (issue 424): a wide gradient with a few soft circles. */
function banner() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a5ffb"/><stop offset="1" stop-color="#9b5de5"/></linearGradient></defs><rect width="1200" height="320" fill="url(#g)"/><circle cx="980" cy="70" r="140" fill="#fff" fill-opacity=".12"/><circle cx="220" cy="300" r="180" fill="#fff" fill-opacity=".08"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
function chart(path: string) {
  const bars = Array.from({ length: 42 }, (_, i) => {
    const low = i > 18 && i < 25;
    const h = low ? 14 + (i % 3) * 5 : 40 + ((i * 53) % 85);
    return `<rect x="${16 + i * 12.6}" y="${150 - h}" width="9.4" height="${h}" rx="2" fill="${low ? "#3a5ffb" : "#c7c7cc"}"/>`;
  }).join("");
  const label = path.split("/").pop();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="190" viewBox="0 0 560 190"><rect width="560" height="190" fill="#fbfbfa"/><rect width="560" height="26" fill="#f1f1ef"/><circle cx="14" cy="13" r="3.5" fill="#d4d4d8"/><circle cx="28" cy="13" r="3.5" fill="#d4d4d8"/><text x="42" y="17" font-family="sans-serif" font-size="11" fill="#636369">${label} · requests / hour · 7d</text>${bars}</svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
/** A silent 8 kHz mono WAV of `seconds`. */
function wav(seconds: number) {
  const rate = 8000;
  const n = rate * seconds;
  const bytes = new Uint8Array(44 + n).fill(0x80);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + n, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, n, true);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}
