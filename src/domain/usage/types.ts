import type { Limits, Tally, Tokens } from "../agents/types";

// Usage per switched-on agent provider: its plan or rate limits (the backend asks each provider, at most once a
// minute) and the tokens in its local logs, today and this week, then the total over all of them.
export type ProvLimits = {
  provider: string;
  limits: Limits;
  /** every account's limits, when the provider has more than one */
  accounts?: { dir: string; name?: string | null; limits: Limits }[] | null;
};
export type AllTokens = {
  providers: (Tokens & { provider: string })[];
  today: Tally;
  week: Tally;
  vault?: VaultActivity;
};

// What the agents' tool calls did in the vault (notes are its .md files): counts today and this week, the notes read
// and changed most this week, and the week per folder ("" is the vault's root).
export type VaultCount = { read: number; write: number; edit: number; search: number; notes: number };
export type VaultActivity = {
  today: VaultCount;
  week: VaultCount;
  topRead: { path: string; n: number }[];
  topChanged: { path: string; n: number }[];
  folders: { folder: string; read: number; changed: number }[];
};
