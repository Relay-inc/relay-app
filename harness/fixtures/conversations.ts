// The app's conversations: 60 of them (4 per project, 12 general), their transcripts as the backend's `history` returns
// them (AgentEvent[]), one long one with 300 items, the pending card and question, subagents and a terminal transcript.
import { NOW, HOUR, iso, uuid, rng, pngBase64 } from "./util";
import { projectNames, VAULT, terminalSessions } from "./vault";

type Ev = Record<string, unknown> & { type: string };
type Chat = { key: string; project: string | null; title: string; at: number; provider: string };

const TITLES = [
  "Review the open PR", "Plan the sprint demo", "Draft a status mail", "Estimate the export feature",
  "Debug the staging deploy", "Summarise the last meeting", "Check the invoice totals", "Write the release notes",
  "Map the API endpoints", "Clean up the backlog", "Compare hosting options", "Prepare the client call",
  "Fix the login redirect", "Update the project note", "Analyse the error logs", "Price the maintenance plan",
];
const GENERAL_TITLES = [
  "What is on today", "Weekly overview", "Find the contract template", "Tax questions for Q3",
  "Compare two laptops", "Plan the weekend trip", "Rewrite my bio", "Reading list for October",
  "Garden irrigation timer", "Summarise this article", "Inbox triage", "Ideas for the side business",
];

const keyAt = (ms: number) => `c:${ms.toString(36)}`;
const chats: Chat[] = [];
let n = 0;
for (const project of projectNames)
  for (let i = 0; i < 4; i++, n++)
    chats.push({ key: keyAt(NOW - (n + 1) * 37 * 60000), project, title: TITLES[(n * 7) % TITLES.length], at: NOW - (n + 1) * 37 * 60000, provider: n % 9 === 4 ? "codex" : "claude" });
GENERAL_TITLES.forEach((title, i) => {
  n++;
  chats.push({ key: keyAt(NOW - n * 41 * 60000), project: null, title, at: NOW - n * 41 * 60000, provider: "claude" });
});

// the special ones: the newest conversation of their project, so each is in the sidebar's first five
const special = (project: string, title: string, minutesAgo: number) => {
  const chat = chats.find(c => c.project === project)!;
  chat.title = title;
  chat.at = NOW - minutesAgo * 60000;
  return chat.key;
};
export const LONG_KEY = special("Beacon Billing", "Billing sync double balances", 3);
export const PERMISSION_KEY = special("Northwind Portal", "Push the portal fix", 5);
export const SWITCH_KEY = chats.filter(c => c.project === "Northwind Portal")[1].key;
chats.filter(c => c.project === "Northwind Portal")[1].title = "Invoice export columns";
export const QUESTION_KEY = special("Harbor CRM", "Contact sync strategy", 8);
export const LONG_TITLE = "Billing sync double balances";
export const SWITCH_TITLE = "Invoice export columns";
export const PERMISSION_TITLE = "Push the portal fix";
export const QUESTION_TITLE = "Contact sync strategy";

export const conversations = chats;
export const sidOf = (key: string) => uuid(chats.findIndex(c => c.key === key) + 101);
export const endMarker = (key: string) => `Checked and closed, reference ${chats.findIndex(c => c.key === key) + 1}.`;
export const LONG_END = "That is the full reconciliation for October.";

// ---------- transcripts
const projectNote = (project: string | null) =>
  project ? `${VAULT}/Contexts/Agency/Projects/${project}/${project}.md` : `${VAULT}/Calendar/2026-10-01.md`;
let toolN = 0;
const tool = (name: string, input: Record<string, unknown>): Ev => ({ type: "tool_call", id: `toolu_${String(++toolN).padStart(5, "0")}`, name, input });
const time = (ms: number): Ev => ({ type: "time", at: iso(ms) });
const user = (text: string, images: { media_type: string; data: string }[] = []): Ev => ({ type: "user", text, images });
const ai = (text: string): Ev => ({ type: "text", text, delta: false });

function shortHistory(chat: Chat, index: number): Ev[] {
  const r = rng(index + 7);
  const project = chat.project;
  return [
    time(chat.at - 20 * 60000),
    user(`${chat.title}${project ? ` for ${project}` : ""}. Keep it short.`),
    time(chat.at - 19 * 60000),
    tool("Read", { file_path: projectNote(project) }),
    tool(r.pick(["Grep", "Glob"]), { pattern: r.pick(["invoice", "TODO", "**/*.md", "export"]) }),
    ai(`Here is where it stands${project ? ` for [[${project}]]` : ""}:\n\n- The last change was ${r.int(1, 9)} days ago\n- ${r.int(2, 6)} open items, the oldest since last week\n- Next step: confirm with the client\n\n${endMarker(chat.key)}`),
  ];
}

