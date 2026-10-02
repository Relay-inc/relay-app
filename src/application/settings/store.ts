import type { Lang } from "../../shared/i18n";
import {
  EMPTY_SETTINGS,
  type ActionEntry,
  type ActionMeta,
  NO_MAIL_DRAFT,
  type BoardForm,
  type MailCfg,
  type MailNew,
  type MachineStatus,
  type Message,
  type Settings,
} from "../../domain/settings/types";
import type { FolderRow } from "../../domain/settings/machines";
import type { AgentsStatus } from "../../domain/agents/types";
import type { BoardOpt } from "../../domain/board/types";
import type { ProjectIcon, Project, VaultStatus } from "../../domain/workspace/types";
import { makeStore } from "../make-store";

export type SettingsTab = "general" | "projects" | "agents" | "integrations" | "machines";

/** The settings as the backend keeps them and the UI language (both windows), plus what the settings window shows.
 *  Every save result is a `Message | null` (null: nothing to say). */
export type SettingsState = {
  settings: Settings;
  lang: Lang;
  locale: string; // the macOS locale in the UI language, for dates and sorting
  // ---------- the settings window
  loaded: boolean; // settings and vault status read
  vaultStatus: VaultStatus | null;
  tab: SettingsTab;
  message: Message | null; // the last save's result on General and Projects
  agentsPage: { detected: AgentsStatus | null; message: Message | null };
  projectsPage: {
    icons: Record<string, ProjectIcon> | null; // null until the page first shows
    loading: boolean; // the first load started
    names: string[]; // every project, sorted
    projects: Pick<Project, "name" | "context" | "summary">[];
    repos: Record<string, string[]>;
    message: Message | null;
    finding: boolean;
  };
  machinesPage: {
    checked: boolean; // the projects read and every machine checked, once when the page first shows
    projects: string[]; // the vault's project names, sorted
    status: Record<string, MachineStatus | "checking">;
    pairing: boolean;
    pairError: string;
    drafts: Record<string, FolderRow[]>; // folder rows being edited per machine, until Save
    messages: Record<string, Message | null>; // per machine: why the last save or forget failed, or that it saved
  };
  // agent access per extension, from the vault's .relay/config.json: every action, the entry per extension, and why the
  // last load (`""`) or save (by extension) failed
  actions: { list: ActionMeta[]; entries: Record<string, ActionEntry>; errors: Record<string, string> };
  integrations: {
    loaded: boolean; // the tokens are known
    listMessage: Message | null;
    // the token sits in the macOS keychain, the backend only says whether there is one
    tokens: Record<string, boolean>;
    messages: Record<string, Message>;
    // the boards per vault project, for a provider that lists all its boards in one call
    all: Record<string, { list: BoardOpt[] | null; err: string }>;
    vaultProjects: string[] | null;
    // can it take its credentials from Claude Code, and does Claude Code have them (asked once)
    mcp: Record<string, { supported: boolean; found: boolean }>;
    mcpAsked: boolean;
    // what is typed, read on Save: kept here because a row's fields unmount when it folds shut
    form: BoardForm;
    github: { login: string; error: string; message: Message | null; owners: string | null };
    mail: {
      edit: MailCfg;
      draft: MailNew;
      busy: "" | "connect" | "advanced";
      message: Message | null;
      tests: Record<string, Message | "busy">;
    };
    // Calendar: the feeds are saved as soon as one connects, the address itself only goes to the keychain
    calendar: { busy: boolean; message: Message | null };
  };
};

export const useSettingsStore = makeStore<SettingsState>(() => ({
  settings: EMPTY_SETTINGS,
  lang: "en",
  locale: "en",
  loaded: false,
  vaultStatus: null,
  tab: "general",
  message: null,
  agentsPage: { detected: null, message: null },
  projectsPage: { icons: null, loading: false, names: [], projects: [], repos: {}, message: null, finding: false },
  machinesPage: { checked: false, projects: [], status: {}, pairing: false, pairError: "", drafts: {}, messages: {} },
  actions: { list: [], entries: {}, errors: {} },
  integrations: {
    loaded: false,
    listMessage: null,
    tokens: {},
    messages: {},
    all: {},
    vaultProjects: null,
    mcp: {},
    mcpAsked: false,
    form: {},
    github: { login: "", error: "", message: null, owners: null },
    mail: { edit: EMPTY_SETTINGS.mail, draft: NO_MAIL_DRAFT, busy: "", message: null, tests: {} },
    calendar: { busy: false, message: null },
  },
}));
