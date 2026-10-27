// The vault side: 12 fictional projects in three contexts, the notes they link to, reminders, settings and the vault status.
import { NOW, DAY, HOUR, iso, ymd, pngBase64 } from "./util";

export const VAULT = "/Users/demo/Vault";

type P = {
  name: string;
  context: string;
  state: string;
  daysAgo: number;
  summary: string;
  open: string[];
  aliases?: string[];
};
const P: P[] = [
  {
    name: "Northwind Portal",
    context: "Agency",
    state: "Active",
    daysAgo: 0,
    summary: "Customer portal v2 in acceptance, invoices export open.",
    open: ["#412 mergen, dan acceptatie (sinds 28/9)", "Invoice export CSV naar klant", "Security review login flow"],
    aliases: ["NWP"],
  },
  {
    name: "Atlas Logistics",
    context: "Agency",
    state: "Active",
    daysAgo: 1,
    summary: "Route planner proof of concept, waiting on depot data.",
    open: ["Depot coordinates opvragen", "Planner demo plannen"],
  },
  {
    name: "Harbor CRM",
    context: "Agency",
    state: "Active",
    daysAgo: 1,
    summary: "Migration to the new CRM API, contact sync rewritten.",
    open: ["Contact sync testen op staging"],
  },
  {
    name: "Delmas Bakery",
    context: "Agency",
    state: "Active",
    daysAgo: 2,
    summary: "Webshop opening hours and holiday banner live.",
    open: [],
  },
  {
    name: "Kestrel API",
    context: "Agency",
    state: "Blocked",
    daysAgo: 5,
    summary: "Waiting on client keys for the partner API.",
    open: ["Keys van klant (sinds 22/9)", "Rate limits documenteren"],
  },
  {
    name: "Orchard Health",
    context: "Agency",
    state: "Active",
    daysAgo: 3,
    summary: "Patient intake form, accessibility pass done.",
    open: ["Formulier vertalen naar FR"],
  },
  {
    name: "Lumen Site",
    context: "Agency",
    state: "Quiet",
    daysAgo: 34,
    summary: "Marketing site, no activity since August.",
    open: [],
  },
  {
    name: "Beacon Billing",
    context: "Agency",
    state: "Active",
    daysAgo: 0,
    summary: "Billing sync double balances investigated, fix on branch.",
    open: ["Fix #88 reviewen", "Saldo's controleren na deploy", "Klant informeren"],
  },
  {
    name: "Side Studio",
    context: "Studio",
    state: "Active",
    daysAgo: 2,
    summary: "Two leads for custom tools, first call next week.",
    open: ["Lead 1 opvolgen"],
  },
  {
    name: "Wedding Photos",
    context: "Studio",
    state: "Active",
    daysAgo: 4,
    summary: "October wedding confirmed, contract signed.",
    open: ["Shotlist afstemmen"],
  },
  {
    name: "Portfolio",
    context: "Personal",
    state: "Active",
    daysAgo: 1,
    summary: "Quarterly check done, no trim levels hit.",
    open: [],
  },
  {
    name: "Homelab",
    context: "Personal",
    state: "Paused",
    daysAgo: 12,
    summary: "Server stable, backup still missing.",
    open: ["Backup naar NAS"],
  },
];
const stand = (p: P) =>
  `*Stand van zaken, laatst bijgewerkt ${ymd(NOW - p.daysAgo * DAY)}.*\n\n${p.summary} The **next step** is agreed with the client.\n\n- Phase: build\n- Risk: timeline on evening work\n- Next: demo on Thursday, see [[${p.name}]]`;

export const projects = P.map(p => ({
  name: p.name,
  context: p.context,
  state: p.state,
  last: ymd(NOW - p.daysAgo * DAY),
  summary: p.summary,
  open: p.open.length ? p.open.length : null,
  open_items: p.open,
  stand: stand(p),
  aliases: p.aliases || [],
}));
export const projectNames = P.map(p => p.name);

/** The shared fixture: a team vault next to the main one. Its projects' names are keys (the name and the vault's id,
 *  never shown), their `label` what shows. Both vaults have a Northwind Portal: two projects, the team's labelled
 *  "Northwind Portal (Team vault)", each conversation in its own vault. */
