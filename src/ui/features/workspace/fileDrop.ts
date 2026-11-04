import type { EditorView } from "@codemirror/view";
import { t } from "../../../shared/i18n";

type Point = { x: number; y: number };

/** The page editor as a place files from Finder can be dropped (Tauri hands the paths and where the pointer is, see
 *  application/conversations/attachments.ts `dropTarget`). While they hover, a line shows between the lines of the page
 *  where they would land, with "Copy to Attachments/2026 and embed"; a drop gives `add` the paths and that place. */
export function fileDrop(
  view: EditorView,
  host: { dest: () => Promise<string>; add: (paths: string[], at: number) => void },
) {
  const mark = document.createElement("div");
  mark.className = "cm-file-drop";
  mark.hidden = true;
  mark.append(
    Object.assign(document.createElement("span"), { className: "cm-file-drop-line" }),
    Object.assign(document.createElement("span"), { className: "cm-file-drop-dot" }),
  );
  const label = Object.assign(document.createElement("span"), { className: "cm-file-drop-label" });
  mark.append(label);
  view.dom.append(mark);
  let folder = "";
  void host.dest().then(d => (folder = d));

  /** Where a drop at `y` lands: before the line under the pointer, or after it in its lower half; and the line's height. */
  const place = (y: number) => {
    const { doc } = view.state;
    const top = view.documentTop;
    const block = view.lineBlockAtHeight(Math.min(Math.max(y - top, 0), view.contentHeight));
    const before = y - top < block.top + block.height / 2;
    const at = before ? block.from : Math.min(block.to + 1, doc.length);
    return { at, y: top + (before ? block.top : block.top + block.height) };
  };
  return {
    over(on: boolean, point?: Point) {
      if (!on || !point) {
        mark.hidden = true;
        return;
      }
      label.textContent = t("attach.drop", { folder });
      mark.hidden = false;
      mark.style.top = `${place(point.y).y - view.dom.getBoundingClientRect().top - 10}px`;
    },
    drop(paths: string[], point?: Point) {
      mark.hidden = true;
      host.add(paths, point ? place(point.y).at : view.state.doc.length);
    },
    destroy: () => mark.remove(),
  };
}
