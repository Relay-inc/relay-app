import { marked } from "marked";
import { t, currentLang } from "./i18n";
import { iconPaths } from "./icons";
import { esc } from "./html";
import { highlightHtml } from "./highlight";

// ---------- safe markdown: Claude's text never becomes live HTML in a window that can approve actions
/** Links that may open: the web and mail. */
export const urlOk = (url: string) => /^(https?:|mailto:)/i.test(url);
// ---------- vault notes: a markdown link without a scheme, a [[wikilink]] or a `path.md:12` becomes a link when the note
// exists (application/workspace says which do), and the app opens it in the right panel (ui/app listens for data-note)
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
const isNotePath = (text: string) => /\.md$/i.test(noteOf(text));
let noteKnown = (_: string) => false;
/** Which notes exist changed: text is parsed again, so links follow. The workspace store bumps its `notesVersion`
 *  with it, which the Markdown component memoises on. */
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
    // a code block under a header with its language and a copy button (the app copies it, src/ui/app/App.tsx)
    code: ({ text, lang, raw, codeBlockStyle }) => {
      const name = (lang ?? "").split(/\s/)[0];
      // a fence still streaming in colours once it is closed: half a string would colour the rest of the block
      const closed = codeBlockStyle === "indented" || /(```|~~~)\s*$/.test(raw);
      const code = closed ? highlightHtml(text, name) : esc(text);
      return `<div class="codeblock my-2 rounded-[10px] bg-well border border-separator overflow-hidden"><div class="flex items-center h-7.5 pl-3 pr-1.5 border-b border-separator font-mono text-[11px] text-tertiary"><span class="flex-1">${esc(name)}</span><button data-copy class="cursor-pointer inline-flex items-center gap-1 h-5.5 px-1.5 border-0 rounded-[5px] bg-transparent text-secondary font-sans text-[11px] hover:bg-fill-2 hover:text-label" title="${esc(t("copy"))}"><svg class="glyph size-3" viewBox="0 0 24 24" aria-hidden="true">${iconPaths("copy")}</svg>${esc(t("copy"))}</button></div><pre><code>${code}</code></pre></div>`;
    },
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

// a streaming answer re-renders on every frame: each finished block is parsed once
// ponytail: unbounded until 500 entries, then cleared; an LRU if long sessions show it
const cache = new Map<string, string>();
// the copy button's title is in the UI language: another language parses again
let cachedLang = "";
/** Markdown as HTML: raw HTML in it escaped, only web and mail links, vault notes as links. */
function mdHtml(text: string) {
  if (cachedLang !== currentLang()) {
    cachedLang = currentLang();
    cache.clear();
  }
  let html = cache.get(text);
  if (html === undefined) {
    if (cache.size > 500) cache.clear();
    html = marked.parse(text, { async: false }) as string;
    cache.set(text, html);
  }
  return html;
}
/** `mdHtml` for a component. Which notes exist (`notesVersion`, the workspace store's) and the UI language are part of
 *  what the result depends on, though only through module state: passing them makes memoisation on the arguments parse
 *  again when a note is made after the text was first drawn, or the language changes. */
export const markdownHtml = (text: string, _notesVersion: number, _lang: string) => mdHtml(text);
/** Markdown as HTML where the notes that link are the ones `known` says exist, not the vault's: a brain's note in
 *  the Brain view. Not cached, the view parses one note at a time. */
export function markdownWith(text: string, known: (target: string) => boolean) {
  const vault = noteKnown;
  noteKnown = known;
  try {
    return marked.parse(text, { async: false }) as string;
  } finally {
    noteKnown = vault;
  }
}
