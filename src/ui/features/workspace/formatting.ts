import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import {
  hasMark,
  linkOf,
  linkSelection,
  retarget,
  todoRule,
  toggleMark,
  type Edit,
  type Mark,
} from "../../../domain/workspace/format.ts";
import { TURN_INTO, turnInto, type BlockKind } from "../../../domain/workspace/blocks.ts";
import { linkAt } from "./livePreview.ts";
import { bindingLabel } from "../../../domain/settings/shortcuts.ts";

// Styling a page without writing markdown: a toolbar over a selection (bold, italic, strikethrough, code, link, Turn
// into), ⌘B ⌘I ⇧⌘X ⌘E and ⌘K on a selection, a popover to change a link's address, and `[] ` becoming a to-do. Each of
// them is a change of the markdown text, which is what is saved.

export type FormatWords = {
  toolbar: string;
  bold: string;
  italic: string;
  strike: string;
  code: string;
  link: string;
  /** the link popover's field */
  target: string;
  removeLink: string;
  /** Turn into on the toolbar; left out where the lines carry more than markdown (the meeting's notes). */
  turn?: { label: string; kind: (kind: BlockKind) => string };
};

const MARKS: { mark: Mark; key: string; label: keyof FormatWords; face: string; keys: string }[] = [
  { mark: "**", key: "Mod-b", label: "bold", face: "B", keys: bindingLabel("mod+KeyB") },
  { mark: "*", key: "Mod-i", label: "italic", face: "I", keys: bindingLabel("mod+KeyI") },
  { mark: "~~", key: "Mod-Shift-x", label: "strike", face: "S", keys: bindingLabel("shift+mod+KeyX") },
  { mark: "`", key: "Mod-e", label: "code", face: "</>", keys: bindingLabel("mod+KeyE") },
];
const SVG = "http://www.w3.org/2000/svg";

const apply = (view: EditorView, edit: Edit) =>
  view.dispatch({
    changes: edit.changes,
    selection: EditorSelection.range(edit.from, edit.to),
    userEvent: "input.format",
  });
