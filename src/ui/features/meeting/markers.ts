import type { Marker } from "../../../domain/calendar/meeting-view";

/** The design's glyphs for the marks in the notes, on a 16 grid: an action is a box with an arrow out of it, a decision
 *  a filled diamond, a question a bold "?" (no paths). The editor draws them in the lines, the legend below it too. */
export const GLYPHS: Record<Marker, { paths: string[]; fill: boolean }> = {
  action: {
    paths: [
      "M3.5 3h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M8 7.5h6.5M12 5l2.5 2.5L12 10",
    ],
    fill: false,
  },
  decision: { paths: ["M8 1.5 14.5 8 8 14.5 1.5 8z"], fill: true },
  question: { paths: [], fill: false },
};
/** Colour class of a marker. */
export const MARKER_TEXT: Record<Marker, string> = {
  action: "text-accent-text",
  decision: "text-viz-4",
  question: "text-secondary",
};
