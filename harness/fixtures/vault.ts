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

/** The shared fixture: a side vault (another vault folder) next to the main one. Its projects' names are keys (the name and the vault's id,
 *  never shown), their `label` what shows. Both vaults have a Northwind Portal: two projects, the team's labelled
 *  "Northwind Portal (Side vault)", each conversation in its own vault. */
export const TEAM_VAULT = "/Users/me/Side vault";
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
    label: "Northwind Portal (Side vault)",
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

/** The shared fixture's vault on a relay-server (Settings › Machines, under its machine): made on the Team server,
 *  paired for workspaces only, this Mac its admin. Its last round two minutes ago made a conflict copy and holds two
 *  deletes back. */
const HUB_FP = "0f9534960dd3570a".padEnd(64, "0");
export const hubMachines = [
  { id: "a1b2c3d4e5f6", name: "Team server", host: "192.168.1.2", port: 47800, fp: HUB_FP, sharedOnly: true },
];
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
/** shared-member: the same vault on a Mac that joined it with a link, a member there. Its server is not one of this
 *  Mac's machines, so the workspace shows in Settings › Machines › Workspaces. */
export const memberVaults = [{ ...sharedVaults[0], role: "member", folder: "/Users/me/Shared/Northwind" }];
/** shared-keeper: the server that member keeps once made admin there, as the backend adds it (shared_vaults::keepers). */
export const keeperMachine = {
  id: HUB_FP.slice(0, 12),
  name: "192.168.1.2",
  host: "192.168.1.2",
  port: 47800,
  fp: HUB_FP,
  sharedOnly: true,
  auto: true,
};
export const sharedStatus = (nowS: number) => ({
  [SHARED_ID]: {
    at: nowS - 120,
    pushed: 4,
    pulled: 17,
    conflicts: ["Projects/Launch Plan/Launch Plan (conflict Studio Mac 2026-10-01 0912).md"],
    errors: [],
    held: ["Projects/Launch Plan/Documents/Old brief.md", "Projects/Launch Plan/Documents/Old timeline.md"],
    bad: 0,
    live: true, // its live channel is connected (relay_remote::channel)
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
/** The side vault's notes, absolute as `vault_notes` gives another vault's. */
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
  // the notes the vault runs on: the Pages tab shows them to an admin under System
  "CLAUDE.md",
  "Resources/Templates/Meeting.md",
  "System/rules/core/memory.md",
];
/** The lunch meeting's note (integrations.ts), with the briefing written before it: shown under Today. */
export const BRIEFING_NOTE = "2026-10-01 Lunch with the accountant";
const briefingNote = `---\ntype: Meeting\n---\n# Lunch with the accountant\n\n## Briefing\n**Next action:** bring the Q3 VAT numbers.\n\n### Open points\n1. The Q3 VAT return is due 20 October\n2. Two invoices from September still unpaid\n\n**Next:** export the Q3 report before lunch.\n\n## Notes\n- \n`;
export const noteText = (target: string) => {
  const name = target.split("/").pop()!.replace(/\.md$/, "");
  if (name === BRIEFING_NOTE) return { path: `Calendar/${BRIEFING_NOTE}.md`, text: briefingNote };
  return {
    path: notes.find(n => n.endsWith(`/${name}.md`)) || target,
    text: `---\ntype: Document\ndescription: How the portal bills a client: one invoice per month, credit notes against the \`invoice_id\` they correct.\ncontext: "[[Billing Spec]]"\nstatus: Active\ncreated: 2026-09-21\narchive: false\nparent:\naliases:\n  - portal\n  - client-portal\nlaatst: 2026-10-01\n---\n# ${name}\n\n> [!note] Archive: old repo\n> The previous repo is archived, all work goes here.\n\n## Stand van zaken\n\nThe note for **${name}**. It links to [[Billing Spec]] and [[Portal Architecture]].\n\n## Open\n\n- [ ] First open loop\n- [ ] Second open loop\n\n| Field | Value |\n|---|---|\n| Owner | Lena |\n| Phase | Build |\n\n| ID | Story | Points |\n|---|---|---|\n| S1.1 | The contact form posts to the backend, which creates the client and the dossier and shows the reference on the confirmation screen | 5 |\n| S1.2 | A duplicate address reuses the existing dossier instead of creating a second one | 3 |\n\n\`\`\`ts\nexport const answer = 42;\n\`\`\`\n`,
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

export const MAIL_ACCOUNT = "lena@example.com";
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
/** The Linear team of the linear fixture (integrations.ts answers its queries). */
const LINEAR_TEAM = "b0000000-0000-4000-8000-000000000001";

export function settings(fixture: string) {
  const onboarding = fixture === "onboarding";
  // a paired work machine that speaks an older protocol (Settings › Machines); phone: the same machine online; github:
  // online, connected to GitHub, with three repos (machineGit). mirror: online, its mirror holding deletes back.
  // nomirror: online, next to a second one paired for workspaces only
  const machines =
    fixture === "machines" ||
    fixture === "phone" ||
    fixture === "github" ||
    fixture === "mirror" ||
    fixture === "nomirror"
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
            ...(fixture === "nomirror"
              ? [
                  {
                    id: "b2c3d4e5f6a1",
                    name: "Team server",
                    host: "192.168.1.3",
                    port: 47800,
                    fp: "7c2e41a09b85d3f6".padEnd(64, "0"),
                    sharedOnly: true,
                  },
                ]
              : []),
          ],
        }
      : {};
  return {
    ...machines,
    vault: onboarding ? "" : VAULT,
    vaults: {},
    projects: { "Beacon Billing": { label: "Beacon" } },
    overrides: {},
    // linear: a Linear team with cycles next to Productive, Beacon Billing on its current cycle; ghprojects: the same
    // with an organization's GitHub project
    integrations: {
      productive: { on: true, org: "40001", user: "70001" },
      ...(fixture === "linear" ? { linear: { on: true, done: false } } : {}),
      ...(fixture === "ghprojects" ? { "github-projects": { on: true } } : {}),
    },
    boards: {
      "Northwind Portal": { provider: "productive", project: "p1", board: "f1" },
      ...(fixture === "linear"
        ? { "Beacon Billing": { provider: "linear", project: LINEAR_TEAM, board: `cycle_${LINEAR_TEAM}` } }
        : {}),
      ...(fixture === "ghprojects"
        ? { "Beacon Billing": { provider: "github-projects", project: "beacon", board: "PVT_kwDOBeacon01" } }
        : {}),
    },
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
      fixture === "calendar" || fixture === "calendar-dark" || fixture.startsWith("today-")
        ? { on: true, feeds: [{ email: MAIL_ACCOUNT }, { email: MAIL_ACCOUNT_2 }] }
        : { on: false, feeds: [] },
    language: "en",
    theme:
      fixture === "dark" ||
      fixture === "calendar-dark" ||
      fixture.endsWith("-dark") ||
      fixture === "plugins-dark" ||
      fixture === "shared-live-dark"
        ? "dark"
        : "light",
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

// ---- fixture "linked": notes outside the projects' folders that point at them (about:, context:, with:)
type Linked = {
  p: string;
  k: string;
  about?: string[];
  context?: string[];
  with?: string[];
  date?: string;
  stage?: "planned" | "briefed" | "wrapped";
  role?: string;
  daysAgo?: number;
};
const people = ["Sofie Claes", "Tom Willems", "Lena Maes", "Jonas Peeters"];
const meet = (
  day: string,
  title: string,
  stage: "planned" | "briefed" | "wrapped",
  who: string[],
  about = ["Northwind Portal"],
  context?: string[],
): Linked => ({
  p: `Calendar/Meetings/2026/${day} ${title}.md`,
  k: "Meeting",
  about,
  context,
  with: who,
  date: day,
  stage,
});
const linkedList: Linked[] = [
  meet("2026-10-08", "Northwind Portal sync", "planned", [people[0]]),
  meet("2026-10-01", "Northwind Portal sprint planning", "briefed", people.slice(0, 3)),
  meet("2026-09-24", "Northwind Portal sync", "wrapped", [people[0]]),
  meet(
    "2026-09-17",
    "Northwind Portal and Atlas Logistics hosting",
    "wrapped",
    [people[0], people[3]],
    ["Northwind Portal", "Atlas Logistics"],
  ),
  // this one points at the project through context: only, which a group counts and an about: filter does not
  meet("2026-09-10", "Northwind Portal design review", "wrapped", [people[1]], [], ["Northwind Portal"]),
  meet("2026-09-03", "Northwind Portal kickoff", "wrapped", people),
  meet("2026-09-30", "Atlas Logistics sync", "wrapped", [people[3]], ["Atlas Logistics"]),
  meet("2026-09-30", "Delmas Bakery opening hours", "wrapped", [people[2]], ["Delmas Bakery"]),
  meet("2026-09-22", "Delmas Bakery holiday banner", "wrapped", [people[1]], ["Delmas Bakery"]),
  { p: "Calendar/Threads/Invoice export columns.md", k: "Thread", about: ["Northwind Portal"], daysAgo: 2 },
  { p: "Calendar/Threads/Portal hosting quote.md", k: "Thread", context: ["Northwind Portal"], daysAgo: 6 },
  { p: "Resources/Reference/Portal pricing notes.md", k: "Reference", about: ["Northwind Portal"], daysAgo: 0 },
  {
    p: "Resources/Reference/Invoice export format.md",
    k: "Reference",
    about: ["Northwind Portal", "Atlas Logistics"],
    daysAgo: 4,
  },
  { p: "Resources/Reference/Depot data sheet.md", k: "Reference", about: ["Atlas Logistics"], daysAgo: 9 },
  { p: "People/Sofie Claes.md", k: "Person", role: "Developer · Agency", context: ["Northwind Portal"] },
  { p: "People/Tom Willems.md", k: "Person", role: "Designer · Northwind", about: ["Northwind Portal"] },
  { p: "People/Lena Maes.md", k: "Person", role: "Product owner · Northwind", about: ["Northwind Portal"] },
  { p: "People/Jonas Peeters.md", k: "Person", role: "Developer · Atlas Logistics", about: ["Atlas Logistics"] },
];
/** The notes the fixture adds to the vault, and what notes_linked tells of them (related.rs `linked`). */
export const linkedPaths = linkedList.map(n => n.p);
const linkedRow = (
  n: { p: string; k: string; at: number; about: string[]; context: string[]; with: string[] } & Partial<Linked>,
) => ({
  t: n.p.split("/").pop()!.replace(/\.md$/, ""),
  date: "",
  stage: "",
  role: "",
  ...n,
});
const projectNote = (p: P) =>
  p.name === "Delmas Bakery"
    ? "Contexts/Agency/Projects/Delmas Bakery.md"
    : `Contexts/${p.context}/Projects/${p.name}/${p.name}.md`;
/** What the index lists as pointing somewhere: the notes above (a meeting sits in the Agency context too, as its
 *  frontmatter says in collections.ts) and each project's own note, which names its context. */
export const linkedNotes = () => [
  ...linkedList.map(n =>
    linkedRow({
      p: n.p,
      k: n.k,
      at: Math.floor((NOW - (n.daysAgo ?? 3) * DAY) / 1000),
      about: n.about ?? [],
      context: n.k === "Meeting" ? ["Agency", ...(n.context ?? [])] : (n.context ?? []),
      with: n.with ?? [],
      date: n.date ?? "",
      stage: n.stage ?? "",
      role: n.role ?? "",
    }),
  ),
  ...P.map(p =>
    linkedRow({
      p: projectNote(p),
      k: "Project",
      at: Math.floor((NOW - p.daysAgo * DAY) / 1000),
      about: [],
      context: [p.context],
      with: [],
    }),
  ),
];
/** In the linked fixtures Delmas Bakery is a flat project: its note alone, no folder of its own. */
export const flat = (p: string) => (p.startsWith("Contexts/Agency/Projects/Delmas Bakery/") ? "" : p);
export const FLAT_NOTE = "Contexts/Agency/Projects/Delmas Bakery.md";
/** For collections.ts: the fixture's projects and linked notes, as the notes they are. */
export const projectsList = P;
export const linkedEntries = linkedList;

/** team: a team server this Mac is logged in to as an organisation admin (src-tauri/src/team.rs). Handbook syncs here,
 *  Sales notes and Research (without history) are the account's other workspaces there. */
export const TEAM_FP = "7ea3".padEnd(64, "b");
export const ORG_NAME = "Bluebird Studio";
export const team = {
  host: "relay.example.com",
  port: 47800,
  fp: TEAM_FP,
  email: "alex@example.com",
  admin: true,
  name: ORG_NAME,
};
export const teamVaults = [
  {
    id: "1123456789abcdef",
    name: "Handbook",
    host: "relay.example.com",
    port: 47800,
    fp: TEAM_FP,
    folder: "/Users/me/Team/Handbook",
    role: "admin",
    team: true,
  },
];
export const teamMe = {
  email: "alex@example.com",
  admin: true,
  name: ORG_NAME,
  workspaces: [
    { id: "1123456789abcdef", name: "Handbook", role: "admin", nohistory: false, here: "/Users/me/Team/Handbook" },
    { id: "2123456789abcdef", name: "Sales notes", role: "member", nohistory: false, here: null },
    { id: "3123456789abcdef", name: "Research", role: "reader", nohistory: true, here: null },
  ],
};
export const teamAccounts = [
  { email: "alex@example.com", role: "admin" },
  { email: "sam@example.com", role: "member" },
  { email: "jo@example.com", role: "reader" },
];
export const teamOverview = {
  accounts: [
    { email: "alex@example.com", admin: true, off: false, devices: 2 },
    { email: "sam@example.com", admin: false, off: false, devices: 1 },
    { email: "jo@example.com", admin: false, off: false, devices: 1 },
    { email: "kim@example.com", admin: false, off: true, devices: 0 },
  ],
  workspaces: [
    {
      id: "1123456789abcdef",
      name: "Handbook",
      nohistory: false,
      members: { "alex@example.com": "admin", "sam@example.com": "member", "jo@example.com": "reader" },
    },
    {
      id: "2123456789abcdef",
      name: "Sales notes",
      nohistory: false,
      members: { "alex@example.com": "member", "sam@example.com": "admin" },
    },
    {
      id: "3123456789abcdef",
      name: "Research",
      nohistory: true,
      members: { "alex@example.com": "reader", "jo@example.com": "admin" },
    },
    // an organisation admin sees it without being in it
    {
      id: "4123456789abcdef",
      name: "Finance",
      nohistory: false,
      members: { "sam@example.com": "admin", "jo@example.com": "member" },
    },
  ],
  invites: [{ id: "a1b2c3d4e5f60718", email: "lee@example.com", expires: 0 }],
  sso: null as null | { issuer: string; client: string; domains: string[] },
};
export const teamLink = (invite = "") =>
  `relay://relay.example.com:47800#team&fp=${TEAM_FP}${invite ? `&invite=${invite}&code=${"c".repeat(64)}` : ""}`;
