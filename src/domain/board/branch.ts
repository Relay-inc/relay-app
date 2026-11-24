// The team's branch name for a ticket: <type>/<number>-<slug> (fix/417-decimal-quantities), the PR title starts with
// the number and its body links the ticket.

/** fix when the labels or the title say bug or fix, else feat. */
export const branchType = (title: string, labels: string[] = []) =>
  [title, ...labels].some(text => /\b(bugs?|fix(es|ed)?|hotfix)\b/i.test(text)) ? "fix" : "feat";

/** `fix/417-decimal-quantities`: a lower case ascii slug of the title, cut at a word near 40 characters. */
export function branchName(number: string, title: string, labels: string[] = []) {
  const words = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = words.length > 40 ? words.slice(0, 41).replace(/-?[^-]*$/, "") || words.slice(0, 40) : words;
  const id = number.replace(/^#/, "").toLowerCase();
  return `${branchType(title, labels)}/${[id, slug].filter(Boolean).join("-")}`;
}
