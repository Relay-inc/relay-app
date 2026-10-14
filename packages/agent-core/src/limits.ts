/** The most characters of text a provider's `write` (aiWrite) takes: it cuts the rest, the instruction does not count.
 *  Callers budget from this. Same value as `WRITE_MAX` in lib.rs. */
export const WRITE_MAX = 20_000;
