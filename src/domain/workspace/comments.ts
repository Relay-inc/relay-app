/** A comment thread as Relay reads it (comments.rs): who wrote it, what it quotes, where, and its replies. */
export type CommentReply = { id: string; by: string; mine: boolean; at: number; text: string };
export type CommentThread = CommentReply & {
  quote: string;
  anchor: unknown;
  resolved: boolean;
  replies: CommentReply[];
  mentionsMe?: boolean; // this Mac's member is mentioned in it (ticket 12)
};
/** A member a comment can mention: the first 16 hex of the fingerprint, and the name. */
export type Member = { fp: string; name: string };

/** What is being typed after an @ right before the caret ("" just after the @), or null: no mention being typed. */
export function mentionQuery(text: string, caret: number): string | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? m[1] : null;
}
/** The members whose name starts with what is typed (any case), at most six, for the @ list. */
export const membersFor = (query: string, members: Member[]) =>
  members.filter(m => m.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);
/** The members a text mentions: those picked whose "@Name" is still in it. */
export const mentionsIn = (text: string, picked: Member[]) => [
  ...new Set(picked.filter(m => text.includes(`@${m.name}`)).map(m => m.fp)),
];
/** Where a comment sits in a page's body (`from` to `to`), or null: its text is gone. */
export type Span = { from: number; to: number } | null;

/** A note of this Mac's own anchors a comment by its quote and where it began: the occurrence of `quote` in `body`
 *  nearest to `offset`, so it stays on its text while lines are added or removed around it. */
export function findQuote(body: string, quote: string, offset: number): Span {
  if (!quote) return null;
  let best = -1;
  for (let at = body.indexOf(quote); at >= 0; at = body.indexOf(quote, at + 1))
    if (best < 0 || Math.abs(at - offset) < Math.abs(best - offset)) best = at;
  return best < 0 ? null : { from: best, to: best + quote.length };
}