export const TEAM_VAULT = "/Users/me/Team vault";
const teamKey = (name: string) => `${name}\u001f5f2c8e91a7d04b36`;
export const teamProjects = [
  {
    name: teamKey("Team Handbook"),
    label: "Team Handbook",
    context: "Team",
    state: "Active",
    last: ymd(NOW - DAY),
    summary: "Onboarding chapter rewritten, review by the whole team on Thursday.",
    open: 2,
    open_items: ["Review onboarding chapter", "Add the release checklist"],
    stand: null,
    aliases: [],
    vault: TEAM_VAULT,
  },
  {
    name: teamKey("Northwind Portal"),
    label: "Northwind Portal (Team vault)",
    context: "Team",
    state: "Active",
    last: ymd(NOW - DAY),
    summary: "Release notes for the portal's next version, written with the whole team.",
    open: 1,
    open_items: ["Collect the release notes"],
    stand: null,
    aliases: [],
    vault: TEAM_VAULT,
  },
  {
    name: teamKey("Hiring 2027"),
    label: "Hiring 2027",
    context: "Team",
    state: "Quiet",
    last: ymd(NOW - 9 * DAY),
    summary: "Job post for a medior developer drafted, waiting on budget.",
    open: null,
    open_items: [],
    stand: null,
    aliases: [],
    vault: TEAM_VAULT,
  },
];
export const teamStatus = [{ vault: TEAM_VAULT, error: null }];

/** The shared fixture's vault on a relay-server (Settings › General › Shared vaults): made on the paired Team server,
 *  this Mac its admin. Its last round two minutes ago made a conflict copy and holds two deletes back. */
const HUB_FP = "0f9534960dd3570a".padEnd(64, "0");
export const hubMachines = [{ id: "a1b2c3d4e5f6", name: "Team server", host: "192.168.1.2", port: 47800, fp: HUB_FP }];
export const SHARED_ID = "0123456789abcdef";
export const sharedVaults = [
  {
    id: SHARED_ID,
    name: "Northwind",
    host: "192.168.1.2",
    port: 47800,
    fp: HUB_FP,
    folder: "/Users/me/Shared/Northwind",
    role: "admin",
  },
];
export const sharedStatus = (nowS: number) => ({
  [SHARED_ID]: {
    at: nowS - 120,
    pushed: 4,
    pulled: 17,
    conflicts: ["Projects/Launch Plan/Launch Plan (conflict Studio Mac 2026-10-01 0912).md"],
    errors: [],
    held: ["Projects/Launch Plan/Documents/Old brief.md", "Projects/Launch Plan/Documents/Old timeline.md"],
    bad: 0,
  },
});
/** This Mac's fingerprint, and the vault's other members: an admin on a Studio Mac, a member on a laptop. */
export const SHARED_ME = "5e1d".padEnd(64, "a");
export const sharedMembers = [
  { name: "This MacBook", fp: SHARED_ME, role: "admin", added: 1790000000 },
  { name: "Studio Mac", fp: "7c2b".padEnd(64, "b"), role: "admin", added: 1790100000 },
  { name: "Design laptop", fp: "9a4f".padEnd(64, "c"), role: "member", added: 1790200000 },
];
/** An invite link as the backend makes one: the pairing line with vault, invite and secret (dummy hex). */
export const inviteLink = (invite: string) =>
  `relay://192.168.1.2:47800#fp=${HUB_FP}&code=${"3c".repeat(16)}&vault=${SHARED_ID}&invite=${invite}&secret=${"9e".repeat(32)}`;
/** The team vault's notes, absolute as `vault_notes` gives another vault's. */
export const teamNotes = [
  `${TEAM_VAULT}/Contexts/Team/Projects/Team Handbook.md`,
  `${TEAM_VAULT}/Calendar/2026-10-01 Standup.md`,
];

