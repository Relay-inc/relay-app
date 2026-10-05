import { pt, t, tn } from "../../shared/i18n";
import { PROVIDERS, provider as providerById } from "../../shared/plugins";
import type { BoardProvider } from "../../domain/board/types";
import {
  NO_MAIL_DRAFT,
  type BoardForm,
  type IntegrationConfig,
  type MailAcct,
  type MailNew,
  type Message,
  type Settings,
} from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { link } from "../../domain/board/rules";
import { ctxOf } from "../board/ctx";
import { commit } from "./window";
import { useSettingsStore, type SettingsState } from "./store";

// Settings › Integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on),
// the others are in the Add menu (Calendar too: it shows under Waiting). In the list means in the sidebar; a row opens the integration's own page, Remove
// switches it off and keeps the token. The state lives here, so it survives going back to the list. That includes what is typed (the board form,
// the GitHub owners, the mail add fields): kept as typed, read and emptied by the save use cases.
const st = () => useSettingsStore.getState();
const current = () => st().settings;
type Integrations = SettingsState["integrations"];
const change = (recipe: (draft: Integrations) => void) =>
  useSettingsStore.setState(draft => {
    recipe(draft.integrations);
  });
const fail = (error: unknown): Message => ({ text: String(error), ok: false });

/** When the page is first shown: which providers have a token, and GitHub's login. */
export async function loadIntegrations() {
  const entries = await Promise.all(
    PROVIDERS.map(
      async provider => [provider.id, await backend.integrationHasToken(provider.id).catch(() => false)] as const,
    ),
  );
  change(draft => {
    draft.tokens = Object.fromEntries(entries);
    draft.loaded = true;
  });
  checkGithub();
}
/** Whether each provider can take its credentials from Claude Code, asked once when the page shows. */
export function askMcp() {
  if (st().integrations.mcpAsked) return;
  change(draft => {
    draft.mcpAsked = true;
  });
  for (const provider of PROVIDERS)
    backend
      .integrationMcp(provider.id)
      .catch(() => ({ supported: false, found: false }))
      .then(mcp =>
        change(draft => {
          draft.mcp[provider.id] = mcp;
        }),
      );
}

/** An integration in or out of the list: on for the sidebar, a board provider's token stays in the keychain. */
export async function switchIntegration(id: string, on: boolean) {
  const next = structuredClone(current());
  if (id === "github") next.github.on = on;
  else if (id === "mail") next.mail = { ...next.mail, on };
  else if (id === "calendar") next.calendar = { ...next.calendar, on };
  else next.integrations[id] = { ...next.integrations[id], on };
  try {
    commit(await backend.setSettings(next));
    change(draft => {
      if (id === "mail") draft.mail.edit.on = on;
      draft.listMessage = null;
    });
  } catch (error) {
    change(draft => {
      draft.listMessage = fail(error);
    });
  }
}

// ---------- the board providers
/** Set up: every secret in the keychain and every field that is not optional. */
export const boardSetUp = (provider: BoardProvider, settings: Settings = current()) =>
  !!st().integrations.tokens[provider.id] &&
  provider.settings.fields.every(
    field => field.optional || field.secret || settings.integrations[provider.id]?.[field.key],
  );
export const isBoardOn = (provider: BoardProvider) => {
  const on = current().integrations[provider.id]?.on;
  return on === true || (on === undefined && boardSetUp(provider));
};
/** The vault's project names, sorted, for mapping boards to them. */
async function loadVaultProjects() {
  const snapshot = await backend.snapshot();
  return snapshot.projects.map(project => project.name).sort((a, b) => a.localeCompare(b));
}
/** Every board of a provider that lists them in one call, to map them to vault projects; once per set-up. */
export async function loadAllBoards(provider: BoardProvider) {
  if (st().integrations.all[provider.id]) return;
  change(draft => {
    draft.all[provider.id] = { list: null, err: "" };
  });
  try {
    const [list, names] = await Promise.all([
      provider.settings.allBoards!(ctxOf(provider, current().integrations)),
      st().integrations.vaultProjects ?? loadVaultProjects(),
    ]);
    change(draft => {
      draft.vaultProjects = names;
      draft.all[provider.id] = { list, err: "" };
    });
  } catch (error) {
    change(draft => {
      draft.all[provider.id] = { list: [], err: String(error) };
    });
  }
}
/** A vault project in the board mapping: the board of this provider it is on, or the other provider it is on. */
export type BoardRow = { vaultProject: string; board?: string; other?: string };
/** Each vault project with the board of this provider it is on; a vault project has at most one board. */
export const boardRows = (provider: BoardProvider): BoardRow[] =>
  (st().integrations.vaultProjects || []).map(vaultProject => {
    const linked = current().boards?.[vaultProject];
    const isOurs = linked?.provider === provider.id;
    return {
      vaultProject,
      board: isOurs ? linked.board : undefined,
      other: linked && !isOurs ? (providerById(linked.provider)?.name ?? linked.provider) : undefined,
    };
  });
