import type { AgentCfg } from "./types";

/** An extra login of an agent: its config folder (CLAUDE_CONFIG_DIR for Claude Code). */
export type Account = { name: string; dir: string };
/** An agent's logins as settings.agents.providers.<id> keeps them: the extra folders, the one new conversations start
 *  on ("" the CLI's own folder), and whether a conversation moves on when its account's limits run out. */
export type Accounts = { accounts: Account[]; active: string; auto: boolean };

export const accountsOf = (config: AgentCfg): Accounts => ({
  accounts: (config.accounts as Account[] | undefined) ?? [],
  active: (config.active as string | undefined) ?? "",
  auto: config.auto === true,
});

/** A picked folder as a new account, named after the folder without its dot; a folder already listed adds nothing. */
export function addAccount(now: Accounts, dir: string): Accounts | null {
  if (!dir || now.accounts.some(account => account.dir === dir)) return null;
  return { ...now, accounts: [...now.accounts, { name: dir.split("/").pop()!.replace(/^\./, ""), dir }] };
}

export const renameAccount = (now: Accounts, index: number, name: string): Accounts => ({
  ...now,
  accounts: now.accounts.map((account, i) => (i === index ? { ...account, name: name.trim() } : account)),
});

/** Without the account; new conversations go back to the CLI's own folder when it was the active one. */
export const removeAccount = (now: Accounts, index: number): Accounts => ({
  ...now,
  accounts: now.accounts.filter((_, i) => i !== index),
  active: now.active === now.accounts[index]?.dir ? "" : now.active,
});
