import { t, tn, type Key } from "../../shared/i18n";
import { provider } from "../../shared/plugins";
import { WAIT } from "../../domain/navigation/views";
import { buildsToShow, prsOf, ticketsOf, waitingOf } from "../../domain/project-home/rules";
import type { Entry } from "../today/today";
import { entries, focusEntry } from "../today/today";
import { useTodayStore } from "../today/store";
import { buildsOf } from "../builds/builds";
import { usePullRequestsStore } from "../pull-requests/store";
import { select, openDrawer, openProjectBoard } from "../navigation/navigation";
import { openCard } from "../navigation/panel";
import { timeOf } from "../calendar/calendar";

// A project's home: the cards an empty conversation shows above the composer. A card is one entry in `HOME_CARDS`
// (same spirit as the drawer's `TABS`): its `build` reads stores only and returns what the card shows now, or null
// when it has nothing to say. A new card (Security, say) is one entry here, the UI draws any entry the same way.

/** One row of a card: a dot or a short text in front, the title, a quiet second line, text on the right. */
export type HomeRow = {
  key: string;
  lead: { dot: "you" | "fail" | "busy" | "ok" } | { text: string };
  title: string;
  sub?: string;
  trail?: { text: string; tone?: "doing" };
  open: () => void;
};
/** What a card shows for a project: `count` next to the title, `link` (like "Board") on the right of its head. */
export type HomeCard = {
  title: Key;
  count?: number;
  link?: { label: Key; open: () => void };
  rows: HomeRow[];
};
export type HomeCardDef = { id: string; build: (project: string) => HomeCard };

const waiting: HomeCardDef = {
  id: "waiting",
  build: project => {
    const { rows, total } = waitingOf(entries(), project);
    const open = (entry: Entry) =>
      entry.subject.type === "ask"
        ? void select(entry.subject.chat) // its card is in that conversation
        : (focusEntry(entry.id), void select(WAIT));
    return {
      title: "home.waiting",
      count: total,
      rows: rows.map(entry => ({
        key: entry.id,
        lead: { dot: "you" },
        title: entry.title,
        sub: [entry.where, entry.why].filter(Boolean).join(" · "),
        open: () => open(entry),
      })),
    };
  },
};

const tickets: HomeCardDef = {
  id: "tickets",
  build: project => {
    const board = useTodayStore.getState().boards[project];
    const tracker = board && provider(board.provider);
    const { rows, total } = ticketsOf(board?.cards ?? []);
    return {
      title: "home.tickets",
      count: total,
      link: { label: "home.board", open: () => void openProjectBoard(project) },
      rows: tracker
        ? rows.map(card => ({
            key: card.id,
            lead: { text: /^\d+$/.test(card.number) ? `#${card.number}` : card.number },
            title: card.title,
            trail: {
              text: card.status || (card.state === "doing" ? t("today.inProgress") : ""),
              tone: card.state === "doing" ? "doing" : undefined,
            },
            open: () => void openCard(tracker, board.ref, card.id),
          }))
        : [],
    };
  },
};

const builds: HomeCardDef = {
  id: "builds",
  build: project => {
    const prs = prsOf(usePullRequestsStore.getState().list, project);
    const rows: HomeRow[] = buildsToShow(buildsOf(project)).map(build => ({
      key: build.key,
      lead: { dot: build.tone === "fail" ? "fail" : "busy" },
      title: [build.name || t("cb.manual"), build.branch].filter(Boolean).join(" · "),
      trail: {
        text: [
          t(build.tone === "fail" ? "home.build.fail" : "home.build.busy"),
          build.at ? timeOf(build.at) : "",
          build.source === "buddy" ? "Buddy" : "Cloud Build",
        ]
          .filter(Boolean)
          .join(" · "),
      },
      open: () => openDrawer("builds"),
    }));
    if (prs.open)
      rows.push({
        key: "prs",
        lead: { dot: "you" },
        title: tn("home.prs", prs.open),
        trail: prs.waiting ? { text: tn("home.prsWaiting", prs.waiting) } : undefined,
        open: () => openDrawer("prs"),
      });
    return { title: "home.builds", rows };
  },
};

/** In the order the grid shows them. */
export const HOME_CARDS: HomeCardDef[] = [waiting, tickets, builds];

/** The project's cards that have something to show now. */
export const homeCards = (project: string) =>
  HOME_CARDS.flatMap(def => {
    const card = def.build(project);
    return card.rows.length ? [{ id: def.id, ...card }] : [];
  });
