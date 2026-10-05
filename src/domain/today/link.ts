// Which ticket a pull request is about, without asking anyone: a ticket number in its title or branch that is a card
// on the board of its project (#212, 212-…, [212], ENG-12, feature/212-export), or a title close enough to one
// card's title that no other card comes near. What these leave open the app can ask Claude (application/today/links).

export type Candidate = { id: string; number: string; title: string };

const norm = (number: string) => number.replace(/^#/, "").toLowerCase();
/** The ticket numbers a title or branch names: "#212", "ENG-12", a number at the start ("212 Export", "[212]"), or a
 *  number as a branch segment ("feature/212-export", "212_fix"). */
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#(\d{1,7})\b/g)) out.add(m[1]);
  for (const m of text.matchAll(/\b([A-Za-z]{2,10}-\d{1,7})\b/g)) out.add(m[1].toLowerCase());
  const lead = /^\s*\[?(\d{2,7})\]?(?=[\s:._-])/.exec(text);
  if (lead) out.add(lead[1]);
  for (const m of text.matchAll(/(?:^|\/)(\d{2,7})(?=[-_]|$)/g)) out.add(m[1]);
  return [...out];
}

/** The card whose number the PR's title or branch names; null for none, or for two different cards. */
export function byNumber(pr: { title: string; branch?: string }, cards: Candidate[]): Candidate | null {
  const wanted = new Set([...numbersIn(pr.title), ...numbersIn(pr.branch ?? "")]);
  const hits = cards.filter(card => card.number && wanted.has(norm(card.number)));
  return hits.length === 1 ? hits[0] : null;
}

// the words of a title that say something: lower case, no numbers, no short or common words
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "van",
  "het",
  "een",
  "voor",
  "met",
  "naar",
  "add",
  "fix",
  "feat",
  "chore",
  "update",
]);
const words = (title: string) =>
  new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
const overlap = (a: Set<string>, b: Set<string>) => {
  const both = [...a].filter(w => b.has(w)).length;
  return both / Math.max(1, new Set([...a, ...b]).size);
};
/** The card with the PR's title, give or take: at least 60% of the words shared, and clearly closer than the next. */
export function byTitle(title: string, cards: Candidate[]): Candidate | null {
  const mine = words(title);
  if (mine.size < 2) return null;
  const scored = cards
    .map(card => ({ card, score: overlap(mine, words(card.title)) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best && best.score >= 0.6 && (!next || best.score - next.score >= 0.15) ? best.card : null;
}
