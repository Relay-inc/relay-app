import { html, nothing } from "lit";
import { glyphSvg, iconPaths, iconImg } from "../../core/icons";
import type { ProjectIcon } from "../../domain/icons";
import type { Tpl } from "./types";

// The look of the window as whole class strings (Tailwind only sees complete names) and the template helpers built on
// them: a section is a title and hint above a card, a field a label with its control. They render into the shadow root
// of whichever component uses them.

// a <code> in a translated text
export const CODE = "[&_code]:rounded-xs [&_code]:bg-s-mutedbg [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[11px]";
export const HINT = `mt-0.5 text-xs leading-[1.375] text-s-faint ${CODE}`;
/** A hint straight in a folded-open row, which has its own gap. */
export const HINT0 = `text-xs leading-[1.375] text-s-faint ${CODE}`;
export const OPT = "text-xs text-s-faint";
export const OKMSG = "text-xs text-s-muted";
export const ERRMSG = "text-xs text-s-err";
export const ST = "inline-flex min-w-0 items-center gap-1.5 text-xs text-s-muted";
export const SEMPTY = "py-2.5 text-xs text-s-faint";
export const PILL = "inline-block rounded-xs border border-s-border bg-[color-mix(in_srgb,var(--s-mutedbg)_40%,transparent)] px-1.5 py-0.5 text-[10px] leading-[1.2] font-normal text-s-subtle";

const BTN = "inline-flex h-7 leading-[normal] items-center justify-center gap-1.5 rounded-[6px] border text-xs font-medium whitespace-nowrap no-underline transition-[background-color] duration-150 ease-[ease] hover:duration-0 focus-visible:shadow-[0_0_0_1px_var(--s-primary)] focus-visible:outline-none disabled:opacity-50";
const BTN_KIND = {
  plain: "border-s-input bg-transparent text-s-fg hover:bg-s-hover",
  primary: "border-s-primary bg-s-primary text-s-bg hover:bg-[color-mix(in_srgb,var(--s-primary)_90%,var(--s-bg))]",
  ghost: "border-transparent bg-transparent text-s-muted hover:bg-s-hover hover:text-s-fg",
};
/** A button; `icon` makes it a square holding a glyph. */
export const btn = (kind: keyof typeof BTN_KIND = "plain", icon = false) => `${BTN} ${icon ? "w-7 p-0" : "px-3"} ${BTN_KIND[kind]}`;
/** The glyph in an icon button. */
export const IB = "size-[15px] fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]";
/** The glyph on a tile (menu items, rows). */
export const TILE = "size-4 fill-none stroke-current stroke-[1.3] [stroke-linejoin:round]";

const F = "leading-[normal] rounded-[6px] border border-s-input bg-transparent px-2.5 text-s-fg placeholder:font-sans placeholder:text-s-subtle read-only:text-s-muted focus-visible:shadow-[0_0_0_1px_var(--s-primary)] focus-visible:outline-none";
export const FIELD = `${F} h-[30px] w-[260px] text-sm`;
export const FIELD_ICON = `${F} h-[30px] w-[170px] text-sm`;
export const FIELD_CHIP = `${F} h-[26px] w-[150px] text-xs`;
export const SELECT = "leading-[normal] h-7 w-[200px] max-w-full appearance-none overflow-hidden rounded-[6px] border border-[color-mix(in_srgb,var(--s-border)_60%,var(--s-input))] bg-transparent bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23888%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E)] bg-[position:right_7px_center] bg-no-repeat pr-[26px] pl-2 text-xs text-ellipsis whitespace-nowrap text-s-fg focus-visible:shadow-[0_0_0_1px_var(--s-primary)] focus-visible:outline-none";

// GitHub's mark (octicon mark-github), in the label colour
const GH = '<path transform="translate(4 4)" fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>';
/** An app icon (or GitHub's mark) on the 24×24 grid; `cls` sizes and strokes it. */
export const ic = (n: string, cls = "") => glyphSvg(n === "gh" ? GH : iconPaths(n), cls, "0 0 24 24");

const CARD = "grid min-w-0 grid-cols-[minmax(0,1fr)] rounded-lg border border-s-border bg-s-bg [&>*]:min-w-0";
const LBL = "block text-sm leading-7 text-s-fg";
const SFH = `-mt-1 text-xs leading-[1.375] text-s-faint ${CODE}`;
const FOOT = "flex flex-wrap items-center gap-2";

