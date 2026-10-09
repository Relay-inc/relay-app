import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Status } from "../../../domain/today/plan";
import { KINDS, kindLabelKey } from "../../../domain/today/kinds";
import {
  putOff,
  selectEntry,
  snooze,
  snoozeOptions,
  type Entry,
  type TodayModel,
  openTicketOf,
  projectChip,
} from "../../../application/today/today";
import { actionsOf, setStatus, type Action } from "../../../application/today/actions";
import { setPop, setTab, useDetailsStore } from "../../../application/today/details";
import { cardAct, toastAssigned } from "../../../application/today/load";
import { ticketLinks, openLinked } from "../../../application/board/board";
import { provider } from "../../../shared/plugins";
import { t as translate } from "../../../shared/i18n";
import { timeOf } from "../../../application/calendar/calendar";
import { projectLabel } from "../../../application/workspace/vault";
import { prsOfCard, ticketOf } from "../../../application/today/links";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { cardKey } from "../../../domain/navigation/keys";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { MailComposer } from "./sections/MailSection";
import { prTabs } from "./sections/PrSection";
import { cardTabs } from "./sections/CardSection";
import { ConnectedList } from "./sections/ConnectedList";
import { sectionOf } from "./sections";
import type { Connected } from "./sections/types";
import { ICON_BUTTON } from "./parts";

const BUTTON =
  "inline-flex items-center gap-1.5 h-7.5 px-2.5 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer";
const MENU = "absolute top-9 z-20 w-60 p-1 rounded-[10px] bg-raised shadow-xl ring-[0.5px] ring-separator-strong";

/** The item open next to the queue. On top where it is from and why it is here, its title and its actions (the
 *  main two as buttons, the rest under "…", snooze, later and done on the right). Below that the item itself, per
 *  kind and per tab, and at the bottom its status, when it is planned, what is known about it and what else in the
 *  queue it connects to. */
export function TodayDetail({ model }: { model: TodayModel }) {
  const { t } = useT();
  const entry = model.selected;
  const tabOf = useDetailsStore(s => (entry ? s.tab[entry.id] : ""));
  const pop = useDetailsStore(s => s.pop);
  const prDetail = useDetailsStore(s => (entry?.subject.type === "pr" ? s.pr[entry.id] : undefined));
  const cardView = useDetailsStore(s => (entry?.subject.type === "card" ? s.card[entry.id] : undefined));

  // what the item needs from its source, fetched when it opens
  const entryId = entry?.id ?? "";
  // once per item it opens on: the clock rebuilds the items every 30 seconds, that is no reason to read them again
  const load = useEffectEvent(() => {
    if (entry) sectionOf(entry).load?.(entry);
  });
  useEffect(() => load(), [entryId]);

  if (!entry) {
    const next = model.meetings.find(meeting => Date.parse(meeting.start) > model.now);
    return (
      <div className="flex flex-col items-center gap-2 py-18">
        <span className="grid place-items-center size-11 rounded-full bg-add-bg text-add-fg">
          <Icon name="check" className="glyph size-5.5" />
        </span>
        <span className="text-[17px] font-semibold">{t("today.cleared")}</span>
        <span className="text-secondary">
          {next ? t("today.nextMeeting", { title: next.title, time: timeOf(next.start) }) : t("wait.noneSub")}
        </span>
      </div>
    );
  }

  const { acts, done } = actionsOf(entry);
  const s = entry.subject;
  const connected = connectedOf(model, entry);
  const chip = projectChip(entry.project);
  const tabs = s.type === "pr" ? prTabs(prDetail) : s.type === "card" ? cardTabs(cardView, connected.length) : [];
  const tab = tabOf || tabs[0]?.id || "";

  const { Body } = sectionOf(entry);

  return (
    <div className="min-w-0 min-h-0 flex flex-col">
      <div className="flex-none flex flex-col gap-2.5 mx-10 pt-8 pb-5 border-b border-separator">
        {/* what it is and where from, said once and quietly; the title; then its facts and the next step */}
        <span className="text-xs text-tertiary truncate">
          {[t(kindLabelKey(entry)), chip?.label, entry.where].filter(Boolean).join(" · ")}
        </span>
        <h1 className="m-0 text-2xl leading-snug font-semibold tracking-tight text-pretty select-text">
          {entry.title}
        </h1>
        <Meta entry={entry} />
        <ActionBar entry={entry} acts={acts} done={done} pop={pop} now={model.now} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-10 pt-6 pb-8 select-text cursor-auto">
        <Body entry={entry} tab={tab} connected={connected} />
        {tabs.length > 1 ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6">
            {tabs
              .filter(item => item.id !== tab)
              .map(item => (
                <button
                  key={item.id}
                  onClick={() => setTab(entry.id, item.id)}
                  className="inline-flex items-center gap-1.5 text-[13px] text-secondary cursor-pointer hover:text-label"
                >
                  {t(item.label)}
                  {item.n ? <span className="text-tertiary tabular-nums">{item.n}</span> : null}
                  <Icon name="chevron" className="glyph size-3 -rotate-90 text-tertiary" />
                </button>
              ))}
          </div>
        ) : null}
        {connected.length && s.type !== "card" ? (
          <div className="flex flex-col gap-1.5 mt-6 max-w-170">
            <span className="text-[13px] text-tertiary">{t("today.connected")}</span>
            <ConnectedList items={connected} />
          </div>
        ) : null}
      </div>
      {s.type === "mail" ? <MailComposer /> : null}
    </div>
  );
}

