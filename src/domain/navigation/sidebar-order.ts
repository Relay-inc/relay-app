import type { SidebarCfg } from "../settings/types";

// Ordering the sidebar's rows, without the app's state: the sidebar and the settings window both use it.

/** `list` with `id` moved before or after `ref` (to the end when `ref` is not in it). */
export const place = (list: string[], id: string, ref: string, after: boolean) => {
  const rest = list.filter(x => x !== id);
  const refIndex = rest.indexOf(ref);
  const at = refIndex < 0 ? rest.length : refIndex + (after ? 1 : 0);
  rest.splice(at, 0, id);
  return rest;
};
/** Rows in the user's dragged order first, the rest after them in their own order. */
export const ordered = <T>(
  rows: T[],
  key: (row: T) => string,
  order: string[] = [],
  byRest: (a: T, b: T) => number = () => 0,
) =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const posA = order.indexOf(key(a.row));
      const posB = order.indexOf(key(b.row));
      if (posA >= 0 && posB >= 0) return posA - posB;
      if (posA >= 0) return -1;
      if (posB >= 0) return 1;
      return byRest(a.row, b.row) || a.index - b.index;
    })
    .map(x => x.row);

/** The views in the user's order, the switched-off ones included. */
export const arranged = <T extends { key: string }>(items: T[], cfg: SidebarCfg = {}) =>
  ordered(items, item => item.key, cfg.order);
export const isHidden = (key: string, cfg: SidebarCfg = {}) => !!cfg.hidden?.includes(key);
/** The switched-off views with `key` switched off (`hidden`) or back on, each key once. */
export const withHidden = (key: string, hidden: boolean, cfg: SidebarCfg = {}) => [
  ...(cfg.hidden ?? []).filter(other => other !== key),
  ...(hidden ? [key] : []),
];
