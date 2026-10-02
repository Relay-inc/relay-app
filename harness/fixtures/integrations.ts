// Mail (60 mails over two pages), GitHub PRs, a Productive board (JSON:API as integration_call returns it), usage and agents.
import { NOW, HOUR, DAY, iso, rng } from "./util";
import { MAIL_ACCOUNT, MAIL_ACCOUNT_2 } from "./vault";
import { LONG_KEY, sidOf, conversations } from "./conversations";

// ---------- mail
const SENDERS = [
  ["Sofie Claes", "sofie@northwind.example"], ["Billing team", "billing@beacon.example"], ["GitHub", "noreply@github.com"],
  ["Jonas Peeters", "jonas@atlas-logistics.example"], [null, "alerts@monitoring.example"], ["Marie Dubois", "marie@orchard-health.example"],
  ["Accountant", "office@accounting.example"], ["Harbor CRM", "support@harbor.example"], ["Tom Willems", "tom@acme.example"],
] as const;
const SUBJECTS = [
  "Acceptance checklist portal v2", "Double balances on dossier D-1042", "[acme/northwind-portal] PR #412 review requested",
  "Depot coordinates", "Alert: staging CPU above 90%", "Intake form French translation", "Invoice September", "API deprecation notice",
  "Lunch Thursday?", "Re: Planner demo", "Your weekly report", "Contract renewal",
];
export const mails = Array.from({ length: 60 }, (_, i) => {
  const [name, email] = SENDERS[i % SENDERS.length];
  return {
    id: String(5000 - i),
    account: MAIL_ACCOUNT,
    subject: SUBJECTS[i % SUBJECTS.length] + (i >= SUBJECTS.length ? ` (${Math.floor(i / SUBJECTS.length) + 1})` : ""),
    date: iso(NOW - i * 3.3 * HOUR - 11 * 60000),
    unread: i % 3 === 0 || i < 4,
    from: [{ name, email }],
    to: [{ name: "Laurent", email: MAIL_ACCOUNT }],
    attachments: i % 5 === 1,
  };
});
// the second account (a generic IMAP server): 8 mails over the last week, merged into the one inbox by date
const STUDIO = [
  ["Lead form: custom planning tool", "Pieter Janssens", "pieter@janssens-bouw.example"], ["Quote request intranet", "Eva Maes", "eva@maes-advocaten.example"],
  ["Your domain renews in 30 days", null, "noreply@registrar.example"], ["Re: Wedding photos selection", "Lotte & Bram", "lotte@example.net"],
  ["Invoice 2026-031 paid", "Bookkeeping", "noreply@books.example"], ["Coffee next week?", "Kim De Smet", "kim@example.net"],
  ["New login on your account", null, "security@registrar.example"], ["Portfolio site feedback", "Eva Maes", "eva@maes-advocaten.example"],
] as const;
export const studioMails = STUDIO.map(([subject, name, email], i) => ({
  id: String(700 - i), account: MAIL_ACCOUNT_2, subject, date: iso(NOW - (i * 21 + 2) * HOUR - 7 * 60000), unread: i < 2,
  from: [{ name, email }], to: [{ name: "Laurent", email: MAIL_ACCOUNT_2 }], attachments: false,
}));
export const STUDIO_MAIL = studioMails[0];
/** mail_list: one account's page of 50, newest first. */
export const mailPage = (account: string, page: number) => (account === MAIL_ACCOUNT_2 ? studioMails : mails).slice((page - 1) * 50, page * 50);
export const PLAIN_MAIL = mails[0]; // plain text with a quoted reply
export const HTML_MAIL = mails[1]; // html
export function mailBody(id: string) {
  const index = mails.findIndex(m => m.id === id);
  const message = mails[index] ?? studioMails.find(m => m.id === id) ?? mails[0];
  const isHtml = index % 3 === 1;
  const text = `Hi Laurent,\n\nThanks for the update on "${message.subject}". Two things before we sign off:\n\n1. The export should include the VAT column.\n2. Can the viewer role see the invoices?\n\nSee https://northwind.example/acceptance for the list.\n\nKind regards,\n${message.from[0].name ?? message.from[0].email}\n\nOn Wed 30 Sep 2026 at 16:02, Laurent <${MAIL_ACCOUNT}> wrote:\n> Hi,\n> The portal is on staging, the checklist is attached.\n> > Earlier: can we have it before October?\n> Laurent`;
  const html = isHtml
    ? `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#222;margin:0"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px"><table width="560" style="background:#fff;border-radius:8px;padding:24px"><tr><td><h1 style="font-size:20px;margin:0 0 12px;color:#1f3a8a">Balance report</h1><p>Dossier <b>D-1042</b> shows two balances since 28 September.</p><table width="100%" style="border-collapse:collapse;font-size:14px"><tr style="background:#eef2ff"><th align="left" style="padding:6px">Date</th><th align="right" style="padding:6px">Amount</th></tr><tr><td style="padding:6px">28/09</td><td align="right" style="padding:6px">€1.240,00</td></tr><tr><td style="padding:6px">29/09</td><td align="right" style="padding:6px">€1.000,00</td></tr></table><p style="margin-top:16px"><a href="https://beacon.example/dossiers/D-1042" style="background:#1f3a8a;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open dossier</a></p><p style="color:#888;font-size:12px">You receive this because you are on the billing list.</p></td></tr></table></td></tr></table></body></html>`
    : null;
  return { text, html, attachments: message.attachments ? [{ index: 0, name: "checklist.pdf", size: 182_400, mime: "application/pdf" }] : [] };
}