/** The next step as one primary button and one secondary (done, when the item has one); everything else, snooze and
 *  later under "…" on the right. The keys still work (Enter, Backspace, E, S, L), they are just not printed. */
function ActionBar({
  entry,
  acts,
  done,
  pop,
  now,
}: {
  entry: Entry;
  acts: Action[];
  done?: Action;
  pop: string;
  now: number;
}) {
  const { t, locale } = useT();
  const more = useRef<HTMLDivElement>(null);
  useDismiss(more, pop === "more", () => setPop(""));
  const [first, ...others] = acts;
  const second = done ?? others[0];
  const rest = others.filter(action => action !== second);
  const run = (action: Action) => {
    setPop("");
    action.run();
  };
  const item =
    "w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill-2";
  return (
    <div className="flex items-center gap-2 mt-1 min-w-0">
      {first ? (
        <button
          title={first.tip}
          onClick={() => run(first)}
          className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}
        >
          {first.label}
        </button>
      ) : null}
      {second ? (
        <button
          title={second.tip}
          onClick={() => run(second)}
          className={`${BUTTON} border border-separator-strong hover:bg-fill`}
        >
          {second.label}
        </button>
      ) : null}
      <span className="flex-1" />
      {/* a meeting is not snoozed or put off: its other actions (join, record) are icons, there is no "…" */}
      {entry.subject.type === "meeting" ? (
        rest.map(action => (
          <button
            key={action.label}
            className={ICON_BUTTON}
            title={action.tip ?? action.label}
            aria-label={action.label}
            onClick={() => run(action)}
          >
            <Icon name={action.icon ?? "more"} className="glyph size-4.5" />
          </button>
        ))
      ) : (
        <div ref={more} className="relative">
          <button
            className={`${ICON_BUTTON} ${pop === "more" || pop === "snooze" ? "bg-fill-2" : ""}`}
            title={t("today.moreActions")}
            aria-label={t("today.moreActions")}
            onClick={() => setPop("more")}
          >
            <Icon name="more" className="glyph size-4.5" />
          </button>
          {pop === "more" || pop === "snooze" ? (
            <div className={`${MENU} right-0`}>
              {rest.map(action => (
                <button key={action.label} title={action.tip} onClick={() => run(action)} className={item}>
                  {action.icon ? (
                    <Icon name={action.icon} className="glyph size-3.5 text-secondary" />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className="flex-1">{action.label}</span>
                </button>
              ))}
              {rest.length ? <div className="my-1 h-px bg-separator" /> : null}
              {snoozeOptions(now).map(option => (
                <button
                  key={option.id}
                  onClick={() => {
                    setPop("");
                    snooze(entry, option.days);
                  }}
                  className={item}
                >
                  <Icon name="clock" className="glyph size-3.5 text-secondary" />
                  <span className="flex-1">{t("today.snoozeFor", { when: t(`today.snooze.${option.id}`) })}</span>
                  <span className="text-xs text-tertiary">
                    {new Date(now + option.days * 864e5).toLocaleDateString(locale, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </button>
              ))}
              <button
                onClick={() => {
                  setPop("");
                  putOff(entry.id);
                }}
                className={item}
              >
                <Icon name="later" className="glyph size-3.5 text-secondary" />
                <span className="flex-1">{t("today.later")}</span>
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------- the bottom: status, when, facts, connected
/** Other items of the same project in the queue, and for a card the conversations and PRs it links to. */
function connectedOf(model: TodayModel, entry: Entry): Connected[] {
  const same = model.queue
    .filter(other => other.id !== entry.id && entry.project && other.project === entry.project)
    .slice(0, 5)
    .map(other => ({
      id: other.id,
      icon: KINDS[other.kind].icon,
      title: other.title,
      meta: other.why,
      go: () => selectEntry(other.id),
    }));
  const s = entry.subject;
  // a PR: the ticket it is about first
  if (s.type === "pr") {
    const link = ticketOf(s.pr.url);
    const pr = s.pr;
    return link?.card
      ? [
          {
            id: `ticket:${link.card}`,
            icon: "board",
            title: `${link.number ? `${/^\d+$/.test(link.number) ? "#" : ""}${link.number} ` : ""}${link.title ?? ""}`,
            meta: translate("today.link.ticket"),
            go: () => openTicketOf(pr),
          },
          ...same,
        ]
      : same;
  }
  if (s.type !== "card") return same;
  const tracker = provider(s.card.provider);
  if (!tracker) return same;
  const links = ticketLinks(tracker, cardKey(tracker.id, s.card.card.id), s.card.card.number);
  // the PRs Relay linked to this card, as their item under Today when they are there
  const all = usePullRequestsStore.getState().list;
  const linked = prsOfCard(tracker.id, s.card.card.id)
    .map(url => [...(all?.review ?? []), ...(all?.mine ?? [])].find(pr => pr.url === url))
    .filter((pr): pr is NonNullable<typeof pr> => !!pr && !links.prs.some(x => x.url === pr.url))
    .map(pr => {
      const item = model.queue.find(other => other.subject.type === "pr" && other.subject.pr.url === pr.url);
      return {
        id: pr.url,
        icon: "pr",
        title: pr.title,
        meta: `${pr.repo} #${pr.number}`,
        go: () => (item ? selectEntry(item.id) : openLinked({ repo: pr.repo, number: pr.number })),
      };
    });
  return [
    ...linked,
    ...links.conversations.map(c => ({
      id: c.key,
      icon: "chat",
      title: c.title,
      meta: projectLabel(c.project),
      go: () => openLinked({ conversation: c.key }),
    })),
    ...links.prs.map(pr => ({
      id: pr.url,
      icon: "pr",
      title: pr.title,
      meta: `${pr.repo} #${pr.number}`,
      go: () => openLinked({ repo: pr.repo, number: pr.number }),
    })),
    ...same,
  ];
}
// a fact as label and value; the value of a picker is a select that looks like text until hovered
const PILL = "inline-flex items-center gap-1.5 text-[13px]";
const PICK =
  "appearance-none bg-transparent outline-0 text-[13px] text-label cursor-pointer max-w-52 rounded px-0.5 -mx-0.5 hover:bg-fill-2";

/** Under the title: the status (the tracker's own for a card) and the assignee as small pickers,
 *  then what is known that the header does not say already. */
function Meta({ entry }: { entry: Entry }) {
  const { locale, t } = useT();
  const facts = factsOf(entry, locale, t).filter(([, value]) => value && value !== "–");
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {/* a ticket's status in its tracker; the rest is done with Done, its status says nothing new */}
      {entry.subject.type === "card" ? <StatusPick entry={entry} /> : null}
      <AssigneePick entry={entry} />
      {facts.map(([label, value]) => (
        <span key={label} className="text-[13px] whitespace-nowrap max-w-72 truncate" title={value}>
          <span className="text-tertiary">{label}</span> {value}
        </span>
      ))}
    </div>
  );
}

// what is known about the item that its header (kind, where, why, title) does not show, as label and value
function factsOf(entry: Entry, locale: string, t: ReturnType<typeof useT>["t"]): [string, string][] {
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return sectionOf(entry).facts?.(entry, day, t) ?? [];
}

/** The status as a small picker: a card's own workflow in its tracker, else to do / in progress / done (setStatus). */
function StatusPick({ entry }: { entry: Entry }) {
  const { t } = useT();
  const s = entry.subject;
  const view = useDetailsStore(st => (s.type === "card" ? st.card[entry.id] : undefined));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    await job().catch(error => setErr(String(error)));
    setBusy(false);
  };
  const tracker = s.type === "card" && view?.statuses?.length ? view : null;
  const current = tracker ? (tracker.statuses!.find(x => x.id === tracker.status?.id) ?? null) : null;
  return (
    <span className={`${PILL} ${busy ? "opacity-60" : ""}`} title={err || t(`today.doneIn.${entry.kind}`)}>
      <span className={err ? "text-late" : "text-tertiary"}>{t("today.fact.status")}</span>
      {tracker && s.type === "card" ? (
        <select
          className={PICK}
          disabled={busy}
          value={current?.id ?? ""}
          onChange={e => run(() => cardAct(entry.id, s.card, "status", e.target.value))}
        >
          {tracker.statuses!.map(x => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          className={PICK}
          disabled={busy}
          value={entry.status}
          onChange={e => run(() => setStatus(entry, e.target.value as Status))}
        >
          {(["todo", "doing", "done"] as Status[]).map(x => (
            <option key={x} value={x}>
              {t(`today.status.${x}`)}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

/** Who has the card, as a small picker (a tracker with one assignee: Productive, Linear); assigning it to someone
 *  else takes it off Today, the toast says to whom. */
function AssigneePick({ entry }: { entry: Entry }) {
  const { t } = useT();
  const s = entry.subject;
  const view = useDetailsStore(st => (s.type === "card" ? st.card[entry.id] : undefined));
  const [busy, setBusy] = useState(false);
  if (s.type !== "card" || !view?.people?.length || view.assignees) return null;
  return (
    <span className={`${PILL} ${busy ? "opacity-60" : ""}`}>
      <span className="text-tertiary">{t("today.assignee")}</span>
      <select
        className={PICK}
        disabled={busy}
        value={view.assignee?.id ?? ""}
        onChange={async e => {
          const id = e.target.value;
          setBusy(true);
          await cardAct(entry.id, s.card, "assignee", id).then(
            () => toastAssigned(view.people!.find(p => p.id === id)?.name ?? ""),
            error => toastAssigned(String(error)),
          );
          setBusy(false);
        }}
      >
        <option value="">{t("today.unassigned")}</option>
        {view.people.map(person => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </span>
  );
}
