import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { Status } from "../../../domain/today/plan";
import {
  actionsOf,
  putOff,
  selectEntry,
  setStatus,
  snooze,
  snoozeOptions,
  type Action,
  type Entry,
  type TodayModel,
  openTicketOf,
  projectChip,
} from "../../../application/today/today";
import { setPop, setTab, useDetailsStore } from "../../../application/today/details";
import { cardAct, loadCard, loadPr, toastAssigned } from "../../../application/today/load";
import { ticketLinks, openLinked } from "../../../application/board/board";
import { provider } from "../../../shared/plugins";
import { t as translate } from "../../../shared/i18n";
import { isQuestion } from "../../../domain/conversations/rules";
import { timeOf } from "../../../application/calendar/calendar";
import { lastAi } from "../../../application/conversations/selectors";
import { openMail } from "../../../application/navigation/panel";
import { projectLabel } from "../../../application/workspace/vault";
import { prsOfCard, ticketOf } from "../../../application/today/links";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { cardKey } from "../../../domain/navigation/keys";
import { useDismiss } from "../../hooks/useDismiss";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { PendingRequest } from "../conversations/PendingRequest";
import { MailComposer, MailSection } from "./sections/MailSection";
import { PrSection, prTabs } from "./sections/PrSection";
import { CardSection, cardTabs } from "./sections/CardSection";
import { MeetingSection } from "./sections/MeetingSection";
import { Caps, KIND_ICON, Kbd, TINT_DOT, TONE_TEXT } from "./parts";

const BUTTON =
  "inline-flex items-center gap-1.5 h-7.5 px-2.5 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer";
const ICON_BUTTON =
  "grid place-items-center size-7.5 rounded-lg text-secondary cursor-pointer hover:bg-fill-2 hover:text-label";
const MENU = "absolute top-9 z-20 w-60 p-1 rounded-[10px] bg-raised shadow-xl ring-[0.5px] ring-separator-strong";

