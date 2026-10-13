import { useEffect, useState, type RefObject } from "react";
import { useConversationsStore } from "../../../application/conversations/store";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { chatWidth } from "./layout";

// The arrows over a conversation's log: back to its start, and down to the latest with a dot when output came in while
// you read back. Components of their own, so a streamed delta re-renders them and not the whole column.

const ARROW = "btn-icon relative size-8! rounded-full! bg-raised shadow-md ring-[0.5px] ring-separator-strong";

/** At the end: within the 80 px the log sticks at (ConversationsView). */
const atEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

/** Where the log is: a screen or more from its top, and at its end. Measured on every scroll, and once another
 * conversation in the same log laid out. */
function useLogPlace(log: RefObject<HTMLDivElement | null>, selected: string) {
  const [place, setPlace] = useState({ away: false, end: true });
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const measure = () => {
      const away = el.scrollTop > el.clientHeight;
      const end = atEnd(el);
      setPlace(p => (p.away === away && p.end === end ? p : { away, end }));
    };
    const frame = requestAnimationFrame(measure);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
    };
  }, [log, selected]);
  return place;
}

/** `go`: the log's owner scrolls and sets its following; `following`: whether the log follows the stream. */
type Props = { log: RefObject<HTMLDivElement | null>; selected: string; go: () => void; following?: () => boolean };

/** Back to the first message: zero height and sticky at the top, in the gutter right of the messages. */
export function ToStart({ log, selected, go }: Props) {
  const { t } = useT();
  const { away } = useLogPlace(log, selected);
  if (!away) return null;
  return (
    <div className={`sticky top-2 z-10 h-0 mx-auto w-full ${chatWidth} flex justify-end`}>
      <button className={`${ARROW} translate-x-1`} title={t("chat.toTop")} aria-label={t("chat.toTop")} onClick={go}>
        <Icon name="top" className="glyph size-4" />
      </button>
    </div>
  );
}

/** Down to the latest, once the log left its end: zero height and sticky at the bottom, centred over the messages.
 * `go` sticks the log again, so the stream is followed from there. */
export function ToLatest({ log, selected, go, following }: Props) {
  const { t } = useT();
  const { end } = useLogPlace(log, selected);
  // output while the log does not follow: the store's items for this conversation change, a delta included
  const [fresh, setFresh] = useState(false);
  // read at the end, or another conversation: no dot
  useEffect(() => {
    const el = log.current;
    const seen = () => el && atEnd(el) && setFresh(false);
    const frame = requestAnimationFrame(() => setFresh(false));
    el?.addEventListener("scroll", seen, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el?.removeEventListener("scroll", seen);
    };
  }, [log, selected]);
  useEffect(
    () =>
      useConversationsStore.subscribe((s, prev) => {
        if (s.messages[selected] !== prev.messages[selected] && !following?.()) setFresh(true);
      }),
    [following, selected],
  );
  if (end) return null;
  const label = t(fresh ? "chat.toEndNew" : "chat.toEnd");
  return (
    <div className="sticky bottom-3 z-10 h-0 flex justify-center">
      <button className={`${ARROW} -translate-y-full`} title={label} aria-label={label} onClick={go}>
        <Icon name="bottom" className="glyph size-4" />
        {fresh ? <span className="absolute top-0 right-0 size-2 rounded-full bg-accent ring-2 ring-raised" /> : null}
      </button>
    </div>
  );
}
