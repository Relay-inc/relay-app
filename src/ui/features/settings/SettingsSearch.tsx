import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { findRows, markWords, pickRow } from "../../../application/settings/search";
import { TABS } from "../../../application/settings/window";
import { isMac, modKey } from "../../../shared/platform";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

/** The search field at the top of the settings nav and, while something is typed, its results in place of the page
 *  list (`children`). Return or a click picks a result: its page opens, the row is rung, and the words are marked on
 *  the page while the query stays. Escape clears the field, Cmd-F (Ctrl-F) focuses it. */
export function SettingsSearch({ children }: { children: ReactNode }) {
  const { t, tn } = useT();
  const tab = useSettingsStore(s => s.tab);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (query.trim() ? findRows(query) : null), [query]);
  useEffect(() => markWords(tab, query), [tab, query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!modKey(e) || e.key !== "f") return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && query) {
      e.stopPropagation(); // the window closes on Escape, but not while there is something to clear
      setQuery("");
    } else if (results?.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive(a => (a + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (e.key === "Enter" && results?.[active]) pickRow(results[active]);
  };
  const tabName = (id: string) => t(TABS.find(x => x[0] === id)![1]);
  return (
    <>
      <label className="mb-2 flex h-7 items-center gap-1.5 rounded-lg bg-s-mutedbg px-2 text-[13px] text-s-muted">
        <Icon name="search" className="size-3.5 flex-none fill-none stroke-current stroke-2 glyph" />
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={t("set.search")}
          aria-label={t("set.search")}
          className="min-w-0 flex-1 appearance-none bg-transparent [&::-webkit-search-cancel-button]:hidden text-s-fg outline-none"
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="text-xs text-s-faint">{isMac() ? "⌘F" : "Ctrl+F"}</span>
      </label>
      {results === null ? (
        children
      ) : results.length === 0 ? (
        <p className="px-2 py-3 text-xs text-s-muted">{t("set.search.none")}</p>
      ) : (
        // the mouse goes down on a result without taking the focus from the field, so Escape keeps clearing it
        <div className="grid gap-0.5 pt-1" onMouseDown={e => e.preventDefault()}>
          <div className="px-2 py-1 text-xs font-semibold tracking-wider text-s-muted uppercase">
            {tn("set.search.results", results.length)}
          </div>
          {results.map((row, i) => (
            <button
              key={i}
              tabIndex={-1}
              className={`grid gap-px rounded-[7px] px-2 py-1.5 text-left ${i === active ? "bg-s-sel" : "hover:bg-s-hover"}`}
              onClick={() => {
                setActive(i);
                pickRow(row);
              }}
            >
              <span className="text-[13px] text-s-fg">{row.label}</span>
              <span className="text-xs text-s-muted">
                {[tabName(row.page), row.section].filter(Boolean).join(" › ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