// ---------- GitHub
const pr = (number: number, title: string, repo: string, extra: Record<string, unknown>) => ({
  number, title, url: `https://github.com/${repo}/pull/${number}`, repo, draft: false,
  created: iso(NOW - number * 3 * HOUR), updated: iso(NOW - number * HOUR), author: "laurent", review: null, ci: "SUCCESS", project: null, ...extra,
});
export const prs = {
  review: [
    pr(412, "Fix the SSO redirect loop on the portal", "acme/northwind-portal", { author: "sofie-dev", review: "REVIEW_REQUIRED", ci: "FAILURE", project: "Northwind Portal" }),
    pr(88, "Replace balance instead of adding it", "acme/beacon-billing", { author: "tom-w", review: "REVIEW_REQUIRED", ci: "PENDING", project: "Beacon Billing" }),
    pr(57, "Contact sync: incremental cursor", "acme/harbor-crm", { author: "jonas-p", review: "CHANGES_REQUESTED", ci: "SUCCESS", project: "Harbor CRM" }),
  ],
  mine: [
    pr(415, "Invoice export with VAT column", "acme/northwind-portal", { review: "APPROVED", project: "Northwind Portal" }),
    pr(21, "Upgrade to PHP 8.5", "acme/kestrel-api", { draft: true, ci: null, project: "Kestrel API" }),
    pr(9, "Holiday banner", "acme/delmas-shop", { review: "APPROVED", ci: "SUCCESS", project: "Delmas Bakery" }),
  ],
};
const actor = (login: string) => ({ login, name: login });
export function prDetail(repo: string, number: number) {
  const row = [...prs.review, ...prs.mine].find(p => p.repo === repo && p.number === number) ?? prs.review[0];
  return {
    number: row.number, title: row.title, url: row.url, isDraft: row.draft, author: actor(String(row.author)), createdAt: row.created,
    headRefName: "fix/sso-redirect", baseRefName: "main", additions: 148, deletions: 37, changedFiles: 6, mergeable: "MERGEABLE",
    reviewDecision: row.review,
    body: "## What\n\nThe SSO callback stored the return URL **after** the redirect, so a second login looped.\n\n- Store the return URL before redirecting\n- Add a regression test\n\n```ts\nsession.set('returnTo', url);\nreturn redirect(ssoUrl);\n```\n\nCloses #398.",
    commits: { nodes: [{ commit: { statusCheckRollup: { state: row.ci ?? "PENDING", contexts: { nodes: [
      { name: "test (8.5)", conclusion: "SUCCESS", status: "COMPLETED", detailsUrl: "https://github.com/acme/x/actions/runs/1" },
      { name: "lint", conclusion: "SUCCESS", status: "COMPLETED", detailsUrl: "https://github.com/acme/x/actions/runs/2" },
      { name: "e2e (staging)", conclusion: "FAILURE", status: "COMPLETED", detailsUrl: "https://github.com/acme/x/actions/runs/3" },
      { context: "deploy/preview", state: "PENDING", targetUrl: "https://preview.example" },
    ] } } } }] },
    reviewRequests: { nodes: [{ requestedReviewer: actor("laurent") }] },
    comments: { nodes: [
      { author: actor("sofie-dev"), createdAt: iso(NOW - 20 * HOUR), body: "Tested on staging, the loop is gone for me." },
      { author: null, createdAt: iso(NOW - 18 * HOUR), body: "Deploy preview ready." },
    ] },
    reviews: { nodes: [{ author: actor("tom-w"), createdAt: iso(NOW - 10 * HOUR), state: "COMMENTED", body: "One question on the session key." }] },
    reviewThreads: { nodes: [
      { path: "src/auth/callback.ts", line: 42, isResolved: false, isOutdated: false, comments: { nodes: [{ author: actor("tom-w"), createdAt: iso(NOW - 10 * HOUR), body: "Should this key be namespaced per tenant?" }] } },
      { path: "tests/auth.spec.ts", line: 12, isResolved: true, isOutdated: false, comments: { nodes: [{ author: actor("sofie-dev"), createdAt: iso(NOW - 9 * HOUR), body: "Done." }] } },
    ] },
    files: { nodes: [
      { path: "src/auth/callback.ts", additions: 22, deletions: 9 }, { path: "src/auth/session.ts", additions: 8, deletions: 2 },
      { path: "tests/auth.spec.ts", additions: 96, deletions: 0 }, { path: "README.md", additions: 4, deletions: 1 },
      { path: "src/routes/login.tsx", additions: 15, deletions: 23 }, { path: "package.json", additions: 3, deletions: 2 },
    ] },
  };
}