type SecOpts = { desc?: Tpl; action?: Tpl; foot?: Tpl; list?: boolean };
export const sec = (title: Tpl, body: Tpl, o: SecOpts = {}) => html`<section class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 [&>*]:min-w-0">
    <header class="flex items-start justify-between gap-4"><div class="flex min-w-0 items-start gap-2.5"><div><h2 class="text-sm font-semibold text-s-fg">${title}</h2>${o.desc ? html`<p class=${HINT}>${o.desc}</p>` : nothing}</div></div>${o.action ? html`<div class="flex flex-none items-center gap-1.5 self-start">${o.action}</div>` : nothing}</header>
    ${body && body !== nothing ? html`<div class="${CARD} ${o.list ? "gap-0 px-4 py-0.5" : "gap-3.5 px-4 py-3"}">${body}</div>` : nothing}${o.foot && o.foot !== nothing ? html`<div class=${FOOT}>${o.foot}</div>` : nothing}</section>`;
export const field = (label: Tpl, ctl: Tpl, o: { hint?: Tpl; id?: string; cls?: string } = {}) =>
  html`<div class="flex items-start justify-between gap-6 ${o.cls ?? ""}"><div class="min-w-0 flex-1">${o.id ? html`<label for=${o.id} class=${LBL}>${label}</label>` : html`<span class=${LBL}>${label}</span>`}${o.hint ? html`<p class=${SFH}>${o.hint}</p>` : nothing}</div><div class="flex min-h-7 min-w-0 flex-[0_1_auto] items-center justify-end gap-2">${ctl}</div></div>`;
/** A switch, 28×16: on is the text colour with a light thumb, off a muted track with a dark thumb */
export const sw = (id: string, on: boolean, change: (e: Event) => void) => html`<input type="checkbox" role="switch" id=${id} .checked=${on} @change=${change}
  class="relative m-0 h-4 w-7 flex-none cursor-default appearance-none rounded-full border border-s-input bg-s-mutedbg transition-[background-color] duration-150 ease-[ease] after:absolute after:top-px after:left-px after:size-3 after:rounded-full after:bg-s-fg after:transition-transform after:duration-150 after:ease-[ease] after:content-[''] checked:border-transparent checked:bg-s-fg checked:after:translate-x-3 checked:after:bg-s-bg focus-visible:shadow-[0_0_0_2px_var(--s-bg),0_0_0_4px_var(--s-ring)] focus-visible:outline-none">`;
const DOT = { ok: "bg-s-ok", warn: "bg-s-warn", off: "bg-[color-mix(in_srgb,var(--s-muted)_50%,transparent)]" };
/** A status: a small dot and muted text */
export const st = (state: "ok" | "warn" | "off", text: Tpl) => html`<span class=${ST}><span class="size-1.5 flex-none rounded-full ${DOT[state]}"></span>${text}</span>`;
/** A message on the left, the buttons on the right */
export const foot = (m: Tpl, good: boolean, buttons: Tpl) => html`${m ? html`<span class=${good ? OKMSG : ERRMSG}>${m}</span>` : nothing}<span class="flex-1"></span>${buttons}`;
/** The footer of a section inside a folded-open row */
export const FOOT_ROW = `${FOOT} mt-0.5`;
export const FOOT_BARE = FOOT;
export const val = (e: Event) => (e.target as HTMLInputElement).value;
export const nc = (s: string) => s.replace(/\s*:\s*$/, ""); // the form labels end in a colon, the fields do without

/** A project's icon as it shows in a row (`row`) or on the tile beside its field (`tile`). */
export const projectIcon = (i: ProjectIcon | undefined, where: "row" | "tile") => {
  const img = iconImg(i?.img, "size-[18px] rounded-[4px]");
  if (img !== nothing) return img;
  if (i?.icon) return html`<span class="w-[15px] flex-none text-center leading-none ${where === "row" ? "text-[15px]" : "text-[13px]"}">${i.icon}</span>`;
  return ic("folder", where === "row" ? TILE : "size-4 fill-none stroke-s-subtle stroke-[1.75]");
};
