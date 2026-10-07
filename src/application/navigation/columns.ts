import { storage } from "../../infrastructure/storage";

// The resizable columns of the main window and its views: which edge of their grid they sit against, their range, and
// their width as ui-state keeps it
export const COLUMNS = {
  sidebar: { side: "left", key: "sidebarWidth", min: 180, max: 420, initial: 240 },
  drawer: { side: "right", key: "drawerWidth", min: 360, max: 800, initial: 460 },
  today: { side: "left", key: "todayWidth", min: 280, max: 560, initial: 360 },
  mail: { side: "left", key: "mailWidth", min: 280, max: 640, initial: 380 },
  prs: { side: "left", key: "prsWidth", min: 280, max: 640, initial: 380 },
  reviewFiles: { side: "left", key: "reviewFilesWidth", min: 180, max: 480, initial: 260 },
  reviewSide: { side: "right", key: "reviewSideWidth", min: 300, max: 640, initial: 400 },
  ticketSide: { side: "right", key: "ticketSideWidth", min: 220, max: 480, initial: 272 },
} as const;
export type Column = keyof typeof COLUMNS;

/** A width brought into the column's range, whole pixels. */
export const clampColumn = (column: Column, w: number) =>
  Math.round(Math.min(COLUMNS[column].max, Math.max(COLUMNS[column].min, w)));
/** The kept width, or the column's initial one. */
export const columnWidth = (column: Column) =>
  clampColumn(column, storage.get(COLUMNS[column].key, COLUMNS[column].initial));
export const keepColumnWidth = (column: Column, w: number) => storage.set(COLUMNS[column].key, w);