// ---------- Productive, as JSON:API answers to integration_call
const person = (id: string, first: string, last: string) => ({ id, type: "people", attributes: { first_name: first, last_name: last } });
const PEOPLE = [person("70001", "Laurent", "M."), person("70002", "Sofie", "Claes"), person("70003", "Tom", "Willems"), person("70004", "Jonas", "Peeters")];
const LISTS = ["Backlog", "To do", "In progress", "Review", "Done"].map((name, i) => ({ id: `tl${i + 1}`, type: "task_lists", attributes: { name, placement: i + 1 } }));
const STATUSES = ["Not started", "In progress", "In review", "Closed"].map((name, i) => ({ id: `ws${i + 1}`, type: "workflow_statuses", attributes: { name, position: i + 1, category_id: i + 1 } }));
const TASK_TITLES = [
  "Invoice export CSV", "SSO redirect loop", "Viewer role sees invoices", "Avatar upload timeout", "French translation intake",
  "Rate limit docs", "Holiday banner copy", "Dashboard empty state", "Password reset mail", "Audit log export",
  "Search by dossier number", "Bulk archive", "Two-factor setup", "Session timeout warning", "PDF invoice footer",
  "Accessibility pass forms", "Dark mode logo", "Webhook retries", "Import contacts CSV", "Onboarding checklist",
];
const r = rng(42);
const TASKS = TASK_TITLES.map((title, i) => ({
  id: String(900100 + i),
  type: "tasks",
  attributes: {
    title, number: 300 + i, placement: i + 1, closed: false, due_date: i % 4 === 0 ? new Date(NOW + (i - 6) * DAY).toISOString().slice(0, 10) : null, due_time: null,
    created_at: iso(NOW - (20 - i) * DAY), start_date: null, initial_estimate: i % 3 ? 240 : null, worked_time: i % 3 ? 90 : 0, remaining_time: i % 3 ? 150 : null,
    tag_list: i % 5 === 0 ? ["portal", "client"] : [], custom_fields: {},
    description: i === 0 ? "<p>The client wants the invoice list as <b>CSV</b>, with these columns:</p><ul><li>Invoice number</li><li>Date</li><li>Amount excl. VAT</li><li>VAT</li></ul><p>See <a href=\"https://northwind.example/spec\">the spec</a>.</p><script>alert(1)</script>" : `<p>${title}: details in the project note.</p>`,
  },
  relationships: {
    task_list: { data: { type: "task_lists", id: LISTS[i % 5].id } },
    workflow_status: { data: { type: "workflow_statuses", id: STATUSES[Math.min(3, Math.floor((i % 5) * 0.8))].id } },
    assignee: { data: i % 6 === 5 ? null : { type: "people", id: PEOPLE[r.int(0, 3)].id } },
    creator: { data: { type: "people", id: "70002" } },
  },
}));
export const CARD_TITLE = TASK_TITLES[0];
/** The public 100x100 thumb of the picture attachment; integration_thumb turns it into a data URL. */
export const THUMB_URL = "https://files.example/thumb/invoice-list.png";
const page = (data: unknown[], included: unknown[] = []) => ({ data, included, meta: { total_pages: 1 } });
const one = (data: unknown, included: unknown[] = []) => ({ data, included });

