import type { Translate } from "../conversations/state";
import { VIEW, boardKey } from "./keys.ts";

// The views on top of the sidebar, without the main window's state: the sidebar adds its badges to them, the settings
// window lists them to switch them on and off.

/** A view: a named app icon, or a board's monochrome 24×24 mark. */
export type ViewItem = { key: string; icon?: string; mark?: string; name: string };

/** The views there are, in their own order: the boards that are set up, pull requests and mail when they are on. */
export const viewItems = (
  boards: { id: string; mark: string; name: string }[],
  github: boolean,
  mail: boolean,
  t: Translate,
): ViewItem[] => [
  { key: VIEW.wait, icon: "bell", name: t("nav.waiting") },
  { key: VIEW.reminders, icon: "list", name: t("nav.reminders") },
  ...boards.map(board => ({ key: boardKey(board.id), mark: board.mark, name: board.name })),
  ...(github ? [{ key: VIEW.prs, icon: "pr", name: t("nav.prs") }] : []),
  ...(mail ? [{ key: VIEW.mail, icon: "mail", name: t("nav.mail") }] : []),
];