const said = (provider: BoardProvider, message: Message) =>
  change(draft => {
    draft.messages[provider.id] = message;
  });
/** A vault project linked to a board (`value` "project/board"), or unlinked (""). */
export type BoardLink = { vaultProject: string; value: string };
/** Link vault projects to the provider's boards or unlink them, in one save. Linking replaces what the vault project
 *  had and takes the board from any other project (domain/board link); unlinking only drops this provider's board,
 *  another provider's link stays. */
export async function mapBoard(provider: BoardProvider, links: BoardLink[]) {
  let boards = current().boards ?? {};
  for (const { vaultProject, value } of links) {
    const [project, board] = value.split("/");
    if (board) boards = link(boards, vaultProject, { provider: provider.id, project, board });
    else if (boards[vaultProject]?.provider === provider.id) boards = link(boards, vaultProject, null);
  }
  try {
    commit(await backend.setSettings({ ...current(), boards }));
    said(provider, { text: t("set.saved"), ok: true });
  } catch (error) {
    said(provider, fail(error));
  }
}
/** A board form field as typed (BoardForm ids). */
export const setBoardField = (id: string, value: string | boolean) =>
  change(draft => {
    draft.form[id] = value;
  });
/** A form value as text: what was typed, else the fallback (a checkbox's value is not text). */
export const formText = (form: BoardForm, id: string, fallback: unknown = "") => {
  const value = form[id];
  return typeof value === "string" ? value : String(fallback ?? "");
};
// what the form holds for this provider, as the config to save and the secrets to put in the keychain
function readForm(provider: BoardProvider, form: BoardForm) {
  const config: IntegrationConfig = { ...current().integrations[provider.id], on: true };
  const secrets: Record<string, string> = { token: formText(form, `tok-${provider.id}`).trim() };
  for (const field of provider.settings.fields) {
    const id = `f-${provider.id}-${field.key}`;
    if (field.check) config[field.key] = !!(form[id] ?? config[field.key]);
    else if (field.secret) secrets[field.key] = formText(form, id).trim();
    else config[field.key] = formText(form, id, config[field.key]).trim();
  }
  return { config, secrets };
}
// saves the token and the config, then one call to the provider to show they work together
async function saveBoard(provider: BoardProvider, config: IntegrationConfig, secrets: Record<string, string> = {}) {
  try {
    for (const [account, token] of Object.entries(secrets)) {
      if (token) await backend.integrationToken(provider.id, token, account);
    }
    const hasToken = await backend.integrationHasToken(provider.id);
    change(draft => {
      draft.tokens[provider.id] = hasToken;
    });
    commit(
      await backend.setSettings({ ...current(), integrations: { ...current().integrations, [provider.id]: config } }),
    );
    const test = await provider.settings.test(ctxOf(provider, current().integrations));
    said(provider, { text: test, ok: true });
    change(draft => {
      delete draft.all[provider.id];
    });
  } catch (error) {
    said(provider, fail(error));
  }
}
/** Save the provider's form. Afterwards the form shows what is stored: the secrets are emptied, the rest follows the
 *  saved config. Secrets the provider refuses as typed stay, with the reason. */