/** Answers integration_call("productive", method, path, body) with what the provider package reads. */
export function productive(method: string, path: string, body: unknown): unknown {
  const url = new URL(path, "https://api.productive.io");
  const p = url.pathname;
  const f = (k: string) => url.searchParams.get(`filter[${k}]`);
  if (method !== "GET") {
    const id = p.split("/")[2];
    const task = TASKS.find(x => x.id === id);
    if (task && body && typeof body === "object") Object.assign(task.relationships, (body as { data: { relationships?: object } }).data.relationships || {});
    return p.startsWith("/comments") ? one({ id: "c-new", type: "comments", attributes: {} }) : one(task ?? TASKS[0]);
  }
  if (p === "/projects") return page([{ id: "p1", type: "projects", attributes: { name: "Northwind Portal" } }, { id: "p2", type: "projects", attributes: { name: "Beacon Billing" } }, { id: "p3", type: "projects", attributes: { name: "Internal" } }]);
  if (p === "/folders") return page(f("project_id") === "p1" ? [{ id: "f1", type: "folders", attributes: { name: "Portal v2", placement: 1 } }, { id: "f2", type: "folders", attributes: { name: "Maintenance", placement: 2 } }] : [{ id: `f-${f("project_id")}`, type: "folders", attributes: { name: "Board", placement: 1 } }]);
  if (p === "/task_lists") return page(LISTS);
  if (p === "/tasks") return page(TASKS, [...LISTS, ...PEOPLE, ...STATUSES]);
  if (p.startsWith("/tasks/")) return one(TASKS.find(x => x.id === p.split("/")[2]) ?? TASKS[0], [...LISTS, ...PEOPLE, ...STATUSES]);
  if (p === "/comments") {
    const ids = (f("task_id") || "").split(",");
    return page(ids.slice(0, 40).flatMap((id, i) => [0, 1].map(k => ({
      id: `cm${id}${k}`, type: "comments",
      attributes: { created_at: iso(NOW - (k + 1 + i) * 5 * HOUR), body: k ? "<p>Client confirmed the <b>VAT</b> column.</p>" : "<p>Started on this, first export on staging.</p><ul><li>CSV</li><li>XLSX later</li></ul>" },
      relationships: { creator: { data: { type: "people", id: k ? "70002" : "70001" } }, task: { data: { type: "tasks", id } }, attachments: { data: [] } },
    }))), PEOPLE);
  }
  if (p === "/activities") {
    const ids = (f("task_id") || "").split(",");
    return page(ids.slice(0, 40).map(id => ({ id: `ac${id}`, type: "activities", attributes: { item_type: "task", task_id: Number(id), event: "update", created_at: iso(NOW - 30 * HOUR), changeset: [{ task_list: [{ value: "To do" }, { value: "In progress" }] }] }, relationships: { creator: { data: { type: "people", id: "70003" } } } })), PEOPLE);
  }
  if (p === "/attachments") return page([
    { id: "at1", type: "attachments", attributes: { name: "export-sample.csv", size: 12_800, url: "https://files.example/export-sample.csv", content_type: "text/csv", resized: false, attachable_type: "task", deleted_at: null }, relationships: {} },
    { id: "at2", type: "attachments", attributes: { name: "invoice-list.png", size: 48_200, url: "https://files.example/invoice-list.png", content_type: "image/png", resized: true, thumb: THUMB_URL, attachable_type: "task", deleted_at: null }, relationships: {} },
  ]);
  // the project's saved task views, as the Presets menu lists them: two it can apply, one with a date filter it cannot
  if (p === "/filters") return page([
    { id: "v1", type: "filters", attributes: { name: "My open tasks", filterable_collection: "tasks", hidden: false, params: { $op: "and", assignee_id: { eq: ["{me}"] }, status: { eq: ["1"] } }, group_by: "task-list,task", layout_id: 101 } },
    { id: "v2", type: "filters", attributes: { name: "In review", filterable_collection: "tasks", hidden: false, params: { $op: "and", workflow_status_id: { eq: ["ws3"] } }, group_by: null, layout_id: 100 } },
    { id: "v3", type: "filters", attributes: { name: "Due this week", filterable_collection: "tasks", hidden: false, params: { $op: "and", due_date: { lt_eq: "2026-10-04" } }, group_by: null, layout_id: 101 } },
    { id: "v4", type: "filters", attributes: { name: "Old hidden view", filterable_collection: "tasks", hidden: true, params: {}, group_by: null, layout_id: 101 } },
  ]);
  if (p === "/custom_fields") return page([]);
  if (p.startsWith("/organizations/")) return one({ id: "40001", type: "organizations", attributes: { name: "Acme Agency" } });
  if (p.startsWith("/projects/")) return one({ id: p.split("/")[2], type: "projects", attributes: { name: "Northwind Portal", preferences: { navigation_order: ["v2", "v1", "v3"] } }, relationships: { workflow: { data: { type: "workflows", id: "wf1" } } } });
  if (p === "/workflow_statuses") return page(STATUSES);
  if (p === "/people" || p.startsWith("/people/")) return p === "/people" ? page(PEOPLE) : one(PEOPLE[0]);
  return page([]);
}

