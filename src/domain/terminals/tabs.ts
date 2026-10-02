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
