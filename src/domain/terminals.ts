import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { t } from "../core/i18n";
import { changed } from "../core/store";
import { activeAfterClose, nextTitle } from "./terminal-tabs";

// The shells of the embedded terminals (src-tauri/src/pty.rs), per project. A terminal lives until it is closed, not
// until the view goes: the xterm instance keeps its scrollback while nothing shows it, and the next view re-attaches it.

export type Term = { id: number; title: string; xterm: Terminal; fit: FitAddon; el: HTMLElement; exited: boolean };
export type ProjectTerms = { list: Term[]; active: number };

const byProject = new Map<string, ProjectTerms>();
const starting = new Set<string>();

export const termsOf = (project: string) => byProject.get(project);

/** A new shell in the project, shown at once. */
export async function addTerminal(project: string) {
  if (starting.has(project)) return;
  starting.add(project);
  try {
    const xterm = new Terminal({
      fontFamily: "SF Mono, ui-monospace, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    const term = { id: 0, title: "", xterm, fit, el: document.createElement("div"), exited: false } as Term;
    term.el.style.cssText = "width:100%;height:100%";
    const channel = new Channel<ArrayBuffer | number>();
    channel.onmessage = msg => {
      // the exit of a closed tab arrives after its xterm is disposed
      if (!byProject.get(project)?.list.includes(term) && term.id) return;
      if (msg instanceof ArrayBuffer) return xterm.write(new Uint8Array(msg));
      term.exited = true;
      xterm.write(`\r\n\x1b[2m${t("term.exited")}\x1b[0m\r\n`);
      changed();
    };
    term.id = await invoke<number>("pty_spawn", { project, cols: xterm.cols, rows: xterm.rows, onData: channel });
    xterm.onData(data => !term.exited && invoke("pty_write", { id: term.id, data }));
    xterm.onResize(({ cols, rows }) => !term.exited && invoke("pty_resize", { id: term.id, cols, rows }));
    const entry = byProject.get(project) ?? { list: [], active: 0 };
    term.title = nextTitle(entry.list.map(x => x.title));
    entry.list.push(term);
    entry.active = term.id;
    byProject.set(project, entry);
    changed();
  } finally {
    starting.delete(project);
  }
}

export function closeTerminal(project: string, id: number) {
  const entry = byProject.get(project);
  const term = entry?.list.find(x => x.id === id);
  if (!entry || !term) return;
  invoke("pty_kill", { id }).catch(() => {});
  term.xterm.dispose();
  entry.active = activeAfterClose(
    entry.list.map(x => x.id),
    id,
    entry.active,
  );
  entry.list = entry.list.filter(x => x.id !== id);
  changed();
}

export function showTerminal(project: string, id: number) {
  const entry = byProject.get(project);
  if (!entry) return;
  entry.active = id;
  changed();
}
