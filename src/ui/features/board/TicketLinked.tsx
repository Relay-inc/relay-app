import type { BoardProvider } from "../../../domain/board/types";
import { openLinked, ticketLinks } from "../../../application/board/board";
import { projectLabel } from "../../../application/workspace/vault";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { TicketHeading } from "./TicketHeading";

const ROW = "w-full text-left flex items-center gap-2.5 h-10 px-3 border-0 bg-transparent hover:bg-fill cursor-default";

/** What the card links to in the app: the conversations started from it, and the pull requests that name its number.
 *  A row opens it, and nothing shows when there is none. */
export function TicketLinked({ provider, card, number }: { provider: BoardProvider; card: string; number: string }) {
  const { t } = useT();
  const { conversations, prs } = useDerived(() => ticketLinks(provider, card, number));
  if (!conversations.length && !prs.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <TicketHeading>{t("kb.linked")}</TicketHeading>
      <div className="flex flex-col border border-separator rounded-[10px] overflow-hidden divide-y divide-separator">
        {conversations.map(c => (
          <button key={c.key} type="button" className={ROW} onClick={() => openLinked({ conversation: c.key })}>
            <Icon name="chat" className="glyph size-3.5 text-secondary" />
            <span className="flex-1 truncate">{c.title}</span>
            <span className="text-xs text-secondary whitespace-nowrap">
              {[t("kb.linkedChat"), c.project && projectLabel(c.project)].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))}
        {prs.map(pr => (
          <button
            key={pr.url}
            type="button"
            className={ROW}
            onClick={() => openLinked({ repo: pr.repo, number: pr.number })}
          >
            <Icon name="pr" className="glyph size-3.5 text-ok" />
            <span className="flex-1 truncate">{pr.title}</span>
            <span className="font-mono text-[11px] text-secondary whitespace-nowrap">
              {pr.repo} #{pr.number}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