/** What kind of item it is, as the chip in front of where it is from says it. */
const kindLabel = (entry: Entry) =>
  entry.subject.type === "ask"
    ? isQuestion(entry.subject.request)
      ? "today.kind.question"
      : "today.kind.ask"
    : (`today.kind.${entry.kind}` as const);

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
  const subject = entry?.subject;
  const entryId = entry?.id ?? "";
  // once per item it opens on: the clock rebuilds the items every 30 seconds, that is no reason to read them again
  const load = useEffectEvent(() => {
    if (!subject) return;
    if (subject.type === "mail") openMail(subject.key);
    if (subject.type === "pr") loadPr(entryId, subject.pr);
    if (subject.type === "card") loadCard(entryId, subject.card);
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

  const body = (): ReactNode => {
    switch (s.type) {
      case "ask":
        return <AskBody entry={entry} />;
      case "blocked":
        return (
          <p className="m-0 text-sm text-secondary">
            {t("wait.bg", { date: s.session.startedAt ? new Date(s.session.startedAt).toLocaleDateString() : "" })}
          </p>
        );
      case "meeting":
        return <MeetingSection meeting={s.meeting} after={entry.kind === "note"} />;
      case "reminder":
        return s.reminder.text !== s.reminder.title ? (
          <Markdown text={s.reminder.text} className="text-sm leading-relaxed text-secondary max-w-170" />
        ) : null;
      case "card":
        return tab === "linked" ? (
          <ConnectedList items={connected} />
        ) : (
          <CardSection id={entry.id} item={s.card} tab={tab} />
        );
      case "pr":
        return <PrSection id={entry.id} tab={tab} pr={s.pr} />;
      case "mail":
        return <MailSection mailKey={s.key} id={s.mail.id} />;
      case "chat":
        return <ChatBody chat={s.key} />;
    }
  };

  return (
    <div className="min-w-0 min-h-0 flex flex-col">
      <div className="flex-none flex flex-col gap-2 px-7 pt-4.5">
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span className="inline-flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-[7px] bg-fill-2 text-label font-medium whitespace-nowrap">
            <span
              className={`grid place-items-center size-4.5 rounded-[5px] bg-raised ${entry.tone ? TONE_TEXT[entry.tone] : "text-accent-text"}`}
            >
              <Icon name={KIND_ICON[entry.kind]} className="glyph size-3" />
            </span>
            {t(kindLabel(entry))}
          </span>
          {chip ? (
            <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-[7px] bg-fill-2 text-label font-medium whitespace-nowrap max-w-56">
              <span className={`size-1.75 rounded-full flex-none ${TINT_DOT[chip.tint]}`} />
              <span className="truncate">{chip.label}</span>
            </span>
          ) : null}
          <span className="flex-1 min-w-0 truncate">{entry.where}</span>
          <span className={`font-semibold whitespace-nowrap ${TONE_TEXT[entry.tone]}`}>{entry.why}</span>
        </div>
        <h1 className="m-0 mt-0.5 text-xl leading-snug font-semibold tracking-tight text-pretty select-text">
          {entry.title}
        </h1>
        <Meta entry={entry} />
        <ActionBar entry={entry} acts={acts} done={done} pop={pop} now={model.now} />
        {tabs.length ? (
          <div className="flex gap-4.5 mt-2 border-b border-separator">
            {tabs.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(entry.id, item.id)}
                className={`inline-flex items-center gap-1.5 h-8.5 text-[13px] font-medium cursor-pointer ${tab === item.id ? "text-label shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-secondary hover:text-label"}`}
              >
                {t(item.label)}
                {item.n ? (
                  <span className="min-w-4.5 h-4.5 px-1.25 rounded-full bg-fill-2 text-secondary text-[11px] grid place-items-center">
                    {item.n}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pt-4.5 pb-7 select-text cursor-auto">
        {body()}
        {connected.length && s.type !== "card" ? (
          <div className="flex flex-col gap-1.5 mt-6 max-w-170">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              {t("today.connected")}
            </span>
            <ConnectedList items={connected} />
          </div>
        ) : null}
      </div>
      {s.type === "mail" ? <MailComposer /> : null}
    </div>
  );
}

/** The main two actions, the rest under "…", and on the right snooze, later and done. */
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
  const snoozeRef = useRef<HTMLDivElement>(null);
  useDismiss(more, pop === "more", () => setPop(""));
  useDismiss(snoozeRef, pop === "snooze", () => setPop(""));
  const main = acts.slice(0, 2);
  const rest = acts.slice(2);
  const run = (action: Action) => {
    setPop("");
    action.run();
  };
  return (
    <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
      {main.map((action, i) => (
        <button
          key={action.label}
          title={action.tip}
          onClick={() => run(action)}
          className={`${BUTTON} ${i === 0 ? "bg-accent text-on-accent hover:bg-accent-hover" : action.key === "⌫" ? "border border-separator-strong hover:bg-fill" : "text-secondary hover:bg-fill-2 hover:text-label"}`}
        >
          {action.icon ? <Icon name={action.icon} className="glyph size-3.5" /> : null}
          {action.label}
          {action.key ? <Kbd onAccent={i === 0}>{action.key}</Kbd> : null}
        </button>
      ))}
      {rest.length ? (
        <div ref={more} className="relative">
          <button
            className={`${ICON_BUTTON} ${pop === "more" ? "bg-fill-2" : ""}`}
            title={t("today.moreActions")}
            aria-label={t("today.moreActions")}
            onClick={() => setPop("more")}
          >
            <Icon name="more" className="glyph size-4" />
          </button>
          {pop === "more" ? (
            <div className={`${MENU} left-0`}>
              {rest.map(action => (
                <button
                  key={action.label}
                  title={action.tip}
                  onClick={() => run(action)}
                  className="w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill-2"
                >
                  {action.icon ? (
                    <Icon name={action.icon} className="glyph size-3.5 text-secondary" />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className="flex-1">{action.label}</span>
                  {action.key ? <span className="font-mono text-[11px] text-tertiary">{action.key}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <span className="flex-1" />
      <div ref={snoozeRef} className="relative">
        <button
          className={`${ICON_BUTTON} ${pop === "snooze" ? "bg-fill-2" : ""}`}
          title={t("today.snoozeKey")}
          aria-label={t("today.snoozeKey")}
          onClick={() => setPop("snooze")}
        >
          <Icon name="clock" className="glyph size-4" />
        </button>
        {pop === "snooze" ? (
          <div className={`${MENU} right-0`}>
            <div className="px-2 pt-1.5 pb-1">
              <Caps>{t("today.offUntil")}</Caps>
            </div>
            {snoozeOptions(now).map(option => (
              <button
                key={option.id}
                onClick={() => {
                  setPop("");
                  snooze(entry, option.days);
                }}
                className="w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill-2"
              >
                <span className="flex-1">{t(`today.snooze.${option.id}`)}</span>
                <span className="text-xs text-tertiary">
                  {new Date(now + option.days * 864e5).toLocaleDateString(locale, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        className={ICON_BUTTON}
        title={t("today.laterKey")}
        aria-label={t("today.laterKey")}
        onClick={() => putOff(entry.id)}
      >
        <Icon name="later" className="glyph size-4" />
      </button>
      {done ? (
        <button className={`${BUTTON} border border-separator-strong hover:bg-fill`} onClick={() => run(done)}>
          <Icon name={done.icon ?? "check"} className="glyph size-3.5" />
          {done.label}
          <Kbd>E</Kbd>
        </button>
      ) : null}
    </div>
  );
}

/** An agent's permission or question: what it last said, then its card (Enter allows). */
function AskBody({ entry }: { entry: Entry }) {
  const { t } = useT();
  const s = entry.subject;
  // what the agent last said; lastAi's own fallback ("Done") when it said nothing is no context
  const said = useDerived(() => (s.type === "ask" && lastAi(s.chat) !== t("work.done") ? lastAi(s.chat) : ""));
  if (s.type !== "ask") return null;
  return (
    <div className="flex flex-col gap-3 max-w-170">
      {said ? <Markdown text={said} className="md-panel text-sm leading-relaxed text-secondary line-clamp-6" /> : null}
      <PendingRequest request={s.request} keys />
    </div>
  );
}
function ChatBody({ chat }: { chat: string }) {
  const text = useDerived(() => lastAi(chat));
  return <Markdown text={text} className="md-panel text-sm leading-relaxed text-secondary max-w-170" />;
}

// ---------- the bottom: status, when, facts, connected
type Connected = { id: string; icon: string; title: string; meta: string; go: () => unknown };
/** Other items of the same project in the queue, and for a card the conversations and PRs it links to. */
function connectedOf(model: TodayModel, entry: Entry): Connected[] {
  const same = model.queue
    .filter(other => other.id !== entry.id && entry.project && other.project === entry.project)
    .slice(0, 5)
    .map(other => ({
      id: other.id,
      icon: KIND_ICON[other.kind],
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
function ConnectedList({ items }: { items: Connected[] }) {
  const { t } = useT();
  if (!items.length) return <div className="text-[13px] text-secondary">{t("today.nothingConnected")}</div>;
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(item => (
        <button
          key={item.id}
          onClick={item.go}
          className="flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg text-left cursor-pointer hover:bg-fill-2"
        >
          <Icon name={item.icon} className="glyph size-3.5 mt-0.5 flex-none text-secondary" />
          <span className="flex-1 min-w-0 flex flex-col leading-[1.35]">
            <span className="text-[13px] truncate">{item.title}</span>
            <span className="text-[11px] text-tertiary truncate">{item.meta}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const PILL =
  "inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-md border border-separator-strong bg-raised text-xs";
const PICK = "bg-transparent outline-0 text-xs font-medium cursor-pointer max-w-44";
// a status' dot: backlog grey, planned blue, active orange, blocked red, review accent, done green
const DOT: Record<string, string> = {
  idle: "bg-tertiary",
  planned: "bg-ctx-a",
  active: "bg-soon",
  blocked: "bg-late",
  review: "bg-accent",
  done: "bg-ok",
  todo: "bg-tertiary",
  doing: "bg-soon",
};

/** Under the title: the status (the tracker's own for a card) and the assignee as small pickers,
 *  then what is known that the header does not say already. */
function Meta({ entry }: { entry: Entry }) {
  const { locale, t } = useT();
  const facts = factsOf(entry, locale, t).filter(([, value]) => value && value !== "–");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {entry.kind === "ask" ? null : <StatusPick entry={entry} />}
      <AssigneePick entry={entry} />
      {facts.map(([label, value]) => (
        <span key={label} className="text-xs whitespace-nowrap max-w-72 truncate" title={value}>
          <span className="text-tertiary">{label}</span> {value}
        </span>
      ))}
    </div>
  );
}

type T = ReturnType<typeof useT>["t"];
// what is known about the item that its header (kind, where, why, title) does not show, as label and value
function factsOf(entry: Entry, locale: string, t: T): [string, string][] {
  const s = entry.subject;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  switch (s.type) {
    case "mail":
      return [[t("today.fact.to"), s.mail.to.map(a => a.name || a.email).join(", ")]];
    case "pr": {
      const link = ticketOf(s.pr.url);
      return [
        [
          t("today.fact.ticket"),
          link
            ? `${link.number ? `${/^\d+$/.test(link.number) ? "#" : ""}${link.number} ` : ""}${link.title ?? ""}`
            : "",
        ],
        [t("today.fact.updated"), day(s.pr.updated)],
      ];
    }
    case "card":
      return [
        [t("today.fact.due"), s.card.card.due ? day(s.card.card.due) : ""],
        [t("today.fact.labels"), (s.card.card.labels ?? []).join(", ")],
      ];
    case "meeting":
      return [
        [t("today.fact.organizer"), s.meeting.organizer],
        [t("today.fact.people"), String(s.meeting.people.length || "")],
      ];
    case "reminder":
      return [[t("today.fact.repeat"), s.reminder.repeat ?? ""]];
    default:
      return [];
  }
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
  const dot = tracker ? DOT[current?.tone ?? current?.state ?? "idle"] : DOT[entry.status];
  return (
    <span className={`${PILL} ${busy ? "opacity-60" : ""}`} title={err || t(`today.doneIn.${entry.kind}`)}>
      <span className={`size-2 rounded-full flex-none ${err ? "bg-late" : dot}`} />
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