// ---------- usage
const tally = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) => ({ input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, cost, unpriced: 0 });
export const usageLimits = [
  { provider: "claude", limits: { ok: true, plan: "Max", windows: [
    { id: "five_hour", label: "limit.session", name: null, pct: 42, resets: iso(NOW + 2 * HOUR + 10 * 60000) },
    { id: "seven_day", label: "limit.weekly", name: null, pct: 81, resets: iso(NOW + 3 * DAY) },
    { id: "seven_day_opus", label: "limit.weeklyModel", name: "Opus", pct: 96, resets: iso(NOW + 3 * DAY) },
  ] } },
  { provider: "codex", limits: { ok: false, reason: "unavailable" } },
];
export function usageTokens() {
  const today = tally(182_000, 64_000, 4_100_000, 310_000, 18.4);
  const week = tally(1_240_000, 402_000, 31_800_000, 2_050_000, 131.7);
  const sessions = conversations.slice(0, 8).map((c, i) => ({ sid: sidOf(c.key), key: c.key, today: tally(9000 * (8 - i), 3000 * (8 - i), 200_000 * (8 - i), 20_000, 1.2 * (8 - i)), week: tally(40_000 * (8 - i), 9000 * (8 - i), 900_000 * (8 - i), 60_000, 6.1 * (8 - i)), last: NOW - i * HOUR }));
  sessions.unshift({ sid: sidOf(LONG_KEY), key: LONG_KEY, today: tally(52_000, 21_000, 1_900_000, 120_000, 7.9), week: tally(52_000, 21_000, 1_900_000, 120_000, 7.9), last: NOW - 3 * 60000 });
  const claude = {
    provider: "claude", today, week, vaultToday: tally(150_000, 50_000, 3_600_000, 280_000, 15.2), vaultWeek: tally(1_000_000, 330_000, 27_000_000, 1_800_000, 110.3),
    models: [
      { model: "claude-opus-5-5", today: tally(120_000, 40_000, 3_000_000, 200_000, 14.1), week: tally(900_000, 300_000, 24_000_000, 1_500_000, 104.2) },
      { model: "claude-sonnet-5-5", today: tally(62_000, 24_000, 1_100_000, 110_000, 4.3), week: tally(340_000, 102_000, 7_800_000, 550_000, 27.5) },
    ],
    sessions,
  };
  const codex = { provider: "codex", today: tally(12_000, 4_000, 90_000, 0, 0.6), week: tally(80_000, 22_000, 600_000, 0, 3.9), vaultToday: tally(0, 0, 0, 0, 0), vaultWeek: tally(0, 0, 0, 0, 0), models: [{ model: "gpt-5.3-codex", today: tally(12_000, 4_000, 90_000, 0, 0.6), week: tally(80_000, 22_000, 600_000, 0, 3.9) }], sessions: [] };
  return { providers: [claude, codex], today: tally(194_000, 68_000, 4_190_000, 310_000, 19.0), week: tally(1_320_000, 424_000, 32_400_000, 2_050_000, 135.6) };
}