const mark = (mark: Mark) => (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  apply(view, toggleMark(view.state.doc.toString(), from, to, mark));
  return true;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** The toolbar over the selection and the popover of a link, drawn over the editor like the block handle's menu. */
function floating(words: FormatWords) {
  return ViewPlugin.fromClass(
    class {
      bar = el("div", "cm-format-bar");
      menu: HTMLElement | null = null;
      pop = el("div", "cm-link-pop");
      input = el("input", "cm-link-input");
      remove = el("button", "cm-link-remove", words.removeLink);
      buttons = new Map<Mark, HTMLButtonElement>();
      // the link the popover is for: `pinned` once it was asked for (⌘K, the toolbar) or its field was used
      link: { from: number; to: number; src: string; fresh: boolean } | null = null;
      by: "caret" | "hover" | "ask" = "caret"; // what showed it
      pinned = false;
      timer = 0;
      readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        const { bar, pop } = this;
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", words.toolbar);
        bar.hidden = true;
        for (const m of MARKS) {
          const b = el(
            "button",
            `cm-format-${m.mark === "`" ? "code" : m.mark === "~~" ? "strike" : m.mark === "*" ? "italic" : "bold"}`,
            m.face,
          );
          b.title = `${words[m.label] as string} ${m.keys}`;
          b.setAttribute("aria-label", words[m.label] as string);
          b.addEventListener("click", () => mark(m.mark)(view));
          bar.append(b);
          this.buttons.set(m.mark, b);
        }
        const link = el("button", "cm-format-link");
        link.title = `${words.link} ${bindingLabel("mod+KeyK")}`;
        link.setAttribute("aria-label", words.link);
        const svg = document.createElementNS(SVG, "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("class", "glyph");
        for (const d of [
          "M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.6.6",
          "M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.6-.6",
        ]) {
          const path = document.createElementNS(SVG, "path");
          path.setAttribute("d", d);
          svg.append(path);
        }
        link.append(svg);
        link.addEventListener("click", () => this.ask());
        bar.append(link);
        if (words.turn) {
          bar.append(el("span", "cm-format-sep"));
          const turn = el("button", "cm-format-turn", `${words.turn.label} ▾`);
          turn.setAttribute("aria-haspopup", "menu");
          turn.addEventListener("click", () => (this.menu ? this.closeMenu() : this.openMenu(turn)));
          bar.append(turn);
        }
        // a click on the bar keeps the editor's selection and focus
        bar.addEventListener("mousedown", e => e.preventDefault());
        view.dom.append(bar);

        this.input.placeholder = words.target;
        this.input.setAttribute("aria-label", words.target);
        this.input.spellcheck = false;
        this.input.addEventListener("keydown", e => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.close(true);
          }
        });
        this.input.addEventListener("focus", () => (this.pinned = true));
        this.remove.type = "button";
        this.remove.addEventListener("mousedown", e => e.preventDefault());
        this.remove.addEventListener("click", () => {
          this.input.value = "";
          this.commit();
        });
        pop.hidden = true;
        pop.append(this.input, this.remove);
        pop.addEventListener("mouseenter", () => window.clearTimeout(this.timer));
        pop.addEventListener("mouseleave", () => this.leave());
        view.dom.append(pop);
        view.contentDOM.addEventListener("mouseover", this.over);
        view.contentDOM.addEventListener("mouseout", this.out);
        document.addEventListener("mousedown", this.away, true);
        this.refresh();
      }
      over = (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest?.(".cm-link, .cm-wikilink");
        if (!target || this.pinned) return;
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          const found = linkAt(this.view.state, this.view.posAtDOM(target, 0) + 1);
          if (found) this.show({ ...found, fresh: false }, "hover");
        }, 300);
      };
      out = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest?.(".cm-link, .cm-wikilink")) return;
        this.leave();
      };
      leave() {
        window.clearTimeout(this.timer);
        if (this.pinned) return;
        this.timer = window.setTimeout(() => {
          if (this.by === "hover" && !this.pinned) this.hidePop();
        }, 300);
      }
      hidePop() {
        this.link = null;
        this.pop.hidden = true;
      }
      // a click outside the popover and the bar lets go of a pinned popover
      away = (e: MouseEvent) => {
        if (this.pinned && !this.pop.contains(e.target as Node) && !this.bar.contains(e.target as Node)) {
          this.pinned = false;
          this.refresh();
        }
        if (this.menu && !this.menu.contains(e.target as Node) && !this.bar.contains(e.target as Node))
          this.closeMenu();
      };
      /** ⌘K and the toolbar's link: change the address of the link the selection is in, or link the selection. */
      ask() {
        const { state } = this.view;
        const { from, to, head } = state.selection.main;
        const found = linkAt(state, head) ?? linkAt(state, from);
        if (found) this.show({ ...found, fresh: false }, "ask");
        else if (from < to && !state.sliceDoc(from, to).includes("\n"))
          this.show({ from, to, src: "", fresh: true }, "ask");
      }
      show(link: { from: number; to: number; src: string; fresh: boolean }, by: "caret" | "hover" | "ask") {
        this.link = link;
        this.by = by;
        const pin = by === "ask";
        if (pin) this.pinned = true;
        this.input.value = link.fresh ? "" : (linkOf(link.src)?.target ?? "");
        this.remove.hidden = link.fresh;
        this.pop.hidden = false;
        if (pin) {
          this.input.focus();
          this.input.select();
        }
      }
      commit() {
        const { view, link } = this;
        if (!link) return;
        const value = this.input.value.trim();
        if (link.fresh) {
          if (value) apply(view, linkSelection(link.from, link.to, value));
        } else {
          const c = retarget(link.src, value);
          if (c && c.insert !== link.src.slice(c.from, c.to))
            view.dispatch({
              changes: { from: link.from + c.from, to: link.from + c.to, insert: c.insert },
              userEvent: "input.format",
            });
        }
        this.close(true);
      }
      close(focus: boolean) {
        this.pinned = false;
        this.hidePop();
        if (focus) this.view.focus();
        this.refresh();
      }
      closeMenu() {
        this.menu?.remove();
        this.menu = null;
      }
      openMenu(anchor: HTMLElement) {
        const { view } = this;
        const turn = words.turn!;
        const menu = el("div", "cm-format-menu");
        menu.setAttribute("role", "menu");
        menu.addEventListener("mousedown", e => e.preventDefault());
        for (const kind of TURN_INTO) {
          const b = el("button", "", turn.kind(kind));
          b.setAttribute("role", "menuitem");
          b.addEventListener("click", () => {
            const { from, to } = view.state.selection.main;
            const first = view.state.doc.lineAt(from).from;
            const last = view.state.doc.lineAt(to).to;
            const insert = turnInto(view.state.sliceDoc(first, last), kind);
            view.dispatch({
              changes: { from: first, to: last, insert },
              selection: { anchor: first + insert.length },
              userEvent: "input.format",
            });
            this.closeMenu();
          });
          menu.append(b);
        }
        menu.style.top = `${anchor.getBoundingClientRect().bottom - view.dom.getBoundingClientRect().top + 4}px`;
        menu.style.left = `${anchor.getBoundingClientRect().left - view.dom.getBoundingClientRect().left}px`;
        view.dom.append(menu);
        this.menu = menu;
      }
      update(u: ViewUpdate) {
        if (this.link && u.docChanged) {
          this.link = {
            ...this.link,
            from: u.changes.mapPos(this.link.from, 1),
            to: u.changes.mapPos(this.link.to, -1),
          };
        }
        if (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged || u.viewportChanged) this.refresh();
      }
      refresh() {
        const { view } = this;
        const sel = view.state.selection.main;
        // the toolbar: over a selection, while the editor has the focus
        const bar = !sel.empty && view.hasFocus && !this.pinned;
        this.bar.hidden = !bar;
        if (!bar) this.closeMenu();
        else {
          for (const [m, b] of this.buttons) {
            const on = hasMark(view.state.doc.toString(), sel.from, sel.to, m);
            b.setAttribute("aria-pressed", String(on));
          }
        }
        // the popover: asked for, hovered, or the cursor inside a link
        if (!this.pinned) {
          const inside = view.hasFocus && sel.empty ? linkAt(view.state, sel.head) : null;
          if (inside && inside.from < sel.head && sel.head < inside.to) this.show({ ...inside, fresh: false }, "caret");
          else if (this.by === "caret") this.hidePop();
        }
        view.requestMeasure({
          key: this,
          read: v => ({
            at: v.coordsAtPos(sel.from),
            link: this.link ? v.coordsAtPos(this.link.from) : null,
            box: v.dom.getBoundingClientRect(),
          }),
          write: m => {
            if (!m.box) return;
            if (m.at && !this.bar.hidden) {
              const width = this.bar.offsetWidth;
              const left = Math.max(0, Math.min(m.at.left - m.box.left - 8, m.box.width - width));
              this.bar.style.left = `${left}px`;
              this.bar.style.top = `${m.at.top - m.box.top - this.bar.offsetHeight - 6}px`;
            }
            if (m.link && this.link && !this.pop.hidden) {
              const left = Math.max(0, Math.min(m.link.left - m.box.left, m.box.width - this.pop.offsetWidth));
              this.pop.style.left = `${left}px`;
              this.pop.style.top = `${m.link.bottom - m.box.top + 6}px`;
            }
          },
        });
      }
      destroy() {
        window.clearTimeout(this.timer);
        document.removeEventListener("mousedown", this.away, true);
        this.view.contentDOM.removeEventListener("mouseover", this.over);
        this.view.contentDOM.removeEventListener("mouseout", this.out);
        this.bar.remove();
        this.pop.remove();
        this.menu?.remove();
      }
    },
  );
}

/** Everything above, for an editor over markdown. */
export function formatting(words: FormatWords) {
  const plugin = floating(words);
  return [
    plugin,
    Prec.high(
      keymap.of([
        ...MARKS.map(m => ({ key: m.key, run: mark(m.mark), preventDefault: true })),
        {
          // ⌘K is the palette (Quick ask) unless text is selected in the page: then it links that text
          key: "Mod-k",
          run: (view: EditorView) => {
            const { from, to } = view.state.selection.main;
            if (from === to || view.state.sliceDoc(from, to).includes("\n")) return false;
            view.plugin(plugin)?.ask();
            return true;
          },
        },
      ]),
    ),
    // `[] ` at the start of a line is a to-do, in the same step as the space that typed it
    EditorView.inputHandler.of((view, from, to, text) => {
      if (from !== to || text !== " ") return false;
      const l = view.state.doc.lineAt(from);
      const change = todoRule(l.text, from - l.from);
      if (!change) return false;
      view.dispatch({
        changes: { from: l.from + change.from, to: l.from + change.to, insert: change.insert },
        selection: { anchor: l.from + change.from + change.insert.length },
        userEvent: "input.type",
      });
      return true;
    }),
  ];
}
