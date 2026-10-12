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
  type MirrorProgress,
  type MirrorStatus,
  type ServerSetup,
  type HostStatus,
  type PhonePairing,
  type Message,
  type Settings,
} from "../../domain/settings/types";
import { SETUP_FOLDERS, type SetupPlatform } from "../../domain/settings/machines";
import type { AgentsStatus } from "../../domain/agents/types";
import type { AgentUpdate, UpdateProgress, UpdatesStatus } from "../../domain/settings/updates";
import type { BoardOpt } from "../../domain/board/types";
import type { PluginTest } from "../../domain/plugins/types";
import type { ProjectIcon, Project, VaultStatus } from "../../domain/workspace/types";
import { makeStore } from "../make-store";

export type SettingsTab =
  "general" | "projects" | "agents" | "integrations" | "plugins" | "machines" | "voice" | "updates";

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
  updatesPage: {
    status: UpdatesStatus | null; // null until read
    checking: boolean;
    progress: UpdateProgress | null; // the download, null when not installing
    message: Message | null; // why installing failed
    agents: AgentUpdate[] | null; // null until checked
    updating: string; // the agent being updated, "" for none
    agentMessages: Record<string, Message | null>; // per agent: why its update failed, or that it worked
  };
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
    checked: boolean; // every machine checked, once when the page first shows
    status: Record<string, MachineStatus | "checking">;
    pairing: boolean;
    pairError: string;
    messages: Record<string, Message | null>; // per machine: why the last forget or update failed, or that it updated
    updating: string; // the machine being updated from here, "" for none
    mirror: Record<string, MirrorStatus | null>; // the last mirror round per machine, polled while the page shows
    mirrorMessages: Record<string, Message | null>; // per machine: why the last mirror change failed
    mirrorProgress: Record<string, MirrorProgress | null>; // per machine: the running round, null between rounds
    setup: ServerSetup | null; // this Relay's version and the image, for the setup commands
    setupPlatform: SetupPlatform; // the kind of machine the setup commands are for
    setupMacWay: "app" | "docker"; // how a Mac becomes a machine: Relay itself, or Docker
    host: HostStatus | null; // this Mac as a machine, null until read
    hostLine: string; // the pairing line made for another Mac
    hostError: string;
    phone: Record<string, PhonePairing | null>; // per machine: the pairing made for a phone, until closed
    setupFolder: string; // where the machine keeps relay-server's folders, as typed in the setup section
  };
  // agent access per extension, from the vault's .relay/config.json: every action, the entry per extension, and why the
  // last load (`""`) or save (by extension) failed
  actions: { list: ActionMeta[]; entries: Record<string, ActionEntry>; errors: Record<string, string> };
  pluginsPage: {
    loaded: boolean; // the secrets are known
    secrets: Record<string, Record<string, boolean>>; // per plugin: which of its secrets sit in the keychain
    imports: string[]; // Claude Code's MCP servers that can become plugins
    messages: Record<string, Message | null>; // per plugin: what the last save or test said ("" is the list's)
    tests: Record<string, { busy: boolean; result: PluginTest | null }>; // per plugin: the last test of this session
  };
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
  updatesPage: {
    status: null,
    checking: false,
    progress: null,
    message: null,
    agents: null,
    updating: "",
    agentMessages: {},
  },
  projectsPage: { icons: null, loading: false, names: [], projects: [], repos: {}, message: null, finding: false },
  machinesPage: {
    checked: false,
    status: {},
    pairing: false,
    pairError: "",
    messages: {},
    updating: "",
    mirror: {},
    mirrorMessages: {},
    mirrorProgress: {},
    setup: null,
    setupPlatform: "linux",
    setupFolder: SETUP_FOLDERS.linux,
    setupMacWay: "app",
    host: null,
    hostLine: "",
    hostError: "",
    phone: {},
  },
  actions: { list: [], entries: {}, errors: {} },
  pluginsPage: { loaded: false, secrets: {}, imports: [], messages: {}, tests: {} },
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
