import { marked } from "marked";
import { t, currentLang } from "./i18n";
import { iconPaths } from "./icons";
import { esc } from "./html";

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
    // a code block with a copy button in its corner on hover (the app copies it, src/ui/app/App.tsx)
    code: ({ text }) =>
      `<div class="relative group/code"><pre><code>${esc(text)}</code></pre><button data-copy class="absolute top-1.5 right-1.5 grid place-items-center size-6 rounded-sm border-0 bg-bg text-secondary opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100" title="${esc(t("copy"))}" aria-label="${esc(t("copy"))}"><svg class="glyph size-3.5" viewBox="0 0 24 24" aria-hidden="true">${iconPaths("copy")}</svg></button></div>`,
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
