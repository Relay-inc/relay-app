import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { locate, occurrences } from "../../../domain/conversations/find";
import { useNavigationStore } from "../../../application/navigation/store";
import { useUiRequest } from "../../hooks/useUiRequest";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { strip } from "./layout";

// the CSS Custom Highlight API marks the matches without touching the DOM React owns (conversations.css)
const ALL = "relay-find";
const NOW = "relay-find-now";

/** Where `query` occurs in what `root` shows, as ranges: its text nodes joined, hidden ones (a closed step) left out.
 *  ponytail: the joined text has no break between two blocks, so a query can match across a paragraph's end */
function search(root: HTMLElement, query: string): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data || !node.parentElement?.checkVisibility()) continue;
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  }
  return occurrences(text, query).map(([from, to]) => {
    const [first, start] = locate(starts, from);
    const [last, end] = locate(starts, to, true);
    const range = document.createRange();
    range.setStart(nodes[first], start);
    range.setEnd(nodes[last], end);
    return range;
  });
}

type Props = {
  className: string;
  log: RefObject<HTMLDivElement | null>;
  msgs: RefObject<HTMLDivElement | null>;
  /** the log stops following the stream: a match is being shown */
  onJump: () => void;
};

/** ⌘F over the open conversation: a field above the log, its matches marked, ↵ and ⇧↵ walk them, Esc closes. */
export function FindBar({ className, log, msgs, onJump }: Props) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Range[]>([]);
  const [now, setNow] = useState(0);
  // the next marking scrolls to the current match: after typing or ↵, not when the stream adds text
  const jump = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  useUiRequest("find", () => {
    setOpen(true);
    requestAnimationFrame(() => field.current?.select());
  });

  // the log keeps changing while a turn streams or a step unfolds: search again once it settles
  useEffect(() => {
    const root = msgs.current;
    if (!open || !query || !root) return;
    let timer = 0;
    const run = () => {
      timer = 0;
      setFound(search(root, query));
    };
    run();
    const observer = new MutationObserver(() => {
      if (!timer) timer = window.setTimeout(run, 200);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      setFound([]);
    };
  }, [open, query, selected, msgs]);

  const at = Math.min(now, found.length - 1);
  useEffect(() => {
    if (at < 0) return;
    CSS.highlights.set(ALL, new Highlight(...found));
    CSS.highlights.set(NOW, new Highlight(found[at]));
    const el = log.current;
    if (jump.current && el) {
      jump.current = false;
      const box = found[at].getBoundingClientRect();
      const view = el.getBoundingClientRect();
      if (box.top < view.top || box.bottom > view.bottom) {
        onJump();
        el.scrollBy({ top: box.top - view.top - view.height / 3 });
      }
    }
    return () => {
      CSS.highlights.delete(ALL);
      CSS.highlights.delete(NOW);
    };
  }, [found, at, log, onJump]);

  if (!open) return null;
  const step = (by: number) => {
    if (!found.length) return;
    jump.current = true;
    setNow((at + by + found.length) % found.length);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      // before the app's Esc, which would close the drawer or stop the turn
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div className={className}>
      <div className={`${strip} border border-separator bg-fill`}>
        <Icon name="search" className="glyph size-3.5 flex-none stroke-2 text-tertiary" />
        <input
          ref={field}
          autoFocus
          className="min-w-0 flex-1 text-sm text-label outline-none select-text placeholder:text-tertiary"
          value={query}
          placeholder={t("find.placeholder")}
          onChange={e => {
            jump.current = true;
            setNow(0);
            setQuery(e.target.value);
          }}
          onKeyDown={onKey}
        />
        {query ? (
          <span className="text-xs text-tertiary whitespace-nowrap">
            {found.length ? t("find.count", { i: at + 1, n: found.length }) : t("find.none")}
          </span>
        ) : null}
        <button
          className="btn-icon"
          title={t("find.prev")}
          aria-label={t("find.prev")}
          disabled={!found.length}
          onClick={() => step(-1)}
        >
          <Icon name="down" className="glyph size-4 rotate-180" />
        </button>
        <button
          className="btn-icon"
          title={t("find.next")}
          aria-label={t("find.next")}
          disabled={!found.length}
          onClick={() => step(1)}
        >
          <Icon name="down" className="glyph size-4" />
        </button>
        <button
          className="btn-icon"
          title={t("find.close")}
          aria-label={t("find.close")}
          onClick={() => setOpen(false)}
        >
          <Icon name="close" className="glyph size-4" />
        </button>
      </div>
    </div>
  );
}
