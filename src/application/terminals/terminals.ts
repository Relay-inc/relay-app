import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { t } from "../../shared/i18n";
import { activeAfterClose, nextTitle } from "../../domain/terminals/tabs";
import * as backend from "../../infrastructure/backend";
import { useTerminalsStore } from "./store";

// The shells of the embedded terminals (src-tauri/src/pty.rs), per project. A terminal lives until it is closed, not
// until the drawer goes: its xterm keeps the scrollback while nothing shows it, and the next view re-attaches `el`.
// The instances are DOM objects, so they live here beside the store, which only knows the tabs.
export type Screen = { xterm: Terminal; fit: FitAddon; el: HTMLElement; closed: boolean };

const set = useTerminalsStore.setState;
const screens = new Map<number, Screen>();
const starting = new Set<string>();

export const screenOf = (id: number) => screens.get(id);
export const allScreens = () => [...screens.values()];

function patch(project: string, id: number, change: { exited: boolean }) {
  set(draft => {
    const tab = draft.byProject[project]?.tabs.find(x => x.id === id);
    if (tab) Object.assign(tab, change);
  });
}

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
    const el = document.createElement("div");
    el.style.cssText = "width:100%;height:100%";
    const screen: Screen = { xterm, fit, el, closed: false };
    let id = 0;
    let exited = false;
    id = await backend.ptySpawn(
      project,
      xterm.cols,
      xterm.rows,
      bytes => xterm.write(bytes),
      () => {
        // the exit of a closed tab arrives after its xterm is disposed
        if (screen.closed) return;
        exited = true;
        xterm.write(`\r\n\x1b[2m${t("term.exited")}\x1b[0m\r\n`);
        patch(project, id, { exited: true });
      },
    );
    xterm.onData(data => !exited && backend.ptyWrite(id, data));
    xterm.onResize(({ cols, rows }) => !exited && backend.ptyResize(id, cols, rows));
    screens.set(id, screen);
    set(draft => {
      const entry = (draft.byProject[project] ??= { tabs: [], active: 0 });
      entry.tabs.push({ id, title: nextTitle(entry.tabs.map(tab => tab.title)), exited });
      entry.active = id;
    });
  } finally {
    starting.delete(project);
  }
}

export function closeTerminal(project: string, id: number) {
  const screen = screens.get(id);
  if (screen) {
    screen.closed = true;
    screen.xterm.dispose();
    screens.delete(id);
  }
  backend.ptyKill(id).catch(() => {});
  set(draft => {
    const entry = draft.byProject[project];
    if (!entry) return;
    entry.active = activeAfterClose(
      entry.tabs.map(tab => tab.id),
      id,
      entry.active,
    );
    entry.tabs = entry.tabs.filter(tab => tab.id !== id);
  });
}

// the projects that got their first terminal: closing the last tab leaves a project empty, not a fresh shell
const opened = new Set<string>();
/** The first time a project shows its terminals it gets one. */
export function firstTerminal(project: string) {
  if (!project || opened.has(project)) return;
  opened.add(project);
  if (!useTerminalsStore.getState().byProject[project]?.tabs.length) addTerminal(project);
}

export const showTerminal = (project: string, id: number) =>
  set(draft => {
    if (draft.byProject[project]) draft.byProject[project].active = id;
  });
