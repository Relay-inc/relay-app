import { useState } from "react";
import type { CardView } from "../../../../domain/board/types";
import { useDetailsStore } from "../../../../application/today/details";
import { cardAct, loadCard } from "../../../../application/today/load";
import { provider } from "../../../../shared/plugins";
import { useT } from "../../../hooks/useT";
import { TicketActivity } from "../../board/TicketActivity";
import { ConnectedList } from "./ConnectedList";
import type { SectionDef, SectionProps } from "./types";

/** The tabs a card has under Today. */
export const cardTabs = (view: CardView | undefined, connected: number) =>
  [
    { id: "details", label: "today.tab.details", n: 0 },
    { id: "activity", label: "today.tab.activity", n: view?.feed.length ?? 0 },
    { id: "linked", label: "today.tab.connected", n: connected },
  ] as const;

/** A card under Today: its description and fields, its activity with the comment box (the ticket window's own), as
 *  the tracker has them. Read when it opens. The Connected tab is drawn by the detail (it knows the queue). */
export function CardSection({ entry, tab, connected }: SectionProps<"card">) {
  const { t } = useT();
  const id = entry.id;
  const item = entry.subject.card;
  const view = useDetailsStore(s => s.card[id]);
  const err = useDetailsStore(s => s.err[id]);
  const [actErr, setActErr] = useState("");
  if (tab === "linked") return <ConnectedList items={connected} />;
  if (err && !view) return <div className="err-box">{err}</div>;
  if (!view) return <div className="text-secondary text-sm">{t("kb.loading")}</div>;
  if (tab === "activity")
    return (
      <div className="flex flex-col gap-2 max-w-170">
        {actErr ? <div className="err-box">{actErr}</div> : null}
        <TicketActivity
          key={id}
          feed={view.feed}
          providerId={item.provider}
          providerName={provider(item.provider)?.name ?? ""}
          people={view.people}
          onComment={(text, mentions) =>
            cardAct(id, item, "comment", text, mentions).then(
              () => (setActErr(""), true),
              error => (setActErr(String(error)), false),
            )
          }
        />
      </div>
    );
  return (
    <div className="flex flex-col gap-4 max-w-170">
      {view.description.trim() ? (
        // the provider's HTML after its clean() or its safe Markdown
        <div className="md-panel text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: view.description }} />
      ) : (
        <div className="text-sm text-tertiary">{t("kb.noDesc")}</div>
      )}
      {view.labels.length ? (
        <div className="flex flex-wrap gap-1.5">
          {view.labels.map(label => (
            <span key={label} className="h-6 px-2 rounded-md bg-fill-2 text-xs text-secondary inline-flex items-center">
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
export const cardFacts: SectionDef<"card">["facts"] = (entry, day, t) => [
  [t("today.fact.due"), entry.subject.card.card.due ? day(entry.subject.card.card.due) : ""],
  [t("today.fact.labels"), (entry.subject.card.card.labels ?? []).join(", ")],
];
export const cardLoad: SectionDef<"card">["load"] = entry => void loadCard(entry.id, entry.subject.card);
