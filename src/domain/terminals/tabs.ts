// The tab bookkeeping of the embedded terminals, apart from xterm so it can be tested.

/** The title of the next tab: "zsh 1", the lowest number no open tab has. */
export function nextTitle(titles: string[]) {
  let n = 1;
  while (titles.includes(`zsh ${n}`)) n++;
  return `zsh ${n}`;
}

/** The tab to show after `closed` goes: the same one, unless it was the one closed, then its neighbour (0 when none is left). */
export function activeAfterClose(ids: number[], closed: number, active: number) {
  if (closed !== active) return active;
  const rest = ids.filter(id => id !== closed);
  return rest[Math.min(ids.indexOf(closed), rest.length - 1)] ?? 0;
}

/** The running tab that continues conversation `chat`, if one does: its terminal button shows that tab again. */
export const chatTab = <T extends { chat?: string; exited: boolean }>(tabs: T[], chat: string) =>
  tabs.find(tab => tab.chat === chat && !tab.exited);
