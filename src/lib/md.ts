import { marked } from "marked";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

// ---------- safe markdown: Claude's text never becomes live HTML in a window that can approve actions
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** Links that may open: the web and mail. */
export const urlOk = (u: string) => /^(https?:|mailto:)/i.test(u);
marked.use({
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      return urlOk(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
    },
  },
});

// a streaming answer redraws the conversation on every delta: each finished block is parsed once
// ponytail: unbounded until 500 entries, then cleared; an LRU if long sessions show it
const cache = new Map<string, string>();
export function mdHtml(s: string) {
  let h = cache.get(s);
  if (h === undefined) { if (cache.size > 500) cache.clear(); h = marked.parse(s, { async: false }) as string; cache.set(s, h); }
  return h;
}
/** Markdown for a template: the raw HTML above escaped, only web and mail links. */
export const md = (s: string) => unsafeHTML(mdHtml(s));