// the long one: rounds of a question, tool calls of every kind, and a markdown answer, until 300 items
const MD = [
  (i: number) => `## Findings, round ${i}\n\nThe sync writes a **second balance** when a credit note arrives before its invoice. See [[Billing Spec]] and [[Beacon Billing]].\n\n1. Read the invoice table\n2. Match credit notes by reference\n3. Recompute the balance\n   - only for open dossiers\n   - skip archived ones`,
  (i: number) => `| Dossier | Invoice | Credit | Balance |\n|---|---:|---:|---:|\n| D-${1000 + i} | €1.240,00 | €240,00 | €1.000,00 |\n| D-${1001 + i} | €860,50 | €0,00 | €860,50 |\n| D-${1002 + i} | €2.100,00 | €2.100,00 | €0,00 |\n\nThree dossiers checked, one with a stale balance.`,
  (i: number) => `The fix is small. In \`src/Billing/BalanceSync.php\`:\n\n\`\`\`php\npublic function sync(Dossier $dossier): void\n{\n    $credits = $this->credits->forDossier($dossier->id());\n    $balance = $dossier->total()->minus($credits->sum());\n    $this->balances->replace($dossier->id(), $balance); // was: add()\n}\n\`\`\`\n\nRound ${i}: the test covers both orders of arrival.`,
  (i: number) => `### Plan\n\n- [x] Reproduce on a dump\n- [x] Write the failing test\n- [ ] Patch \`replace()\` instead of \`add()\`\n- [ ] Re-run the nightly sync on staging\n\n> The client sees the balance on the portal, so the fix goes out before Friday.\n\nNotes in \`Contexts/Agency/Projects/Beacon Billing/Log.md\`, step ${i}.`,
  (i: number) => `Short answer: yes. The query returned ${40 + i} rows, all with a credit note dated before the invoice. Nothing else matches the pattern, so the scope stays at the sync job.`,
];
const TOOLS: [string, (i: number) => Record<string, unknown>][] = [
  ["Read", () => ({ file_path: `${VAULT}/Contexts/Agency/Projects/Beacon Billing/Beacon Billing.md` })],
  ["Grep", i => ({ pattern: i % 2 ? "BalanceSync" : "creditNote" })],
  ["Bash", i => ({ command: i % 2 ? "php bin/phpunit tests/Billing/BalanceSyncTest.php" : "git log --oneline -5 -- src/Billing" })],
  ["Edit", () => ({ file_path: "/Users/demo/code/beacon/src/Billing/BalanceSync.php" })],
  ["Glob", () => ({ pattern: "src/Billing/**/*.php" })],
  ["WebSearch", () => ({ query: "doctrine replace vs merge entity balance" })],
  ["WebFetch", () => ({ url: "https://www.doctrine-project.org/projects/doctrine-orm/en/latest/reference/working-with-objects.html" })],
  ["Agent", () => ({ description: "Check the other sync jobs", subagent_type: "code-explorer" })],
  ["Skill", () => ({ skill: "code-review" })],
  ["TodoWrite", () => ({ todos: [{ content: "Patch", status: "in_progress" }] })],
  ["Write", () => ({ file_path: `${VAULT}/Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md` })],
  ["mcp__relay-mail__read", () => ({ account: "laurent@example.com", id: "4211" })],
  ["mcp__claude_ai_Notion__notion-search", () => ({ query: "billing incident" })],
  ["MultiEdit", () => ({ file_path: "/Users/demo/code/beacon/tests/Billing/BalanceSyncTest.php" })],
];
let longCache: Ev[] | null = null;
export function longHistory(): Ev[] {
  if (longCache) return longCache;
  const img = { media_type: "image/png", data: pngBase64(320, 200, "#e8eef9", "#3b6fd8") };
  const out: Ev[] = [];
  let items = 0;
  const add = (event: Ev) => {
    out.push(event);
    if (event.type !== "time") items++;
  };
  let t = NOW - 6 * HOUR;
  for (let round = 0; items < 299; round++) {
    add(time((t += 60000)));
    add(user(round === 0 ? "The billing sync shows double balances for some dossiers. Find out why." : `Round ${round}: ${["check the next batch", "what about archived dossiers?", "run the tests again", "show me the diff", "is the client affected?"][round % 5]}`, round % 4 === 1 ? [img] : []));
    for (let k = 0; k < 1 + (round % 3) && items < 299; k++) {
      const [name, input] = TOOLS[(round * 3 + k) % TOOLS.length];
      add(tool(name, input(round)));
    }
    if (items < 299) add(ai(MD[round % MD.length](round)));
  }
  add(ai(`## Done\n\nBalances are recomputed with \`replace()\`, the nightly sync is green on staging. ${LONG_END}`));
  longCache = out;
  return out;
}

export function history(key: string): Ev[] {
  if (key === LONG_KEY) return longHistory();
  const index = chats.findIndex(c => c.key === key);
  if (index < 0) return [];
  const base = shortHistory(chats[index], index);
  if (key === PERMISSION_KEY) base.push(user("Push it so the client can test."), tool("Bash", { command: "git status" }), ai("The branch is clean. I need your go to push."));
  if (key === QUESTION_KEY) base.push(user("Which sync should we use?"), ai("Two options, I asked you below."));
  return base;
}

