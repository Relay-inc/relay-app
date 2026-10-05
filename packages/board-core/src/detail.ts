import { Marked } from "marked";
import type { CardDetail, CardView } from "./types.ts";

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const safeUrl = (s: string = "") => /^https?:\/\//i.test(s) && !/[\x00-\x20]/.test(s) ? s : "";
// Never pass tracker HTML through to unsafeHTML. Markdown emits only its own markup;
// raw HTML is text, unsafe links lose their href, and images become links (the app's CSP blocks remote images).
const md = new Marked({ gfm: true, breaks: true, renderer: {
  html: ({ text }) => escapeHtml(text),
  link({ href, tokens }) {
    const text = this.parser.parseInline(tokens), url = safeUrl(href);
    return url ? `<a href="${escapeHtml(url)}">${text}</a>` : text;
  },
  image: ({ href, text }) => safeUrl(href) ? `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>` : escapeHtml(text),
} });
export const markdown = (text: string = "") => md.parse(text, { async: false });

/** Ticket providers share the cache, but own their reads and writes. */
export function ticketDetail(fetch: CardDetail<CardView>["fetch"], act: NonNullable<CardDetail<CardView>["act"]>) {
  const cache = new Map<string, CardView>();
  let generation = 0;
  const detail: CardDetail<CardView> = {
    cached: id => cache.get(id),
    fetch: async (c, ref, id) => {
      const g = generation, view = await fetch(c, ref, id);
      if (g === generation) cache.set(id, view);
      return view;
    },
    view: v => v,
    act,
  };
  return { detail, reset: () => { generation++; cache.clear(); } };
}