export async function saveBoardForm(provider: BoardProvider) {
  const { config, secrets } = readForm(provider, st().integrations.form);
  const wrong = provider.settings.check?.(secrets);
  if (wrong) return said(provider, { text: pt(provider, wrong), ok: false });
  said(provider, { text: t("int.busy"), ok: true });
  await saveBoard(provider, config, secrets);
  change(draft => {
    for (const id of Object.keys(draft.form))
      if (id === `tok-${provider.id}` || id.startsWith(`f-${provider.id}-`)) delete draft.form[id];
  });
}
/** Token and config from elsewhere (Productive: Claude Code's MCP config). */
export async function importBoard(provider: BoardProvider) {
  try {
    const imported = await backend.integrationImport(provider.id);
    await saveBoard(provider, { ...current().integrations[provider.id], ...imported });
  } catch (error) {
    said(provider, fail(error));
  }
}
export async function clearBoard(provider: BoardProvider) {
  await backend.integrationToken(provider.id, "");
  change(draft => {
    draft.tokens[provider.id] = false;
    delete draft.all[provider.id];
    draft.messages[provider.id] = { text: t("int.cleared"), ok: true };
  });
}

// ---------- GitHub: no token of our own, the app uses gh's login. The status is the account gh is signed in with
export async function checkGithub() {
  change(draft => {
    draft.github.login = "";
    draft.github.error = "";
  });
  try {
    const login = await backend.githubStatus();
    change(draft => {
      draft.github.login = login;
    });
  } catch (error) {
    change(draft => {
      draft.github.error = String(error);
    });
  }
}
/** The owners as typed; null shows the saved ones. */
export const setGithubOwners = (owners: string | null) =>
  change(draft => {
    draft.github.owners = owners;
  });
/** The owners whose PRs are listed, as typed. Once saved, the field shows the saved ones again. */
export async function saveGithub() {
  const owners = (st().integrations.github.owners ?? current().github.owners).trim();
  try {
    commit(await backend.setSettings({ ...current(), github: { ...current().github, owners } }));
    change(draft => {
      draft.github.owners = null;
      draft.github.message = { text: t("set.saved"), ok: true };
    });
  } catch (error) {
    change(draft => {
      draft.github.message = fail(error);
    });
  }
}

// ---------- Mail: the accounts as edited (`mail.edit`), saved with Save or at once when an account is added
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A mail add field as typed. */
export const setMailDraft = (key: keyof MailNew, value: string) =>
  change(draft => {
    draft.mail.draft[key] = value;
  });
const loadMail = () =>
  change(draft => {
    const mail = current().mail;
    draft.mail.edit = { ...mail, accounts: mail?.accounts ?? [] };
  });
const mailSaid = (message: Message | null) =>
  change(draft => {
    draft.mail.message = message;
  });
export const setMailAccount = (email: string) =>
  change(draft => {
    draft.mail.edit.account = email;
  });
// archive, delete, Inbox/Other and bulk actions, saved with Save like the account choice
export const setMailExperimental = (on: boolean) =>
  change(draft => {
    draft.mail.edit.experimental = on;
  });
export const dropMailAccount = (account: MailAcct) =>
  change(draft => {
    delete draft.mail.tests[account.email];
    draft.mail.edit.accounts = draft.mail.edit.accounts.filter(x => x.email !== account.email);
    if (draft.mail.edit.account === account.email) draft.mail.edit.account = "";
  });
// add an account that passed its test and save at once, so nothing is left half set up; the add fields empty
async function keep(account: MailAcct, testResult: string) {
  const edit = st().integrations.mail.edit;
  const others = edit.accounts.filter(x => x.email.toLowerCase() !== account.email.toLowerCase());
  commit(await backend.setSettings({ ...current(), mail: { ...edit, accounts: [...others, account], on: true } }));
  loadMail();
  change(draft => {
    draft.mail.tests[account.email] = { text: testResult, ok: true };
    draft.mail.draft = { ...NO_MAIL_DRAFT };
  });
  mailSaid({ text: t("mail.connected", { email: account.email, n: (testResult.match(/\d+/) || ["?"])[0] }), ok: true });
}
// "connect" and "advanced" both end here: busy while the step runs, the error shown when it fails. Resolves to
// whether the account was added.
async function runStep(step: "connect" | "advanced", work: () => Promise<void>) {
  change(draft => {
    draft.mail.busy = step;
  });
  mailSaid(null);
  let added = true;
  try {
    await work();
  } catch (error) {
    mailSaid(fail(error));
    added = false;
  }
  change(draft => {
    draft.mail.busy = "";
  });
  return added;
}
/** A new add step starts without the last try's message. */
export const clearMailMessage = () => mailSaid(null);
/** Connect with the typed address and app password (Gmail), or a password and server (`imap`): the backend stores the
 *  password in the keychain and tests the login. The password field empties after every attempt; an address refused
 *  before trying keeps both. Resolves to whether the account was added. */