const contextFolder = (context: string) => `Contexts/${context}`;
export const notes = [
  ...P.map(p => `${contextFolder(p.context)}/Projects/${p.name}/${p.name}.md`),
  ...P.map(p => `${contextFolder(p.context)}/Projects/${p.name}/Log.md`),
  "Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md",
  "Contexts/Agency/Projects/Northwind Portal/Documents/Portal Architecture.md",
  "Resources/Frameworks/Feasibility Analysis.md",
  "Calendar/2026-10-01.md",
];
export const noteText = (target: string) => {
  const name = target.split("/").pop()!.replace(/\.md$/, "");
  return {
    path: notes.find(n => n.endsWith(`/${name}.md`)) || target,
    text: `---\ntype: Document\ndescription: How the portal bills a client: one invoice per month, credit notes against the \`invoice_id\` they correct.\ncontext: "[[Billing Spec]]"\ncreated: 2026-09-21\nparent:\naliases:\n  - portal\n  - client-portal\nlaatst: 2026-10-01\n---\n# ${name}\n\n> [!note] Archive: old repo\n> The previous repo is archived, all work goes here.\n\n## Stand van zaken\n\nThe note for **${name}**. It links to [[Billing Spec]] and [[Portal Architecture]].\n\n## Open\n\n- [ ] First open loop\n- [ ] Second open loop\n\n| Field | Value |\n|---|---|\n| Owner | Laurent |\n| Phase | Build |\n\n| ID | Story | Points |\n|---|---|---|\n| S1.1 | The contact form posts to the backend, which creates the client and the dossier and shows the reference on the confirmation screen | 5 |\n| S1.2 | A duplicate address reuses the existing dossier instead of creating a second one | 3 |\n\n\`\`\`ts\nexport const answer = 42;\n\`\`\`\n`,
  };
};

const rem = (id: string, days: number, project: string | null, title: string, repeat: string | null = null) => ({
  id,
  date: ymd(NOW + days * DAY),
  days,
  project,
  title,
  text: `${title}. Source: [[${project ?? "Calendar/2026-10-01"}]]`,
  repeat,
});
// ids as the backend makes them (8 hex characters, reminders.rs): `reminder` refuses anything else
export const reminders = [
  rem("a1b2c301", -3, "Kestrel API", "Chase the client for the partner API keys"),
  rem("a1b2c302", -1, "Beacon Billing", "Check balances after the billing fix"),
  rem("a1b2c303", 0, "Northwind Portal", "Send the acceptance checklist"),
  rem("a1b2c304", 0, null, "Pay the accountant invoice"),
  rem("a1b2c305", 1, "Atlas Logistics", "Ask for depot coordinates"),
  rem("a1b2c306", 1, "Portfolio", "Earnings print, check the thesis", "3m"),
  rem("a1b2c307", 4, "Wedding Photos", "Shotlist call with the couple"),
  rem("a1b2c308", 6, "Harbor CRM", "Staging test of the contact sync"),
  rem("a1b2c309", 12, "Homelab", "Order the backup disk"),
  rem("a1b2c30a", 30, null, "Renew the domain names", "1m"),
];

/** Terminal sessions: open in the terminal, not started by the app (snapshot.sessions plus the `agents` list). */
export const terminalSessions = [
  {
    sessionId: "7e1f0c2a-1111-4c11-8111-0000000000a1",
    project: "Northwind Portal",
    last_user: "Run the e2e suite against staging and summarise failures",
    last_at: iso(NOW - 25 * 60000),
    name: "e2e staging run",
  },
  {
    sessionId: "7e1f0c2a-2222-4c22-8222-0000000000a2",
    project: null,
    last_user: "Clean up the downloads folder",
    last_at: iso(NOW - 3 * HOUR),
    name: "",
  },
];
export const backgroundBlocked = {
  id: "bg-blocked-1",
  sessionId: "7e1f0c2a-3333-4c33-8333-0000000000a3",
  provider: "claude",
  kind: "background",
  status: "idle",
  state: "blocked",
  name: "nightly-report",
  startedAt: iso(NOW - 6 * HOUR),
};

export function snapshot(list = reminders) {
  return {
    today: ymd(NOW),
    projects,
    sessions: { error: null, items: terminalSessions.map(({ name: _name, ...s }) => s) },
    reminders: list,
    vault: vaultStatus(true),
  };
}

export function vaultStatus(ok: boolean) {
  const map = { workState: "System/rules/core/work-state.md", reminders: "System/reminders.md", notes: "Contexts" };
  return ok
    ? { vault: VAULT, map, found: { workState: true, reminders: true, notes: true }, ok: true }
    : { vault: "", map, found: { workState: false, reminders: false, notes: false }, ok: false };
}

