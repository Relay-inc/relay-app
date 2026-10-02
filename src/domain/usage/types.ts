import type { Limits, Tally, Tokens } from "../agents/types";

// Usage per switched-on agent provider: its plan or rate limits (the backend asks each provider, at most once a
// minute) and the tokens in its local logs, today and this week, then the total over all of them.
export type ProvLimits = { provider: string; limits: Limits };
export type AllTokens = { providers: (Tokens & { provider: string })[]; today: Tally; week: Tally };
