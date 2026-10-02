import { createElement } from "react";
import { iconShapes } from "../../shared/icons";

/** One of the app's icons (shared/icons.ts) on the 24×24 grid. `className` sizes and strokes it, `glyph` by default. */
export function Icon({ name, className = "glyph" }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {iconShapes(name).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
