import { searchRows, words, matchRanges, type SearchRow } from "../../domain/settings/search";
import { t } from "../../shared/i18n";
import { go } from "./window";
import type { SettingsTab } from "./store";

/** Words that find a setting but are not in its text, English only: the label's key, the words. */
const SYNONYMS = [
  ["set.keepAwake", "sleep lid caffeinate"],
  ["set.theme", "dark light appearance mode"],
] as const;

export type IndexedRow = SearchRow & { page: SettingsTab; el: HTMLElement };

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";

/** The setting rows of every mounted page, read from the DOM: Field marks a row and its label and hint, Section its
 *  title, SettingsApp the page. Rows that are not rendered are not there. */
export function indexRows(): IndexedRow[] {
  const extra = new Map(SYNONYMS.map(([key, more]) => [t(key), more]));
  return [...document.querySelectorAll<HTMLElement>("[data-search-row]")].flatMap(el => {
    const page = el.closest<HTMLElement>("[data-search-page]")?.dataset.searchPage as SettingsTab | undefined;
    const label = text(el.querySelector("[data-search-label]"));
    if (!page || !label) return [];
    const section = text(el.closest("[data-search-section]")?.querySelector("[data-search-title]"));
    return [{ page, label, section, hint: text(el.querySelector("[data-search-hint]")), extra: extra.get(label), el }];
  });
}

export const findRows = (query: string) => searchRows(indexRows(), query).map(hit => hit.row);

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Opens the row's page, scrolls to it and rings it for 1.5 s (a static outline with reduced motion). */
export function pickRow(row: IndexedRow) {
  go(row.page);
  // the page takes part in the layout once React has drawn it
  requestAnimationFrame(() => {
    const el = row.el;
    el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
    const ring = "inset 0 0 0 2px var(--s-ring)";
    if (reduced()) {
      el.style.boxShadow = ring;
      setTimeout(() => (el.style.boxShadow = ""), 1500);
    } else
      el.animate(
        [{ boxShadow: ring }, { boxShadow: ring, offset: 0.6 }, { boxShadow: "inset 0 0 0 2px transparent" }],
        1500,
      );
  });
}

/** Marks the words of the query in the text of a page (the CSS highlight `settings-search`), none for an empty query. */
export function markWords(page: string, query: string) {
  if (!("highlights" in CSS)) return;
  const ws = words(query);
  const ranges: Range[] = [];
  const root = ws.length ? document.querySelector(`[data-search-page="${page}"]`) : null;
  if (root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode())
      for (const [start, end] of matchRanges(node.textContent ?? "", ws)) {
        const range = new Range();
        range.setStart(node, start);
        range.setEnd(node, end);
        ranges.push(range);
      }
  }
  if (ranges.length) CSS.highlights.set("settings-search", new Highlight(...ranges));
  else CSS.highlights.delete("settings-search");
}
