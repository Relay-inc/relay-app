import type { ReactNode } from "react";
import type { PanelTab } from "../../../domain/navigation/views";
import type { Project } from "../../../domain/workspace/types";
import type { PR } from "../../../domain/pull-requests/types";
import type { Reminder } from "../../../domain/reminders/types";
import { useNavigationStore } from "../../../application/navigation/store";
import { setTab, openDetail } from "../../../application/navigation/panel";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { project, projectLabel } from "../../../application/workspace/vault";
import { selectedProject } from "../../../application/conversations/selectors";
import { ghOn } from "../../../application/settings/settings";
import { prKey } from "../../../domain/navigation/keys";
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

/** The right panel: the tabs, the "today" list, a project's tabs, and the open PR, mail, note or card. */
export function PanelView({ className }: { className: string }) {
  const { t } = useT();
  const open = useNavigationStore(s => s.panel.open);
  const chosenTab = useNavigationStore(s => s.tab);
  const github = useDerived(() => ghOn());
  const info = useDerived(() => {
    const shown = project(selectedProject());
    return shown ? { project: shown, label: projectLabel(shown.name) } : undefined;
  });
  const allReminders = useWorkspaceStore(s => s.snap.reminders);
  const prs = usePullRequestsStore(s => s.list);
  const tab: PanelTab = chosenTab === "prs" && !github ? "open" : chosenTab;

  const heading = (title: string, count?: number) => (
    <h2 className="text-sm font-semibold mb-2">
      {title}
      {count === undefined ? null : (
        <>
          {" "}
          <span className="text-secondary tabular-nums">{count}</span>
        </>
      )}
    </h2>
  );
  const dueLabel = (reminder: Reminder) => {
    if (reminder.days < 0) return t("due.overdue", { n: -reminder.days });
    if (reminder.days === 0) return t("due.today");
    return t("due.in", { n: reminder.days });
  };
  const prRow = (pr: PR, mine: boolean, label: string) => {
    const key = prKey(pr.repo, pr.number);
    return (
      <PrRow
        key={key}
        compact
        pr={pr}
        mine={mine}
        project={label}
        selected={open === key}
        onOpen={() => openDetail(key)}
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
        {due.length ? <TodoList items={items} /> : <Note>{t("insp.nothingDue")}</Note>}
      </>
    );
  };
  const projectPrs = (name: string, label: string) => {
    if (!prs) return <Note>{t("pr.loading")}</Note>;
    const review = prs.review.filter(pr => pr.project === name);
    const mine = prs.mine.filter(pr => pr.project === name);
    const count = review.length + mine.length;
    return (
      <>
        {heading(t("nav.prs"), count)}
        {count ? (
          <div>
            {review.map(pr => prRow(pr, false, label))}
            {mine.map(pr => prRow(pr, true, label))}
          </div>
        ) : (
          <Note>{t("pr.noneProject")}</Note>
        )}
      </>
    );
  };
  const stand = (shown: Project) => (
    <>
      {heading(t("insp.stand"))}
      <Note>{t("insp.updated", { date: shown.last })}</Note>
      <Markdown className="md-panel [&_p+p]:mt-2" text={shown.stand || t("insp.noStand")} />
    </>
  );
  const projectReminders = (name: string) => {
    const own = allReminders.filter(reminder => reminder.project === name);
    if (!own.length) return <Note>{t("insp.noRem")}</Note>;
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
        {items.length ? <TodoList items={items.map(text => ({ text }))} /> : <Note>{t("insp.noOpen")}</Note>}
      </>
    );
  };
  const body = (): ReactNode => {
    if (open) return <PanelDetail />;
    if (!info) return today();
    if (tab === "prs") return projectPrs(info.project.name, info.label);
    if (tab === "stand") return stand(info.project);
    if (tab === "rem") return projectReminders(info.project.name);
    return openItems(info.project);
  };

  // app chrome is not text: no selection in the bar and the tabs, like a native Mac app
  return (
    <aside className={`relay-panel ${className}`}>
      <div className="flex flex-col flex-1 min-h-0 border-l border-separator">
        <div
          className="h-13 flex-none flex items-center gap-2.5 px-5 border-b border-separator min-w-75 select-none"
          data-tauri-drag-region
        >
          <div className="seg select-none">
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
        <div className={`overflow-y-auto pt-4 px-4 pb-6 ${open ? "min-w-115" : "min-w-75"}`}>{body()}</div>
      </div>
    </aside>
  );
}
