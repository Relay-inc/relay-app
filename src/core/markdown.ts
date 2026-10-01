import { marked } from "marked";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

// ---------- safe markdown: Claude's text never becomes live HTML in a window that can approve actions
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** Links that may open: the web and mail. */
export const urlOk = (u: string) => /^(https?:|mailto:)/i.test(u);
// ---------- vault notes: a markdown link without a scheme, a [[wikilink]] or a `path.md:12` becomes a link when the note
// exists (src/domain/notes.ts says which do), and the app opens it in the right panel (it listens for data-note)
/** The note a link or path names: without its anchor, alias or line number. */
export const noteOf = (s: string) => { try { s = decodeURI(s); } catch {} return s.replace(/[#|].*$/, "").replace(/:\d+(-\d+)?$/, "").trim(); };
export const isNotePath = (s: string) => /\.md$/i.test(noteOf(s));
let noteKnown = (_: string) => false;
/** Which notes exist changed: text is parsed again, so links follow. */
export function setNoteCheck(known: (target: string) => boolean) { noteKnown = known; cache.clear(); }
const noteA = (target: string, inner: string) => noteKnown(target) ? `<a class="vlink" data-note="${esc(target)}">${inner}</a>` : inner;
marked.use({
  extensions: [{
    name: "wikilink", level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenizer(src: string) {
      const m = /^\[\[([^\]\n]+)\]\]/.exec(src);
      if (m) return { type: "wikilink", raw: m[0], target: noteOf(m[1]), label: m[1].split("|").pop()!.trim() };
    },
    renderer: (tok: any) => noteA(tok.target, esc(tok.label)),
  }],
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text),
    codespan: ({ text }) => isNotePath(text) ? noteA(noteOf(text), `<code>${esc(text)}</code>`) : `<code>${esc(text)}</code>`,
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (urlOk(href)) return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${inner}</a>`;
      return !/^[a-z][\w+.-]*:|^#/i.test(href) && noteOf(href) ? noteA(noteOf(href), inner) : inner;
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
