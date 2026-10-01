import { marked } from "marked";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "./i18n";
import { iconPaths } from "./icons";

// ---------- safe markdown: Claude's text never becomes live HTML in a window that can approve actions
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
/** Links that may open: the web and mail. */
export const urlOk = (url: string) => /^(https?:|mailto:)/i.test(url);
// ---------- vault notes: a markdown link without a scheme, a [[wikilink]] or a `path.md:12` becomes a link when the note
// exists (src/domain/notes.ts says which do), and the app opens it in the right panel (it listens for data-note)
/** The note a link or path names: without its anchor, alias or line number. */
export const noteOf = (text: string) => {
  let decoded = text;
  try {
    decoded = decodeURI(text);
  } catch {
    // not URI-encoded: keep it as it is
  }
  return decoded
    .replace(/[#|].*$/, "")
    .replace(/:\d+(-\d+)?$/, "")
    .trim();
};
export const isNotePath = (text: string) => /\.md$/i.test(noteOf(text));
let noteKnown = (_: string) => false;
/** Which notes exist changed: text is parsed again, so links follow. */
export function setNoteCheck(known: (target: string) => boolean) {
  noteKnown = known;
  cache.clear();
}
type WikiToken = { type: "wikilink"; raw: string; target: string; label: string };
const noteA = (target: string, inner: string) =>
  noteKnown(target) ? `<a class="vlink" data-note="${esc(target)}">${inner}</a>` : inner;
marked.use({
  extensions: [
    {
      name: "wikilink",
      level: "inline",
      start: (src: string) => src.indexOf("[["),
      tokenizer(src: string) {
        const match = /^\[\[([^\]\n]+)\]\]/.exec(src);
        if (match)
          return {
            type: "wikilink",
            raw: match[0],
            target: noteOf(match[1]),
            label: match[1].split("|").pop()!.trim(),
          };
        return undefined; // not a wikilink: marked tries its other rules
      },
      renderer: tok => {
        const { target, label } = tok as unknown as WikiToken;
        return noteA(target, esc(label));
      },
    },
  ],
  renderer: {
    html: ({ text }) => esc(text),
    // a code block under a header with its language and a copy button (the app copies it, src/features/shell/relay-app.ts)
    code: ({ text, lang }) =>
      `<div class="codeblock my-2 rounded-[10px] bg-well border border-separator overflow-hidden"><div class="flex items-center h-7.5 pl-3 pr-1.5 border-b border-separator font-mono text-[11px] text-tertiary"><span class="flex-1">${esc((lang ?? "").split(/\s/)[0])}</span><button data-copy class="inline-flex items-center gap-1 h-5.5 px-1.5 border-0 rounded-[5px] bg-transparent text-secondary font-sans text-[11px] hover:bg-fill-2 hover:text-label" title="${esc(t("copy"))}"><svg class="glyph size-3" viewBox="0 0 24 24" aria-hidden="true">${iconPaths("copy")}</svg>${esc(t("copy"))}</button></div><pre><code>${esc(text)}</code></pre></div>`,
    image: ({ text }) => esc(text),
    codespan: ({ text }) =>
      isNotePath(text) ? noteA(noteOf(text), `<code>${esc(text)}</code>`) : `<code>${esc(text)}</code>`,
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
export function mdHtml(text: string) {
  let html = cache.get(text);
  if (html === undefined) {
    if (cache.size > 500) cache.clear();
    html = marked.parse(text, { async: false }) as string;
    cache.set(text, html);
  }
  return html;
}
/** Markdown for a template: the raw HTML above escaped, only web and mail links. */
export const md = (text: string) => unsafeHTML(mdHtml(text));
