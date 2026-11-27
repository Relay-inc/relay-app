import { useEffect, useState, type ReactNode } from "react";
import type { Opt } from "../../../domain/board/types";
import { sameRef } from "../../../domain/board/rules";
import { provider as providerById } from "../../../shared/plugins";
import { useSettingsStore } from "../../../application/settings/store";
import { boardTrackers, setProjectBoard } from "../../../application/settings/projects-page";
import { trackerBoards, trackerProjects } from "../../../application/board/trackers";
import { go } from "../../../application/settings/window";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, SELECT } from "./blocks";
import { Section } from "./Section";

const FIELD_SELECT = `${SELECT} h-7.5 w-full text-[13px]`;
// what a tracker calls the level above its boards
const LEVEL: Record<string, "pc.level.project" | "pc.level.workspace" | "pc.level.team" | "pc.level.owner"> = {
  productive: "pc.level.project",
  trello: "pc.level.workspace",
  linear: "pc.level.team",
  "github-projects": "pc.level.owner",
};
type Loaded = { of: string; list: Opt[] } | null;

/** The project's board in its General tab: the tracker (the ones set up under Integrations), the tracker's project and
 *  the board, the ones named like the project first. Picking a board links it at once; Unlink drops it. The board is
 *  what the project opens from the sidebar and where its pipeline takes tickets from. */
export function ProjectBoard({ name, shown }: { name: string; shown: string }) {
  const { t } = useT();
  const linked = useSettingsStore(s => s.settings.boards?.[name]);
  const boards = useSettingsStore(s => s.settings.boards);
  const projects = useSettingsStore(s => s.projectsPage.projects);
  const labels = useSettingsStore(s => s.settings.projects);
  const activeIds = useDerived(() => boardTrackers().map(x => x.id));
  const active = activeIds.map(id => providerById(id)!);
  // the linked board's tracker stays pickable when it is no longer set up
  const gone = linked && !active.some(x => x.id === linked.provider) ? providerById(linked.provider) : undefined;
  const trackers = gone ? [gone, ...active] : active;
  const [picked, setPicked] = useState("");
  const tracker = trackers.some(x => x.id === picked) ? picked : (linked?.provider ?? trackers[0]?.id ?? "");
  // the lists with what they were loaded for: a list of another tracker or project counts as loading
  const [projectList, setProjectList] = useState<Loaded>(null);
  const [pickedProject, setPickedProject] = useState("");
  const [boardList, setBoardList] = useState<Loaded>(null);
  const [err, setErr] = useState("");
  const inLinked = linked?.provider === tracker;
  const projectsHere = projectList?.of === tracker ? projectList.list : null;
  const project = pickedProject || (inLinked ? linked.project : (projectsHere?.[0]?.id ?? ""));
  const boardsHere = boardList?.of === `${tracker}/${project}` ? boardList.list : null;
  const board = inLinked && linked.project === project ? linked.board : "";

  useEffect(() => {
    if (!tracker) return;
    trackerProjects(tracker, name).then(
      list => {
        setErr("");
        setProjectList({ of: tracker, list });
      },
      error => setErr(String(error?.message ?? error)),
    );
  }, [tracker, name]);
  useEffect(() => {
    if (!tracker || !project) return;
    trackerBoards(tracker, project, name).then(
      list => setBoardList({ of: `${tracker}/${project}`, list }),
      error => setErr(String(error?.message ?? error)),
    );
  }, [tracker, project, name]);

  if (!trackers.length)
    return (
      <Section title={t("pc.board")} desc={t("pc.boardHelp", { project: shown })}>
        <div className="flex flex-wrap items-center gap-3 py-1">
          <span className="min-w-56 flex-1 text-xs text-s-muted">{t("pc.noTracker")}</span>
          <button className={buttonClass()} onClick={() => go("integrations")}>
            {t("pc.setUpTracker")}
          </button>
        </div>
      </Section>
    );

  // a value the list lacks (still loading, or no longer visible to the token) is shown by its id
  const withValue = (list: Opt[] | null, value: string) =>
    value && !(list ?? []).some(x => x.id === value) ? [{ id: value, name: value }, ...(list ?? [])] : (list ?? []);
  // a board another project has: linking it here takes it from there
  const owner = (id: string) =>
    Object.entries(boards ?? {}).find(
      ([other, ref]) => other !== name && sameRef(ref, { provider: tracker, project, board: id }),
    )?.[0];
  const labelOf = (key: string) => labels[key]?.label || projects.find(p => p.name === key)?.label || key;
  const boardOptions = withValue(boardsHere, board).map(b => {
    const other = owner(b.id);
    return other ? { ...b, name: t("pc.boardOf", { board: b.name, project: labelOf(other) }) } : b;
  });
  const field = (id: string, label: string, control: ReactNode) => (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {control}
    </div>
  );

  return (
    <Section
      title={t("pc.board")}
      desc={t("pc.boardHelp", { project: shown })}
      action={
        linked && (
          <button className={buttonClass("ghost")} onClick={() => setProjectBoard(name, null)}>
            {t("int.unlink")}
          </button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-4 py-1 @xl:grid-cols-3">
        {field(
          `pc-tracker-${name}`,
          t("pc.tracker"),
          <Select
            id={`pc-tracker-${name}`}
            className={FIELD_SELECT}
            options={trackers.map(x => ({ id: x.id, name: x.name }))}
            value={tracker}
            onChange={id => {
              setPicked(id);
              setPickedProject("");
            }}
          />,
        )}
        {field(
          `pc-in-${name}`,
          t(LEVEL[tracker] ?? "pc.level.project"),
          <Select
            id={`pc-in-${name}`}
            className={FIELD_SELECT}
            options={withValue(projectsHere, project)}
            value={project}
            empty={projectsHere ? undefined : t("pr.loading")}
            disabled={!projectsHere}
            onChange={setPickedProject}
          />,
        )}
        {field(
          `pc-board-${name}`,
          t("pc.boardField"),
          <Select
            id={`pc-board-${name}`}
            className={FIELD_SELECT}
            options={boardOptions}
            value={board}
            empty={boardsHere ? t("int.pickBoard") : t("pr.loading")}
            disabled={!boardsHere}
            onChange={id => id && setProjectBoard(name, { provider: tracker, project, board: id })}
          />,
        )}
      </div>
      {linked && !gone && (
        <span className="flex items-center gap-1.5 text-xs text-s-muted">
          <Icon name="check" className="size-3.5 flex-none fill-none stroke-s-ok stroke-2" />
          {t("pc.boardLinked", { project: shown })}
        </span>
      )}
      {gone && <span className="text-xs text-s-warn">{t("pc.trackerGone", { tracker: gone.name })}</span>}
      {err && <span className={ERROR_MESSAGE}>{err}</span>}
    </Section>
  );
}
