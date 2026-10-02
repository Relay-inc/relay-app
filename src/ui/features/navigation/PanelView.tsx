import type { ReactNode } from "react";
import type { PanelTab } from "../../../domain/navigation/views";
import type { Project } from "../../../domain/workspace/types";
import type { PR } from "../../../domain/pull-requests/types";
import type { Reminder } from "../../../domain/reminders/types";
import { useNavigationStore } from "../../../application/navigation/store";
import { setTab, openPr } from "../../../application/navigation/panel";
import { select } from "../../../application/navigation/navigation";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { project } from "../../../application/workspace/vault";
import { selectedProject } from "../../../application/conversations/selectors";
import { ghOn } from "../../../application/settings/settings";
import { prKey } from "../../../domain/navigation/keys";
import { PRS } from "../../../domain/navigation/views";
import { urgency } from "../../../domain/reminders/rules";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { Note } from "../../components/Note";
import { PrRow } from "../pull-requests/PrRow";
import { PanelDetail } from "./PanelDetail";
import { TodoList } from "./TodoList";
import "../../styles/navigation.css";

const TABS = [
  ["open", "tab.open"],
  ["stand", "tab.stand"],
  ["rem", "nav.reminders"],
  ["prs", "tab.prs"],
] as const;

/** The right panel: the tabs, the "today" list, a project's tabs, and the open note or card. */
export function PanelView({ className }: { className: string }) {
  const { t } = useT();
  const open = useNavigationStore(s => s.panel.open);
  const prOpen = useNavigationStore(s => s.panel.prOpen);
  const chosenTab = useNavigationStore(s => s.tab);
  const github = useDerived(() => ghOn());
  const info = useDerived(() => project(selectedProject()));
  const allReminders = useWorkspaceStore(s => s.snap.reminders);
  const prs = usePullRequestsStore(s => s.list);
  const tab: PanelTab = chosenTab === "prs" && !github ? "open" : chosenTab;

  const heading = (title: string, meta?: ReactNode) => (
    <div className="flex items-baseline gap-1.5 mb-2.5">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {meta === undefined ? null : <span className="text-xs text-tertiary tabular-nums">{meta}</span>}
    </div>
  );
  const note = (text: string) => <Note className="text-[13px]">{text}</Note>;
  const dueLabel = (reminder: Reminder) => {
    if (reminder.days < 0) return t("due.overdue", { n: -reminder.days });
    if (reminder.days === 0) return t("due.today");
    return t("due.in", { n: reminder.days });
  };
  // a PR opens next to the list in the Pull requests view
  const prRow = (pr: PR, mine: boolean) => {
    const key = prKey(pr.repo, pr.number);
    return (
      <PrRow
        key={key}
        compact
        pr={pr}
        mine={mine}
        selected={prOpen === key}
        onOpen={() => {
          openPr(key);
          select(PRS);
        }}
      />
    );
  };

  // no project selected: what is due today or overdue, across all projects
  const today = () => {
    const due = allReminders.filter(reminder => reminder.days <= 0);
    const items = due.map(reminder => ({
      text: reminder.title,
      project: reminder.project || "",
      due: urgency(reminder.days),
      when: dueLabel(reminder),
    }));
    return (
      <>
        {heading(t("insp.today"), due.length)}
        {due.length ? <TodoList items={items} /> : note(t("insp.nothingDue"))}
      </>
    );
  };
  const projectPrs = (name: string) => {
    if (!prs) return note(t("pr.loading"));
    const review = prs.review.filter(pr => pr.project === name);
    const mine = prs.mine.filter(pr => pr.project === name);
    const count = review.length + mine.length;
    return (
      <>
        {heading(t("nav.prs"), count)}
        {count ? (
          <div>
            {review.map(pr => prRow(pr, false))}
            {mine.map(pr => prRow(pr, true))}
          </div>
        ) : (
          note(t("pr.noneProject"))
        )}
      </>
    );
  };
  const stand = (shown: Project) => (
    <>
      {heading(t("insp.stand"), t("insp.updated", { date: shown.last }))}
      <Markdown
        className="md-panel text-[13px] leading-[1.55] select-text [&_p+p]:mt-2.5"
        text={shown.stand || t("insp.noStand")}
      />
    </>
  );
  const projectReminders = (name: string) => {
    const own = allReminders.filter(reminder => reminder.project === name);
    if (!own.length) return note(t("insp.noRem"));
    const items = own.map(reminder => ({
      text: reminder.title,
      when: dueLabel(reminder),
      due: urgency(reminder.days),
    }));
    return (
      <>
        {heading(t("nav.reminders"))}
        <TodoList items={items} />
      </>
    );
  };
  const openItems = (shown: Project) => {
    const items = shown.open_items || [];
    return (
      <>
        {heading(t("tab.open"), items.length)}
        {items.length ? <TodoList items={items.map(text => ({ text }))} /> : note(t("insp.noOpen"))}
      </>
    );
  };
  const body = (): ReactNode => {
    if (open) return <PanelDetail />;
    if (!info) return today();
    if (tab === "prs") return projectPrs(info.name);
    if (tab === "stand") return stand(info);
    if (tab === "rem") return projectReminders(info.name);
    return openItems(info);
  };

  // app chrome is not text: no selection in the bar and the tabs, like a native Mac app
  return (
    <aside className={`relay-panel ${className}`}>
      <div className="flex flex-col flex-1 min-h-0 border-l border-separator">
        <div
          className="h-12 flex-none flex items-center px-3.5 border-b border-separator min-w-75 select-none"
          data-tauri-drag-region
        >
          <div className="seg flex-1 select-none [&>button]:flex-1">
            {TABS.map(([id, key]) => (
              <button
                key={id}
                className={tab === id ? "on" : ""}
                hidden={id === "prs" && !github}
                onClick={() => setTab(id)}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
        <div className={`overflow-y-auto pt-4.5 px-4.5 pb-6 ${open ? "min-w-115" : "min-w-75"}`}>{body()}</div>
      </div>
    </aside>
  );
}
