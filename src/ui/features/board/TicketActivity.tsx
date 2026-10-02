import { useState } from "react";
import type { CardView } from "../../../domain/board/types";
import { useT } from "../../hooks/useT";
import { Avatar } from "../../components/Avatar";
import { TicketFiles } from "./TicketFiles";
import { TicketHeading } from "./TicketHeading";
import { when } from "./format";

/** The card's feed, newest first (comments as the provider's cleaned HTML, changes as text), and the comment box:
 *  Cmd-Enter or Comment sends, and what was typed goes once the tracker took it. */
export function TicketActivity({
  feed,
  providerName,
  onComment,
}: {
  feed: CardView["feed"];
  providerName: string;
  onComment: (text: string) => Promise<boolean>;
}) {
  const { t, locale } = useT();
  const [text, setText] = useState("");
  const send = async () => {
    if (text.trim() && (await onComment(text))) setText("");
  };
  return (
    <section className="flex flex-col gap-1">
      <div className="mb-1.5">
        <TicketHeading>{t("kb.activity")}</TicketHeading>
      </div>
      {feed.map((entry, i) => (
        // newest first: counted from the oldest, an entry keeps its key when a new one comes in
        <div key={feed.length - i} className="flex gap-3 py-2">
          <Avatar name={entry.who || providerName} size="size-6 text-[9px]" />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex gap-2 text-xs">
              <b className="font-semibold">{entry.who || providerName}</b>
              <span className="text-tertiary tabular-nums">{when(entry.at, locale)}</span>
            </div>
            {entry.html ? (
              // the provider's HTML after its clean() or its safe Markdown
              <div className="md-panel text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: entry.html }} />
            ) : (
              entry.change && <div className="text-sm text-secondary">{entry.change}</div>
            )}
            {!!entry.files.length && <TicketFiles files={entry.files} />}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2.5 mt-2 py-2 pl-3.5 pr-2 rounded-xl border border-separator-strong bg-raised">
        <textarea
          className="flex-1 min-w-0 border-0 outline-none bg-transparent text-sm text-label resize-none p-0"
          rows={1}
          placeholder={t("kb.commentPh")}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="h-7 px-3 rounded-[7px] border-0 bg-fill-2 text-secondary text-xs font-medium hover:text-label"
          onClick={send}
        >
          {t("kb.comment")}
        </button>
      </div>
    </section>
  );
}
