import type { ComponentType, ReactNode } from "react";
import type { Key } from "../../../shared/i18n";
import type { Attention, TabId } from "../../../domain/navigation/views";
import { buildsAttention } from "../../../application/builds/builds";
import { buddyOf } from "../../../application/buddy/buddy";
import { cloudOf } from "../../../application/cloudbuild/cloudbuild";
import { prsAttention } from "../../../application/pull-requests/prs";
import { aikidoAttention, aikidoOf } from "../../../application/aikido/aikido";
import { ghOn, settings } from "../../../application/settings/settings";
import { useDerived } from "../../hooks/useDerived";
import { Icon } from "../../components/Icon";
import { Glyph } from "../../components/Glyph";
import { AIKIDO_GLYPH, AIKIDO_VIEWBOX } from "../aikido/mark";
import { BuildsPanel } from "./BuildsPanel";
import { PrsPanel } from "./PrsPanel";
import { AikidoPanel } from "../aikido/AikidoPanel";
import { TerminalsPanel } from "../terminals/TerminalsPanel";
import { GitPanel } from "../git/GitPanel";
import { FilesPanel } from "../files/FilesPanel";

/** A tab of the project panel (the right drawer). The one list of them is `TABS`: a new tab is one entry here, and its
 *  icon appears in the title bar by itself while `attention` says the project needs the user. */
export type DrawerTab = {
  id: TabId; // add it to `TAB_IDS` (domain/navigation/views) too
  icon: ReactNode;
  label: Key; // the tooltip and the name of the active tab
  Panel: ComponentType<{ project: string }>;
  show: (project: string) => boolean; // the tab exists for this project (an integration is on, a repo is linked)
  attention: (project: string) => Attention; // reads stores only (it runs under useDerived)
  brand?: boolean; // the icon keeps its own colours (a logo): the title bar marks attention with a dot, not a tint
};

const icon = (name: string) => <Icon name={name} className="glyph size-4" />;
/** In the order the strip shows them. */
export const TABS: DrawerTab[] = [
  { id: "prs", icon: icon("pr"), label: "nav.prs", Panel: PrsPanel, show: () => ghOn(), attention: prsAttention },
  {
    id: "builds",
    icon: icon("pulse"),
    label: "drawer.builds",
    Panel: BuildsPanel,
    show: project => !!buddyOf(project) || !!cloudOf(project),
    attention: buildsAttention,
  },
  {
    id: "security",
    icon: <Glyph svg={AIKIDO_GLYPH} className="size-4" viewBox={AIKIDO_VIEWBOX} />,
    brand: true,
    label: "drawer.security",
    Panel: AikidoPanel,
    show: project => aikidoOf(project).length > 0,
    // red while a critical or high Aikido group is there the user has not seen in the panel
    attention: project => aikidoAttention(project),
  },
  {
    id: "git",
    icon: icon("branch"),
    label: "drawer.git",
    Panel: GitPanel,
    show: () => settings().gitDrawer === true,
    attention: () => null,
  },
  {
    id: "files",
    icon: icon("folder"),
    label: "drawer.files",
    Panel: FilesPanel,
    show: () => true,
    attention: () => null,
  },
  {
    id: "terminal",
    icon: icon("drawerTerm"),
    label: "drawer.terminal",
    Panel: TerminalsPanel,
    show: () => true,
    attention: () => null,
  },
];
export const tabOf = (id: TabId) => TABS.find(tab => tab.id === id)!;

/** The project's tabs in the strip's order, each with what it says now. */
export const useProjectTabs = (project: string) =>
  useDerived(() =>
    TABS.filter(tab => tab.show(project)).map(tab => ({ id: tab.id, attention: tab.attention(project) })),
  );

/** The dot of an attention state: red, blue (waits on you), orange (runs). */
export const ATTENTION_TEXT = { fail: "text-late", you: "text-accent", busy: "text-soon" } as const;
/** The same for an icon in the title bar: it wins over the button's own grey. */
export const ATTENTION_ICON = { fail: "text-late!", you: "text-accent-text!", busy: "text-soon!" } as const;
