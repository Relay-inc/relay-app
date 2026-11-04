import type { Marker } from "../../../domain/calendar/meeting-view";
import { GLYPHS, MARKER_TEXT } from "./markers";

/** A marker's glyph, in the legend under the notes. */
export function MarkerIcon({ kind }: { kind: Marker }) {
  const { paths, fill } = GLYPHS[kind];
  if (!paths.length) return <span className={`font-bold ${MARKER_TEXT[kind]}`}>?</span>;
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-3.5 ${MARKER_TEXT[kind]} ${fill ? "fill-current" : "glyph"}`}
    >
      {paths.map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
