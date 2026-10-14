import type { DiffLine } from "./diff";

type Pr = { url: string; repo: string; number: number; title: string };
type File = { pr: string; path: string; lines: DiffLine[] };

/** A file as Claude names it: its path, or with its PR in front when the review covers several ("acme/web#12/src/a.ts"),
 *  so two PRs that change the same path stay apart and a finding lands on the right one. */
export const nameOf = (file: File, prs: Pr[]) => {
  if (prs.length < 2) return file.path;
  const pr = prs.find(p => p.url === file.pr);
  return pr ? `${pr.repo}#${pr.number}/${file.path}` : file.path;
};

/** The PRs as Claude reads them: per PR its title, description and every file's patch under its name. Every PR gets
 *  an equal share of `max`, so a big first PR doesn't push the next one out; `read` counts the files that made it in.
 *  `max` is what the provider takes (WRITE_MAX of agent-core): it cuts anything past it, and `read` would still count those files. */
export function reviewText(prs: Pr[], descriptions: string[], files: File[], max: number) {
  // the PRs are joined by a blank line: that comes off before the shares are cut
  const share = Math.floor((max - 2 * Math.max(0, prs.length - 1)) / Math.max(1, prs.length));
  let read = 0;
  const parts = prs.map((pr, i) => {
    let text = `Pull request ${pr.repo}#${pr.number}: ${pr.title}\n${(descriptions[i] ?? "").slice(0, 3000)}`;
    for (const file of files.filter(f => f.pr === pr.url)) {
      const patch = file.lines
        .map(l => (l.kind === "hunk" ? l.text : `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`))
        .join("\n");
      const block = `\n\n--- ${nameOf(file, prs)}\n${patch}`;
      if (text.length + block.length > share) continue; // ponytail: a file over the share is skipped whole, not cut
      text += block;
      read++;
    }
    return text;
  });
  return { text: parts.join("\n\n"), read };
}