/** Live events after the long conversation opened: a running tool, a failed one, a draft note and an error. */
export const liveTail = (): Ev[] => [
  { type: "tool_call", id: "toolu_live_ok", name: "Read", input: { file_path: "/Users/demo/code/beacon/src/Billing/Invoice.php" } },
  { type: "tool_result", id: "toolu_live_ok", error: false },
  { type: "tool_call", id: "toolu_live_err", name: "Bash", input: { command: "php bin/console app:sync --dry-run" } },
  { type: "tool_result", id: "toolu_live_err", error: true },
  { type: "error", text: "Process exited with code 1: SQLSTATE[08006] connection to staging database refused" },
  { type: "draft_saved", folder: "Drafts", to: ["finance@beacon.example"], cc: ["pm@acme.example"] },
  { type: "tool_call", id: "toolu_live_run", name: "Grep", input: { pattern: "replace\\(" } },
];

// ---------- the pending card and question (pending/<id>.json)
export const pending = [
  { id: "perm-0001", project: PERMISSION_KEY, provider: "claude", kind: "tool", tool_name: "Bash", input: { command: "git push origin fix/portal-redirect", description: "Push the fix branch to GitHub" }, tool_use_id: "toolu_perm", relay: false, at: NOW - 4 * 60000 },
  {
    id: "ask-0001", project: QUESTION_KEY, provider: "claude", kind: "question", tool_name: "AskUserQuestion", tool_use_id: "toolu_ask", at: NOW - 7 * 60000,
    input: {
      questions: [
        { question: "Which sync strategy should the contact import use?", multiSelect: false, options: [
          { label: "Full resync", description: "Rebuild every contact nightly, simple but slow (40 min)" },
          { label: "Incremental", description: "Only changed contacts via the updated_at cursor" },
          { label: "Webhooks", description: "Push from the CRM, needs their admin to enable it" },
        ] },
        { question: "Who should get the change summary?", multiSelect: true, options: [{ label: "Client PM" }, { label: "Dev team" }, { label: "Nobody" }] },
      ],
    },
  },
];

// ---------- subagents of the long conversation, and their logs
export const subagents = {
  [LONG_KEY]: [
    { id: "a1b2c3d4e5", description: "Check the other sync jobs", agentType: "code-explorer", model: "sonnet", running: true, started_at: iso(NOW - 4 * 60000), last_at: iso(NOW - 20000), tool: "Grep", input: { pattern: "->add\\(" } },
    { id: "b2c3d4e5f6", description: "Scan the error logs", agentType: "general-purpose", model: "haiku", running: true, started_at: iso(NOW - 3 * 60000), last_at: iso(NOW - 5000), tool: "Bash", input: { command: "gcloud logging read 'severity>=ERROR' --limit 50" } },
    { id: "c3d4e5f6a7", description: "Draft the client mail", agentType: "general-purpose", model: "sonnet", running: false, started_at: iso(NOW - 30 * 60000), last_at: iso(NOW - 22 * 60000), text: "Draft saved in Drafts." },
    { id: "d4e5f6a7b8", description: "Verify the totals", agentType: "verifier", model: "sonnet", running: false, started_at: iso(NOW - 50 * 60000), last_at: iso(NOW - 41 * 60000), text: "Totals match for 38 of 38 dossiers." },
  ],
};
export const agentLog = (id: string) => [`Agent ${id} started.`, "Read 4 files in src/Billing.", "Two jobs use add() on balances: InvoiceSync and CreditSync.", "Writing the summary."];

// ---------- the terminal session's transcript (history_sid)
export function terminalHistory(sid: string): Ev[] {
  const session = terminalSessions.find(s => s.sessionId === sid);
  if (!session) return [];
  return [
    time(NOW - 40 * 60000),
    user(session.last_user),
    tool("Bash", { command: "pnpm exec playwright test --project=staging" }),
    tool("Read", { file_path: "/Users/demo/code/northwind/test-results/report.json" }),
    ai("## E2E on staging\n\n**41 passed, 3 failed.**\n\n| Spec | Failure |\n|---|---|\n| login.spec.ts | redirect loop after SSO |\n| invoices.spec.ts | export button hidden for viewers |\n| profile.spec.ts | timeout on avatar upload |\n\nThe redirect loop is the one from [[Northwind Portal]]."),
  ];
}

/** A reply streamed after a `send`: what __harness.stream emits by default. */
export function replyText(words: number): string[] {
  const r = rng(words);
  const vocab = ["the", "sync", "balance", "invoice", "client", "staging", "fix", "test", "dossier", "credit", "note", "job", "query", "report", "export", "portal", "**now**", "`replace()`", "[[Billing Spec]]"];
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    let w = r.pick(vocab);
    if (i % 60 === 0 && i) w = `\n\n## Part ${i / 60}\n\n${w}`;
    else if (i % 17 === 0 && i) w = `${w}.\n\n-`;
    out.push(`${w} `);
  }
  return out;
}