// ---------- agents
const caps = (all: boolean) => ({ persistent: true, images: all, thinking: !all, permissions: all, questions: all, subagents: all, fork: all, terminal: all, background: all, effort: true, limits: all, title: true });
const choices = (pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));
export const agentsStatus = {
  default: "claude",
  providers: [
    { id: "claude", name: "Claude Code", on: true, caps: caps(true), detect: { installed: true, bin: "/Users/demo/.local/bin/claude", version: "2.4.1", loggedIn: true, note: null },
      models: choices([["fable", "Fable"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]]), efforts: choices([["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]]),
      bin: "/Users/demo/.local/bin/claude", defaultBin: "/Users/demo/.local/bin/claude" },
    { id: "codex", name: "Codex", on: true, caps: caps(false), detect: { installed: true, bin: "/opt/homebrew/bin/codex", version: "0.61.0", loggedIn: true, note: null },
      models: choices([["gpt-5.3-codex", "GPT-5.3 Codex"]]), efforts: choices([["low", "Low"], ["medium", "Medium"], ["high", "High"]]), bin: "/opt/homebrew/bin/codex", defaultBin: "/opt/homebrew/bin/codex" },
    { id: "opencode", name: "OpenCode", on: false, caps: caps(false), detect: { installed: false, bin: "/opt/homebrew/bin/opencode", version: null, loggedIn: null, note: null },
      models: [], efforts: [], bin: "", defaultBin: "/opt/homebrew/bin/opencode" },
    { id: "pi", name: "Pi", on: false, caps: caps(false), detect: { installed: false, bin: "/opt/homebrew/bin/pi", version: null, loggedIn: null, note: null },
      models: [], efforts: [], bin: "", defaultBin: "/opt/homebrew/bin/pi" },
  ],
};
/** agent_commands: per provider, what the composer completes after a slash. */
export const agentCommands = (provider: string) => (provider === "claude" ? slashCommands : provider === "codex" ? [{ name: "review", description: "Review the working tree" }, { name: "init", description: "Write an AGENTS.md" }] : []);
const slashCommands = [
  { name: "review", description: "Review a pull request", argumentHint: "<pr>" },
  { name: "today", description: "Morning briefing" },
  { name: "mail-draft", description: "Draft a mail in my voice" },
  { name: "compact", description: "Compact the conversation" },
];

// ---------- agent actions (the `relay` command): every action, and the vault's .relay/config.json `actions`
const act = (ext: string, id: string, about: string, write: boolean, def: string) => ({ ext, id, about, write, default: def });
export const actions = [
  act("productive", "list_tasks", "List the open tasks of a board.", false, "auto"),
  act("productive", "create_task", "Create a task on a board.", true, "ask"),
  act("productive", "comment", "Comment on a task.", true, "ask"),
  act("productive", "add_time", "Book time on a service.", true, "ask"),
  act("mail", "search", "Search Gmail (All Mail) with Gmail search syntax, newest first: ids, senders, subjects, dates.", false, "auto"),
  act("mail", "read", "Read one mail: headers, attachment list, text body. Does not mark it read.", false, "auto"),
  act("mail", "thread", "The whole conversation of a mail, oldest first.", false, "auto"),
  act("mail", "attachment", "Save one attachment into ~/Downloads/Relay-mail, returns its path.", false, "auto"),
  act("mail", "save_draft", "Save a full RFC 5322 message as a Gmail draft. Never sent.", true, "auto"),
  act("reminders", "list", "The vault's open reminders, with their ids.", false, "auto"),
  act("reminders", "add", "Add a reminder to the vault.", true, "ask"),
  act("reminders", "done", "Mark a reminder done (a repeating one moves on).", true, "ask"),
  act("reminders", "push", "Move a reminder to another date.", true, "ask"),
];
export const actionConfig = (): Record<string, unknown> => ({ productive: { "*": "ask", add_time: "auto" } });

// ---------- calendar (calendar_meetings, src-tauri/src/calendar.rs): the meetings from an hour ago to 12 hours ahead.
// Waiting shows the ones from 30 minutes before their start until 10 after: one running, one in 4 minutes (its banner
// is due), one in 25; the one in 90 minutes and the one an hour ago are not shown yet or any more.
const MIN = 60_000;
const meeting = (id: string, title: string, from: number, minutes: number, extra: Partial<{ location: string; join: string; organizer: string; people: { name: string; email: string }[] }> = {}) => ({
  id: `${id}@${iso(NOW + from * MIN)}`,
  feed: MAIL_ACCOUNT,
  title,
  start: iso(NOW + from * MIN),
  end: iso(NOW + (from + minutes) * MIN),
  location: "",
  join: "",
  organizer: "",
  people: [],
  ...extra,
});
export const CALENDAR_URL = "https://calendar.google.com/calendar/ical/laurent%40example.com/private-0123456789abcdef/basic.ics";
export const meetings = [
  meeting("retro", "Retro Atlas Logistics", -60, 45, { people: [{ name: "Jonas Peeters", email: "jonas@atlas-logistics.example" }] }),
  meeting("standup", "Daily standup", -5, 15, { join: "https://zoom.us/j/1234567890", people: [{ name: "Tom Willems", email: "tom@acme.example" }, { name: "", email: "dev@acme.example" }] }),
  meeting("review", "Sprint review Northwind Portal", 4, 30, {
    location: "Room Atlas, 2nd floor",
    join: "https://meet.google.com/abc-defg-hij",
    organizer: "sofie@northwind.example",
    people: [{ name: "Sofie Claes", email: "sofie@northwind.example" }, { name: "Tom Willems", email: "tom@acme.example" }, { name: "", email: "qa@northwind.example" }],
  }),
  meeting("kickoff", "Harbor CRM kick-off", 25, 60, { people: [{ name: "", email: "support@harbor.example" }] }),
  meeting("lunch", "Lunch with the accountant", 90, 60, { location: "Café Central", people: [{ name: "Accountant", email: "office@accounting.example" }] }),
];
/** The second calendar of the calendar fixture does not load, so Waiting says so. */
export const calendarErrors = (feeds: string[]) =>
  feeds.includes(MAIL_ACCOUNT_2) ? [`${MAIL_ACCOUNT_2}: Calendar unreachable: curl: (22) The requested URL returned error: 404`] : [];