/** What `reminder` and `reminder_add` do to the list (reminders.rs act and add): done drops a row or moves a repeating
 * one on, push moves it, add appends one. `when`: YYYY-MM-DD, morgen, +1w. */
export function remindersAfter(
  list: typeof reminders,
  action: string,
  a: { id?: string; date?: string | null; text?: string; project?: string | null; repeat?: string | null },
  n: number,
) {
  const day = (when: string, from = NOW) =>
    when === "morgen" ? from + DAY : when === "+1w" ? from + 7 * DAY : Date.parse(`${when}T07:30:00Z`);
  const repeatDays = (r: string) => Number(r.slice(0, -1)) * ({ d: 1, w: 7, m: 30 }[r.slice(-1)] ?? 1);
  const at = (date: number, r: (typeof reminders)[number]) => ({
    ...r,
    date: ymd(date),
    days: Math.round((date - NOW) / DAY),
  });
  if (action === "add") {
    const date = day(a.date || "");
    const id = (0xd0000000 + n).toString(16);
    return [
      ...list,
      at(date, {
        id,
        date: "",
        days: 0,
        project: a.project ?? null,
        title: a.text ?? "",
        text: a.text ?? "",
        repeat: a.repeat || null,
      }),
    ];
  }
  const r = list.find(x => x.id === a.id);
  if (!r) throw new Error("This reminder is gone, reload");
  if (action === "done" && !r.repeat) return list.filter(x => x !== r);
  const date = action === "done" ? Date.parse(`${r.date}T07:30:00Z`) + repeatDays(r.repeat!) * DAY : day(a.date || "");
  return list.map(x => (x === r ? at(date, r) : x));
}

export const MAIL_ACCOUNT = "laurent@example.com";
/** Claude Code's extra logins (settings.agents.providers.claude), each its own CLAUDE_CONFIG_DIR. */
const CLAUDE_ACCOUNTS = {
  accounts: [
    { name: "Work", dir: "/Users/demo/.claude-work" },
    { name: "Side projects", dir: "/Users/demo/.claude-side" },
  ],
  active: "/Users/demo/.claude-work",
  auto: true,
};
/** A second account on a non-Gmail IMAP server: the inbox merges both (mail_list per account). */
export const MAIL_ACCOUNT_2 = "studio@example.org";
/** default, dark, graphite (the accent), icons (the sidebar's views as a row of icons), onboarding, calendar (two
 * calendars switched on, the second one failing), accounts
 * (Claude Code on two extra logins, the work one active, auto-switch on), mailexp (the experimental mail flag:
 * archive, delete, Inbox/Other) */
