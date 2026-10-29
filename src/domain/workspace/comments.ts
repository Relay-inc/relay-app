/** A comment thread as Relay reads it (comments.rs): who wrote it, what it quotes, where, and its replies. */
export type CommentReply = { id: string; by: string; mine: boolean; at: number; text: string };
export type CommentThread = CommentReply & {
  quote: string;
  anchor: unknown;
  resolved: boolean;
  replies: CommentReply[];
};
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