export async function connectMail(imap: boolean) {
  const typed = st().integrations.mail.draft;
  if (!EMAIL.test(typed.email.trim())) {
    mailSaid({ text: t("mail.invalid"), ok: false });
    return false;
  }
  const added = await runStep("connect", async () => {
    const server = imap ? { host: typed.host.trim(), port: Number(typed.port) || 993 } : undefined;
    const connected = await backend.mailConnect(typed.email, typed.password, server);
    await keep(connected.account, connected.result);
  });
  setMailDraft("password", "");
  return added;
}
/** Add the typed account whose password already sits in the keychain. Resolves to whether it was added. */
export async function addMailAccount() {
  const typed = st().integrations.mail.draft;
  const host = typed.host.trim();
  const account: MailAcct = {
    email: typed.email.trim(),
    keychain_service: typed.keychain_service.trim(),
    keychain_account: typed.keychain_account.trim(),
    ...(host ? { host, port: Number(typed.port) || 993 } : {}),
  };
  if (!EMAIL.test(account.email) || !account.keychain_service || !account.keychain_account) {
    mailSaid({ text: t("mail.invalid"), ok: false });
    return false;
  }
  return runStep("advanced", async () => keep(account, await backend.mailTest(account)));
}
export async function testMail(account: MailAcct) {
  change(draft => {
    draft.mail.tests[account.email] = "busy";
  });
  let result: Message;
  try {
    result = { text: await backend.mailTest(account), ok: true };
  } catch (error) {
    result = fail(error);
  }
  change(draft => {
    draft.mail.tests[account.email] = result;
  });
}
export async function saveMail() {
  try {
    commit(await backend.setSettings({ ...current(), mail: st().integrations.mail.edit }));
    loadMail();
    mailSaid({ text: t("set.saved"), ok: true });
  } catch (error) {
    mailSaid(fail(error));
  }
}

// ---------- Calendar: per calendar its email in the settings, its secret iCal address in the keychain
const calendarSaid = (message: Message | null) =>
  change(draft => {
    draft.calendar.message = message;
  });
export const clearCalendarMessage = () => calendarSaid(null);
const feeds = () => current().calendar?.feeds ?? [];
const saveCalendarFeeds = async (list: { email: string }[]) =>
  commit(await backend.setSettings({ ...current(), calendar: { on: true, feeds: list } }));
/** Add a calendar: the backend tries the address, keeps it in the keychain and counts the meetings; only then the email
 *  goes in the settings. Resolves to whether it was added. */
export async function connectCalendar(typed: string, url: string) {
  const email = typed.toLowerCase(); // the backend keeps the keychain entry under the email in lower case
  change(draft => {
    draft.calendar.busy = true;
  });
  calendarSaid(null);
  let added = true;
  try {
    const count = await backend.calendarConnect(email, url);
    const others = feeds().filter(feed => feed.email.toLowerCase() !== email);
    await saveCalendarFeeds([...others, { email }]);
    calendarSaid({ text: tn("cal.connected", count, { email }), ok: true });
  } catch (error) {
    calendarSaid(fail(error));
    added = false;
  }
  change(draft => {
    draft.calendar.busy = false;
  });
  return added;
}
export async function dropCalendar(email: string) {
  try {
    await backend.calendarConnect(email, ""); // an empty address removes it from the keychain
    await saveCalendarFeeds(feeds().filter(feed => feed.email !== email));
    calendarSaid(null);
  } catch (error) {
    calendarSaid(fail(error));
  }
}
