import type { Translate } from "../conversations/state";
import { VIEW, boardKey, pluginKey } from "./keys.ts";
import { ORCH } from "../orchestrator/rules.ts";

// The views on top of the sidebar, without the main window's state: the sidebar adds its badges to them, the settings
// window lists them to switch them on and off.

/** A view: a named app icon, or a board's monochrome 24×24 mark. */
export type ViewItem = { key: string; icon?: string; mark?: string; name: string };

/** The views there are, in their own order: the orchestrator's coordinator (a conversation), the boards that are set up, pull requests and mail when they are on, the brain (the vault, and the Commonwealth brains when that is on), then the plugins that bring a view. */
export const viewItems = (
  boards: { id: string; mark: string; name: string }[],
  github: boolean,
  mail: boolean,
  t: Translate,
  plugins: { id: string; name: string }[] = [],
): ViewItem[] => [
  { key: ORCH, icon: "agent", name: t("nav.orch") },
  { key: VIEW.wait, icon: "sun", name: t("nav.today") },
  { key: VIEW.reminders, icon: "list", name: t("nav.reminders") },
  ...boards.map(board => ({ key: boardKey(board.id), mark: board.mark, name: board.name })),
  ...(github ? [{ key: VIEW.prs, icon: "pr", name: t("nav.prs") }] : []),
  ...(mail ? [{ key: VIEW.mail, icon: "mail", name: t("nav.mail") }] : []),
  { key: VIEW.brain, icon: "brain", name: t("nav.brain") },
  ...plugins.map(plugin => ({ key: pluginKey(plugin.id), icon: "puzzle", name: plugin.name })),
];