export function settings(fixture: string) {
  const onboarding = fixture === "onboarding";
  // a paired work machine that speaks an older protocol (Settings › Machines); phone: the same machine online; github:
  // online, connected to GitHub, with three repos (machineGit); mirror: online, its mirror holding deletes back
  const machines =
    fixture === "machines" || fixture === "phone" || fixture === "github" || fixture === "mirror"
      ? {
          machines: [
            {
              id: "a1b2c3d4e5f6",
              name: "Server",
              host: "192.168.1.2",
              port: 47800,
              fp: "0f9534960dd3570a".padEnd(64, "0"),
              mirror: { exclude: [] },
            },
          ],
        }
      : {};
  return {
    ...machines,
    vault: onboarding ? "" : VAULT,
    vaults: {},
    projects: { "Beacon Billing": { label: "Beacon" } },
    overrides: {},
    integrations: { productive: { on: true, org: "40001", user: "70001" } },
    boards: { "Northwind Portal": { provider: "productive", project: "p1", board: "f1" } },
    // off: a running pipeline would move the board's cards in every view
    pipelines: {
      "Northwind Portal": {
        on: fixture.startsWith("pipeline"),
        mode: fixture === "pipeline-manual" ? "manual" : "auto",
        repo: "/Users/demo/code/northwind",
        base: "develop",
        group: "list",
        pick: "tl2",
        busy: "tl3",
        review: "tl4",
        input: "tl1",
        merged: "tl5",
        label: fixture === "pipeline" ? "" : "agent",
        parallel: 1,
        checks: "composer install -q && vendor/bin/phpstan && vendor/bin/phpunit",
        reviewer: "codex",
        rounds: 3,
      },
    },
    github: { on: true, owners: "acme" },
    mail: {
      on: true,
      account: MAIL_ACCOUNT,
      accounts: [
        { email: MAIL_ACCOUNT, keychain_service: "relay-mail", keychain_account: MAIL_ACCOUNT },
        {
          email: MAIL_ACCOUNT_2,
          keychain_service: "relay-mail",
          keychain_account: MAIL_ACCOUNT_2,
          host: "imap.example.org",
          port: 993,
        },
      ],
      experimental: fixture === "mailexp",
    },
    calendar:
      fixture === "calendar"
        ? { on: true, feeds: [{ email: MAIL_ACCOUNT }, { email: MAIL_ACCOUNT_2 }] }
        : { on: false, feeds: [] },
    language: "en",
    theme: fixture === "dark" || fixture === "plugins-dark" ? "dark" : "light",
    accent: fixture === "graphite" ? "graphite" : "relay",
    terminal: "auto",
    ...(fixture === "icons" ? { sidebar: { layout: "icons" } } : {}),
    // the example plugin (packages/plugin-example), tested: its view is in the sidebar and its tool is allowed
    plugins: fixture.startsWith("plugins")
      ? [
          {
            id: "example",
            name: "Dice",
            command: "node",
            args: ["/Users/demo/code/relay/packages/plugin-example/server.mjs"],
            env: {},
            secrets: ["API_KEY"],
            on: true,
            allowed: ["roll"],
            views: [
              { uri: "ui://relay-example/dice", name: "Dice" },
              { uri: "ui://relay-example/history", name: "History" },
            ],
          },
        ]
      : [],
    favicons: { on: false, last: "", tried: {} },
    agents: {
      default: "claude",
      providers: {
        claude: { on: true, bin: "", ...(fixture === "accounts" ? CLAUDE_ACCOUNTS : {}) },
        codex: { on: true, bin: "", sandbox: "workspace-write" },
        opencode: { on: false, bin: "" },
        pi: { on: false, bin: "" },
      },
    },
  };
}

export function projectIcons() {
  const img = `data:image/png;base64,${pngBase64(64, 64, "#2f6fdb", "#ffd34d")}`;
  return {
    "Northwind Portal": { value: "icons/northwind.png", img },
    "Atlas Logistics": { value: "🚚", icon: "🚚" },
    "Harbor CRM": { value: "⚓", icon: "⚓" },
    "Delmas Bakery": { value: "🥐", icon: "🥐" },
    "Kestrel API": { value: "", img: null },
    "Orchard Health": { value: "🍏", icon: "🍏" },
    "Beacon Billing": { value: "💡", icon: "💡" },
    "Side Studio": { value: "🛠️", icon: "🛠️" },
    "Wedding Photos": { value: "📷", icon: "📷" },
    Portfolio: { value: "📈", icon: "📈" },
    Homelab: { value: "🖥️", icon: "🖥️" },
  };
}
export const projectRepos = {
  "Northwind Portal": ["acme/northwind-portal", "acme/northwind-api"],
  "Beacon Billing": ["acme/beacon-billing"],
  "Harbor CRM": ["acme/harbor-crm"],
};

/** GitHub on the machine of the "github" fixture, its repos (one clean, one with 2 commits not pushed, one with work
 *  not committed) and the code a Connect gets. */
export const machineGit = {
  github: {
    state: "on",
    login: "octo-demo",
    since: "2026-09-30",
    name: "Relay (Server)",
    email: "octo-demo@users.noreply.github.com",
    error: "",
  },
  repos: [
    { name: "northwind-portal", repo: "acme/northwind-portal", branch: "main", dirty: false, unpushed: 0 },
    { name: "beacon-billing", repo: "acme/beacon-billing", branch: "main", dirty: false, unpushed: 2 },
    { name: "harbor-crm", repo: "acme/harbor-crm", branch: "feature/export", dirty: true, unpushed: 0 },
  ].map(r => ({ ...r, path: `/home/relay/repos/${r.name}` })),
  device: { user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 },
};
