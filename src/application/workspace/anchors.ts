import * as Y from "yjs";

/** A shared document's comment anchor: its start and end as Yjs relative positions, so it stays on its text whatever
 *  any member types around it. */
export type YAnchor = { y: [unknown, unknown] };

export const yAnchor = (text: Y.Text, from: number, to: number): YAnchor => ({
  y: [
    Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from)),
    // the end sticks to the character before it: text typed right after the quote stays outside the comment
    Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to, -1)),
  ],
});

/** Where an anchor is in `text` now, or null when its text is gone (or it is no anchor of this document). */
export function ySpan(text: Y.Text, anchor: unknown): { from: number; to: number } | null {
  const y = (anchor as Partial<YAnchor> | null)?.y;
  if (!Array.isArray(y) || y.length !== 2) return null;
  try {
    const [a, b] = y.map(p =>
      Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(p), text.doc!),
    );
    if (!a || !b || a.type !== text || b.type !== text || b.index <= a.index) return null;
    return { from: a.index, to: b.index };
  } catch {
    return null;
  }
}
