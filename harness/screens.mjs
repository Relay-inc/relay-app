// Screenshots of every view against the mock backend: node harness/screens.mjs --label <name> [--browser chromium|webkit]
// [--only view,view]. PNGs go to harness/screens/<label>/<view>.png. Navigation only uses what a user sees (text, roles,
// keys) and the backend's own levers (the `sel` the window opens on, the backend's menu event).
import { mkdirSync } from "node:fs";
import { HERE, arg, startServer, launch, newPage, open, settle, byText, PAGE_HELPERS } from "./lib.mjs";

const label = arg("label", "current");
const browserName = arg("browser", "chromium");
const only = arg("only", "")?.split(",").filter(Boolean);
const dir = `${HERE}screens/${label}`;
mkdirSync(dir, { recursive: true });

const server = await startServer();
const browser = await launch(browserName);
const page = await newPage(browser);
await page.addInitScript(PAGE_HELPERS);

// the fixture's keys and titles, from the mock itself
await open(page, server.url);
const { keys, titles, markers } = await page.evaluate(() => ({
  keys: window.__harness.keys,
  titles: window.__harness.titles,
  markers: window.__harness.markers,
}));

const waitText = (text, timeout = 10000) =>
  page
    .waitForFunction(t => window.__dom.hasText(t), text, { timeout })
    .catch(() => {
      throw new Error(`text not shown: "${text}"`);
    });
const scrollMain = to =>
  page.evaluate(to => {
    const el = window.__dom.mainScroller();
    if (el) el.scrollTop = to === "top" ? 0 : el.scrollHeight;
  }, to);
const click = async text => {
  await byText(page, text).click();
  await settle(page);
};
const button = name => page.getByRole("button", { name, exact: true }).locator("visible=true").first();
const intoView = async text => {
  await byText(page, text, false).scrollIntoViewIfNeeded();
  await settle(page);
};
/** a folded row of a settings list (an agent, an integration), opened by its name */
const unfold = async name => {
  await page
    .getByRole("button", { name: new RegExp(`^${name}\\b`), expanded: false })
    .locator("visible=true")
    .first()
    .click();
  await settle(page);
};
const settingsPage = async (tab, sub, fixture = "default") => {
  await page.setViewportSize({ width: 900, height: 700 });
  await open(page, server.url, { path: "/settings.html", fixture });
  await click(tab);
  if (sub) await click(sub);
};

const VIEWS = {
  // the phone (mobile.html) at an iPhone's width: the conversation list, and one with a permission card
  "phone-list": async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, server.url, { path: "/mobile.html" });
    await waitText("Claude waits on you"); // the card on top, with the first pending poll
  },
  "phone-new": async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, server.url, { path: "/mobile.html" });
    await click("New conversation");
    await page.locator("textarea").fill("Check why the export skips archived orders");
  },
  "phone-list-dark": async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, server.url, { path: "/mobile.html" });
    await waitText("Claude waits on you");
  },
  "phone-conversation-dark": async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, server.url, { path: "/mobile.html" });
    await page.locator("button:has(span.font-semibold)").nth(1).click(); // the row that needs you
    await waitText("Always allow");
  },
  "phone-conversation": async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, server.url, { path: "/mobile.html" });
    await page.locator("button:has(span.font-semibold)").nth(1).click(); // the row that needs you
    await waitText("Always allow"); // the card, with the next pending poll
  },
  // Settings › Updates, Install and restart pressed: the download's progress
  "settings-updates-install": async () => {
    await settingsPage("Updates");
    await click("Install and restart");
    await waitText("55%");
  },
  // Settings › Machines, a machine online, Add phone pressed: the QR and the line for the phone
  "settings-machines-phone": async () => {
    await settingsPage("Machines", null, "phone");
    await click("Add phone");
    await waitText("Scan this with Relay on your phone");
    await page.getByText("ntfy.sh/relay-").scrollIntoViewIfNeeded();
  },
  // Settings › Machines, pairing a machine for workspaces only: the line pasted, the checkbox ticked
  "settings-machines-pair-shared": async () => {
    await settingsPage("Machines", null, "nomirror");
    await page
      .locator("#mcline")
      .fill(`relay://192.168.1.3:47800#fp=${"7c2e41a09b85d3f6".padEnd(64, "0")}&code=${"c".repeat(32)}`);
    await page.locator("#mcname").fill("Team server");
    await page.locator("#mcshared").check();
    await intoView("Only for workspaces: no mirror of this Mac's vault");
  },
  // the same page further down: Team server, paired for workspaces only, says so where Server shows its mirror
  "settings-machines-shared-only": async () => {
    await settingsPage("Machines", null, "nomirror");
    await waitText("For workspaces only.");
    // the intro says "for workspaces only." too (text matches ignore case): the row's own words
    await intoView("For workspaces only. This Mac's Personal workspace");
  },
  // Settings › Machines, a machine online whose mirror holds 9 deletes back: the first 5 listed, Restore and Delete
  "settings-machines-mirror-held": async () => {
    await settingsPage("Machines", null, "mirror");
    await waitText("9 deletions held");
    await intoView("Restore them");
  },
  // Settings › Machines, a machine online with GitHub connected and three repos: clean, 2 commits not pushed, work
  // not committed
  "settings-machines-github": async () => {
    await settingsPage("Machines", null, "github");
    await waitText("Connected as octo-demo");
    await waitText("2 commits not pushed");
    await intoView("Repos on Server");
  },
  // the same after Disconnect and Connect GitHub: the code to type on GitHub, waiting for it
  "settings-machines-github-code": async () => {
    await settingsPage("Machines", null, "github");
    await waitText("Connected as octo-demo");
    await button("Disconnect").click();
    await button("Disconnect").click();
    await waitText("Not connected");
    await button("Connect GitHub").click();
    await waitText("ABCD-1234");
    await intoView("Waiting for GitHub…");
  },
  // a new conversation about the side vault's Northwind Portal: the Runs in pick fixed on that vault (it stays there)
  "composer-vault": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.keyboard.press("Control+Digit2"); // the side vault shown
    await page.getByPlaceholder(/^Search in /).fill("northwind");
    await byText(page, "Northwind Portal (Side vault)").hover();
    await page
      .getByRole("button", { name: "New conversation about Northwind Portal (Side vault)", exact: true })
      .click();
    await settle(page);
    // before the first message the Runs in pick shows the project's vault, fixed
    await waitText("Side vault");
  },
  // a new general conversation with a side vault and a workspace next to the main one: the Runs in pick open on Your
  // vault, the side vault and the workspace, Runs on next to it
  "composer-vault-pick": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.evaluate(() => window.__harness.emit("menu", "new-general"));
    await settle(page);
    await page.getByRole("button", { name: "Runs in", exact: true }).locator("visible=true").first().click();
    await waitText("Northwind");
  },
  // the workspace Northwind picked there: no Runs on, and Claude Code is the only agent to pick
  "composer-vault-picked": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.evaluate(() => window.__harness.emit("menu", "new-general"));
    await settle(page);
    await page.getByRole("button", { name: "Runs in", exact: true }).locator("visible=true").first().click();
    await click("Northwind");
    await page.getByRole("button", { name: "Agent" }).locator("visible=true").first().click();
    await settle(page);
  },
  // a new conversation about Harbor CRM with Server chosen in "Runs on" before the first message: the chip
  // "harbor-crm · on Server" next to the control (PR #217)
  "composer-repo-chip": async () => {
    await open(page, server.url, { fixture: "github" });
    await byText(page, "Harbor CRM").hover();
    await page.getByRole("button", { name: "New conversation about Harbor CRM", exact: true }).click();
    await settle(page);
    await page.getByRole("button", { name: "Runs on" }).locator("visible=true").first().click();
    await click("Server");
    await waitText("harbor-crm · on Server");
  },
  // a started Harbor CRM conversation that runs on Server, moved to This Mac while harbor-crm has work there that is
  // not pushed: the bar with Push and Move anyway (PR #217)
  "conversation-repo-work": async () => {
    await open(page, server.url, { fixture: "github", sel: keys.question });
    await waitText(titles.question);
    await page.getByRole("button", { name: "Runs on" }).locator("visible=true").first().click();
    await click("This Mac");
    await waitText("has work on Server that is not pushed");
  },
  waiting: async () => {
    await open(page, server.url);
    await waitText(titles.permission);
  },
  // meetings about to start on top (one running, one in 4 minutes, one in 25) and a calendar that did not load
  "waiting-calendar": async () => {
    await open(page, server.url, { fixture: "calendar" });
    await waitText("Sprint review Northwind Portal");
    await waitText(titles.permission);
  },
  "conversation-long-top": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await scrollMain("top");
  },
  "conversation-long-bottom": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.evaluate(() => window.__harness.liveTail());
    await settle(page);
    await scrollMain("bottom");
  },
  // a Read of a picture: its thumbnail on hover, the zoom on a click
  // Cmd-F over a conversation: every match marked, the current one stronger, Enter walked to the third (#261)
  "conversation-find": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.keyboard.press("Meta+f");
    await page.keyboard.type("balance");
    await settle(page, 400);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await settle(page, 300);
  },
  "conversation-tool-image": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.evaluate(() => window.__harness.liveTail());
    await settle(page);
    await scrollMain("bottom");
    await page.getByRole("button", { name: /invoice\.png/ }).hover();
    await settle(page);
  },
  "conversation-tool-image-zoom": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.evaluate(() => window.__harness.liveTail());
    await settle(page);
    await page.getByRole("button", { name: /invoice\.png/ }).click();
    await settle(page);
  },
  // a card whose request carries Claude's permission_suggestions: Deny, Always allow, Allow
  "conversation-permission": async () => {
    await open(page, server.url, { sel: keys.permission });
    await waitText("push origin fix/portal-redirect");
  },
  // leaving plan mode: the plan as a document over the full width, the decision under it (#233, #291)
  "conversation-plan": async () => {
    await open(page, server.url, { sel: keys.permission });
    await waitText("push origin fix/portal-redirect");
    await page.evaluate(
      key =>
        window.__harness.addPending({
          id: "plan-0001",
          project: key,
          provider: "claude",
          kind: "tool",
          tool_name: "ExitPlanMode",
          tool_use_id: "toolu_plan",
          request_id: "req-plan",
          relay: true,
          at: Date.now(),
          input: {
            plan: "# Credit notes before their invoice\n\n## Context\nThe sync writes a second balance when a credit note arrives before its invoice (`H42398`).\n\n- match credit notes by reference\n- only open dossiers\n\n## Steps\n1. **Read the invoice table** in `BalanceSync.php`\n2. Recompute the balance\n\n| Before | After |\n|---|---|\n| two balances | one balance |\n\n## Verification\n- [ ] unit tests\n- [ ] staging run\n",
          },
        }),
      keys.permission,
    );
    await waitText("Claude has a plan", 15000);
    await settle(page, 300);
  },
  "conversation-action": async () => {
    await open(page, server.url, { sel: keys.action });
    await waitText("relay productive.create_task", 10000).catch(() => waitText("Depot import script"));
  },
  // the Git drawer (switched on in Settings › General): the project's two checkouts with staged, unstaged and untracked
  // files and a suggested commit message, a file's diff in a window over the app with a comment on a line, the
  // comments sent to the composer, commit blocked while the conversation works in a repo, and a refused push
  "git-drawer": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.evaluate(() => window.__harness.changeSettings({ gitDrawer: true }));
    await button("Git").click();
    await waitText("BalanceSync.php");
    await button("Suggest a message").click();
    await waitText("Skip a balance the sync already added");
    await settle(page);
  },
  // the agents Claude Code spawned in a conversation (PR: subagents column): the column next to the conversation, a
  // running agent's page followed from its transcript, a finished one's page
  "agents-column": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await waitText("Check the other sync jobs");
    await button("Agents").click();
    await page.locator(".relay-drawer").getByText("Scan the error logs", { exact: true }).waitFor();
    await settle(page);
  },
  "agent-page": async () => {
    await VIEWS["agents-column"]();
    await page.locator(".relay-drawer").getByText("Check the other sync jobs", { exact: true }).click();
    await waitText("The other three set the balance.");
    await settle(page);
  },
  "agent-page-done": async () => {
    await VIEWS["agents-column"]();
    await page.locator(".relay-drawer").getByText("Verify the totals", { exact: true }).click();
    await waitText("Totals match for 38 of 38 dossiers.");
    await settle(page);
  },
  "git-diff": async () => {
    await VIEWS["git-drawer"]();
    await click("BalanceSync.php");
    await click("return; // a retried job: the balance is already there");
    await page.keyboard.type("Is a retried job the only way this happens? Check the queue's retry policy too.");
    await button("Add comment").click();
    await click("$this->repository->addBalance($dossier, $balance);");
    await settle(page);
  },
  // the same diff as one column, switched in the window's header
  "git-diff-unified": async () => {
    await VIEWS["git-diff"]();
    await button("One column").click();
    await settle(page);
  },
  "git-sent": async () => {
    await VIEWS["git-diff"]();
    await page.keyboard.press("Escape");
    // the window's own button: the drawer's is under the backdrop
    await page.locator(".ticket-window").getByRole("button", { name: "Send 1 comment to the composer" }).click();
    await settle(page);
  },
  "git-busy": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.evaluate(() => {
      window.__harness.autoReply = false;
      window.__harness.changeSettings({ gitDrawer: true });
    });
    await page.locator("textarea").locator("visible=true").last().click();
    await page.keyboard.type("Run the sync tests again");
    await page.keyboard.press("Enter");
    await button("Git").click();
    await waitText("BalanceSync.php");
    await page.getByRole("textbox", { name: "Commit message" }).fill("Skip a balance the sync already added");
    await settle(page);
  },
  "git-error": async () => {
    await VIEWS["git-drawer"]();
    await page.getByRole("textbox", { name: "Commit message" }).fill("Skip a balance the sync already added");
    await page.getByRole("button", { name: "Commit & Push", exact: true }).click();
    await waitText("failed to push some refs");
    await settle(page);
  },
  // a repo folded to its header: how many of its files are ticked
  "git-folded": async () => {
    await VIEWS["git-drawer"]();
    await page.getByRole("button", { name: "beacon", exact: true }).click();
    await page.getByRole("button", { name: "beacon-api", exact: true }).click();
    await settle(page);
  },
  // a group of a repo folded: beacon's unversioned files
  "git-group-folded": async () => {
    await VIEWS["git-drawer"]();
    await page.getByRole("button", { name: "Unversioned 2" }).click();
    await settle(page);
  },
  // the log under the commit box: beacon's graph with its merges, then All branches with the spike
  "git-log": async () => {
    await VIEWS["git-drawer"]();
    await page.getByRole("button", { name: "Unversioned 2" }).click();
    await waitText("Merge pull request #41 from acme/feat/credit-notes");
    await settle(page);
  },
  "git-log-all": async () => {
    await VIEWS["git-log"]();
    await button("All branches").click();
    await waitText("Try a queue per tenant");
    await settle(page);
  },
  // a commit of the log opened: its message, its files and the first one's diff
  "git-commit": async () => {
    await VIEWS["git-log"]();
    await click("Skip a balance the sync already added");
    await waitText("src/Billing/BalanceSync.php");
    await settle(page);
  },
  // the Files drawer: the project's code folder and its vault folder, a folder open, git's colours, ignored grey
  "files-drawer": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await page.evaluate(() => window.__harness.changeSettings({ gitDrawer: true }));
    await button("Files").click();
    await click("beacon");
    await click("src");
    await click("Billing");
    await waitText("BalanceSync.php");
    await settle(page);
  },
  // a code file opened from it, read only with its line numbers
  "files-view": async () => {
    await VIEWS["files-drawer"]();
    await click("BalanceSync.php");
    await waitText("final class BalanceSync");
    await settle(page);
  },
  "git-discard": async () => {
    await VIEWS["git-drawer"]();
    await page.getByRole("button", { name: "Discard the changes to scripts/backfill-balances.php" }).click();
    await waitText("Discard changes?");
    await settle(page);
  },
  "conversation-code": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await scrollMain("top");
    await intoView("public function sync(Dossier $dossier): void");
  },
  // a reply streaming in (PR: Claude streams replies and thinking): the thinking folded above the text so far, then opened
  "conversation-thinking-live": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => {
      const h = window.__harness;
      h.emitAgent(key, { type: "thinking", text: "The user asks for the open invoices. ", delta: false });
      h.emitAgent(key, {
        type: "thinking",
        text: "I should read the ledger first, then group by client.",
        delta: true,
      });
      h.emitAgent(key, { type: "text", text: "Three invoices are still open", delta: false });
      h.emitAgent(key, { type: "text", text: ": Northwind (", delta: true });
    }, keys.switchTo);
    await waitText("Three invoices are still open");
    await settle(page);
  },
  "conversation-thinking-open": async () => {
    await VIEWS["conversation-thinking-live"]();
    await page.getByRole("button", { name: "Thinking", exact: true }).locator("visible=true").last().click();
    await settle(page);
  },
  "conversation-steps": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await scrollMain("bottom");
    await byText(page, "3 steps").scrollIntoViewIfNeeded();
    await page.getByText("3 steps", { exact: true }).locator("visible=true").last().click();
    await settle(page);
  },
  "composer-slash": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.locator("textarea").locator("visible=true").last().click();
    await page.keyboard.type("/");
    await settle(page);
  },
  // Relay's own /share-phone in the completion, next to the agent's (PR phone-share)
  "composer-share-slash": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.locator("textarea").locator("visible=true").last().click();
    await page.keyboard.type("/share");
    await settle(page);
  },
  // /share-phone sent: the note in the conversation and the mark in the composer (PR phone-share)
  "composer-phone-shared": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.locator("textarea").locator("visible=true").last().click();
    await page.keyboard.type("/share-phone");
    // the first Enter takes the completion, the second sends
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await waitText("Shared with phone");
    await settle(page);
  },
  // a large paste: the field stops growing at 40% of the window and scrolls, the conversation stays in view
  "composer-paste": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    const field = page.locator("textarea").locator("visible=true").last();
    await field.click();
    await field.fill(Array.from({ length: 200 }, (_, i) => `line ${i + 1} of a pasted log`).join("\n"));
    await settle(page);
  },
  // a picture and two files waiting by their path, the drop highlight off (drag-leave)
  "composer-files": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(() =>
      window.__harness.dropPaths([
        "/Users/demo/Pictures/site photo.png",
        "/Users/demo/Downloads/Q3 report.pdf",
        "/Users/demo/Downloads/Budget 2027.xlsx",
      ]),
    );
    await page.evaluate(() => window.__harness.emit("tauri://drag-leave", null));
    await settle(page, 300);
  },
  "cmd-k-file": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await page.keyboard.press("Meta+k");
    await settle(page);
    await page.evaluate(() => window.__harness.dropPaths(["/Users/demo/Downloads/Q3 report.pdf"]));
    await page.keyboard.type("Summarise this");
    await settle(page, 300);
  },
  // Cmd-K finds the day's meetings, at once (#141)
  "cmd-k-meeting": async () => {
    await open(page, server.url, { fixture: "calendar", sel: "__board:productive" });
    await page.keyboard.press("Meta+k");
    await settle(page);
    await page.keyboard.type("review");
    await settle(page, 300);
  },
  // Cmd-K shows the cards of a board already loaded before the tracker answers, the tracker's own hits below (#141)
  "cmd-k-ticket": async () => {
    await open(page, server.url, { fixture: "calendar", sel: "__board:productive" });
    await page.keyboard.press("Meta+k");
    await settle(page);
    await page.keyboard.type("export");
    await settle(page, 500);
  },
  // a sent message with its files as chips
  "conversation-files": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(() => {
      window.__harness.autoReply = false;
      return window.__harness.dropPaths([
        "/Users/demo/Downloads/Q3 report.pdf",
        "/Users/demo/Downloads/Budget 2027.xlsx",
      ]);
    });
    await page.locator("textarea").locator("visible=true").last().click();
    await page.keyboard.type("Compare these with the plan");
    await page.keyboard.press("Enter");
    await waitText("Compare these with the plan");
    await settle(page, 300);
  },
  // the end of a turn says what the turn did and cost: edits, failed tools, agents, USD (PR: turn receipt)
  "conversation-receipt": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => {
      const h = window.__harness;
      const call = (id, name, input) => h.emitAgent(key, { type: "tool_call", id, name, input });
      const done = (id, error = false) => h.emitAgent(key, { type: "tool_result", id, error });
      call("r1", "Edit", { file_path: "/Users/demo/projects/app/src/sync.ts" });
      done("r1");
      call("r2", "Write", { file_path: "/Users/demo/projects/app/src/sync.test.ts" });
      done("r2");
      call("r3", "Bash", { command: "pnpm test" });
      done("r3", true);
      call("r4", "Agent", { description: "Verify the totals", subagent_type: "verifier" });
      done("r4");
      h.emitAgent(key, { type: "text", text: "Fixed the double booking and added a test.", delta: false });
      h.emitAgent(key, {
        type: "turn_end",
        ok: true,
        usage: { input: 10, output: 900, cacheRead: 52000, cacheWrite: 4000, cost: 0.37 },
        duration_ms: 84000,
      });
    }, keys.switchTo);
    await waitText("Fixed the double booking and added a test.");
    await settle(page, 300);
  },
  // a message sent while Claude works waits under the conversation until Claude reads it (PR: waiting messages)
  "conversation-unread": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => {
      const h = window.__harness;
      h.autoReply = false;
      h.echo = false;
      h.emitAgent(key, { type: "tool_call", id: "u1", name: "Bash", input: { command: "git log --oneline -20" } });
    }, keys.switchTo);
    await page.locator("textarea").locator("visible=true").last().click();
    await page.keyboard.type("Also check the release branch");
    await page.keyboard.press("Enter");
    await waitText("Waiting until Claude Code reads it");
    await settle(page, 300);
  },
  // more than 10 models: the model pick opens on a filter field, "lla" leaves the Llama models (PR: searchable model pick)
  "composer-model-filter": async () => {
    await open(page, server.url, { fixture: "models", sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.locator("button[aria-label='Model']").click();
    await page.keyboard.type("lla");
    await settle(page);
  },
  "composer-resolved": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => window.__harness.resolved(key), keys.switchTo);
    // the label is the model pick's button
    await page.waitForFunction(
      () => window.__dom.all("button[aria-label='Model']").some(b => b.textContent.includes("Opus (default)")),
      null,
      { timeout: 5000 },
    );
  },
  "conversation-question": async () => {
    await open(page, server.url, { sel: keys.question });
    await waitText("Which sync strategy should the contact import use?");
  },
  // an option picked: its preview under the options, and the note on the choice (PR question-card-preview-notes)
  "conversation-question-preview": async () => {
    await open(page, server.url, { sel: keys.question });
    await waitText("Which sync strategy should the contact import use?");
    await page.getByRole("button", { name: "Incremental" }).first().click();
    await page.getByPlaceholder("Note on your choice…").first().fill("Keep the nightly full run as a fallback");
    await settle(page);
  },
  "new-general-draft": async () => {
    await open(page, server.url);
    await page.evaluate(() => window.__harness.emit("menu", "new-general")); // the app menu's Cmd-Option-T
    await settle(page);
  },
  // a window Cmd-N opened starts on Today, whatever the main window had open (#257)
  "new-window": async () => {
    await open(page, server.url, { sel: keys.question, window: "main-2" });
  },
  terminal: async () => {
    await open(page, server.url, { sel: keys.terminal });
    await waitText("41 passed, 3 failed.");
  },
  "mail-second-account": async () => {
    await VIEWS["mail-list"]();
    await click(markers.studioMail);
    await waitText("The export should include the VAT column.");
  },
  "mail-list": async () => {
    await open(page, server.url);
    await click("Mail");
    await waitText(markers.plainMail);
  },
  "mail-plain": async () => {
    await VIEWS["mail-list"]();
    await click(markers.plainMail);
    await waitText("The export should include the VAT column.");
  },
  // the open mail's bar with "Make ticket" next to the draft buttons (a board integration is set up in the fixture)
  "mail-ticket": async () => {
    await VIEWS["mail-plain"]();
    await page.getByRole("button", { name: "Make ticket" }).hover();
    await settle(page, 400);
  },
  "mail-html": async () => {
    await VIEWS["mail-list"]();
    await click(markers.htmlMail);
    await page.waitForFunction(() => window.__dom.all("iframe").some(f => f.srcdoc.includes("Balance report")));
    await settle(page, 400);
  },
  // the experimental mail flag: Inbox/Other tabs, archive and delete in the mail's bar
  "mail-experimental": async () => {
    await open(page, server.url, { fixture: "mailexp" });
    await click("Mail");
    await click(markers.plainMail);
    await waitText("The export should include the VAT column.");
  },
  "mail-other": async () => {
    await VIEWS["mail-experimental"]();
    await page.getByRole("button", { name: /^Other\b/ }).click();
    await waitText(markers.otherMail);
    await settle(page);
  },
  // three mails ticked (Cmd-click, then Shift-click a range): the bulk bar in place of the tabs
  "mail-selection": async () => {
    await VIEWS["mail-experimental"]();
    await byText(page, markers.htmlMail).click({ modifiers: ["Meta"] });
    await byText(page, "Intake form French translation").click({ modifiers: ["Shift"] });
    await waitText("3 selected");
    await settle(page);
  },
  "prs-list": async () => {
    await open(page, server.url);
    await click("Pull requests");
    await waitText("Fix the SSO redirect loop on the portal");
  },
  // the PRs of ticket #312 reviewed together from the list, the same review as Today's item
  "prs-review-together": async () => {
    await VIEWS["prs-list"]();
    await button("Review together (2 PRs)").click();
    await settle(page, 1500);
  },
  // your own PRs of ticket #312 (green checks, so not in Today's queue) reviewed together: the review screen, not "no
  // longer waits on you"
  "prs-review-own-together": async () => {
    await VIEWS["prs-list"]();
    await page.getByRole("button", { name: "Review together (2 PRs)" }).last().click();
    await settle(page, 1500);
  },
  // your own PRs of ticket #309, which has no PRs of others: Today queues nothing under its id, the review rebuilds it
  "prs-review-own-only-together": async () => {
    await VIEWS["prs-list"]();
    await page.locator('button[title*="Audit log export"]').click();
    await settle(page, 1500);
  },
  "pr-detail": async () => {
    await VIEWS["prs-list"]();
    await click("Fix the SSO redirect loop on the portal");
    await waitText("src/auth/callback.ts");
  },
  // a review, then a second opinion on it by Codex: both listed in the PR detail, the second answering the first
  "pr-second-opinion": async () => {
    await VIEWS["pr-detail"]();
    await button("Review").click();
    await page.waitForTimeout(2500);
    await click("Pull requests");
    await click("Fix the SSO redirect loop on the portal");
    await waitText("src/auth/callback.ts");
    await button("Agent").click();
    await page.getByRole("menuitemradio", { name: "Codex" }).click();
    await settle(page);
    await page.screenshot({ path: `${dir}/pr-second-opinion-detail.png` });
    // the clock is fixed and a conversation's key is its start time: a minute later, so the two don't share one
    await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 60_000));
    await button("Second opinion with Codex").click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/pr-second-opinion-chat.png` });
    await click("Pull requests");
    await click("Fix the SSO redirect loop on the portal");
    await waitText("src/auth/callback.ts");
  },
  "pr-review-agent": async () => {
    await VIEWS["pr-detail"]();
    await button("Agent").click();
    await settle(page);
  },
  board: async () => {
    await open(page, server.url);
    await click("Productive");
    await waitText(markers.card);
  },
  "card-detail": async () => {
    await VIEWS.board();
    await click(markers.card);
    await waitText("Amount excl. VAT");
  },
  // Start conversation on a ticket with a screenshot: the picture is attached in the new conversation's composer (#251)
  "ticket-chat-pictures": async () => {
    await VIEWS["card-detail"]();
    await button("Start conversation").click();
    await page.locator(".ticket-window").waitFor({ state: "detached" });
    await settle(page);
  },
  // the ticket window of a board with a hand-picked pipeline: Build with agent under Start conversation
  "ticket-build": async () => {
    await open(page, server.url, { fixture: "pipeline-manual" });
    await click("Productive");
    await waitText(markers.card);
    await click(markers.card);
    await waitText("Build with agent");
  },
  // a Linear team's current cycle as a board, and the board picker offering the cycles (PR linear-cycles)
  "board-linear-cycle": async () => {
    await open(page, server.url, { fixture: "linear" });
    await click("Linear");
    await waitText("Export invoices as UBL");
  },
  "board-linear-picker": async () => {
    await VIEWS["board-linear-cycle"]();
    await click("Current cycle");
    await waitText("Cycle 42");
  },
  "board-list": async () => {
    await VIEWS.board();
    await button("List").click();
    await settle(page);
  },
  ...Object.fromEntries(
    [
      ["filters", "Filters"],
      ["presets", "Presets"],
      ["group", "Task lists"],
    ].map(([name, label]) => [
      `board-${name}`,
      async () => {
        await VIEWS.board();
        await button(label).click();
        await settle(page);
      },
    ]),
  ),
  "ticket-activity": async () => {
    await VIEWS["card-detail"]();
    await page
      .getByPlaceholder(/^(Leave a comment|Comment…)/)
      .first()
      .scrollIntoViewIfNeeded();
    await settle(page);
  },
  reminders: async () => {
    await open(page, server.url);
    await click("Reminders");
    await waitText("Chase the client for the partner API keys");
  },
  "reminders-datepicker": async () => {
    await VIEWS.reminders();
    await page.getByRole("button", { name: "Pick a date" }).first().click();
    await settle(page);
  },
  "reminders-form": async () => {
    await VIEWS.reminders();
    await button("New reminder").click();
    await settle(page);
  },
  "reminders-undo": async () => {
    await VIEWS.reminders();
    await button("Done").click();
    await waitText("Done: Chase the client for the partner API keys");
    await page.mouse.move(720, 890); // off the row that moved up under the pointer
    await settle(page);
  },
  // the footer's usage button opens its summary, View details the view
  "usage-popover": async () => {
    await open(page, server.url);
    await page.getByRole("button", { name: /^Usage/ }).click();
    await waitText("View details");
    await settle(page);
  },
  usage: async () => {
    await VIEWS["usage-popover"]();
    await page.getByRole("button", { name: "View details" }).click();
    await waitText("All of Claude Code", 10000);
    await settle(page);
  },
  // the usage redesign: Claude Code's Details folded open, per model and per conversation (#105)
  "usage-details": async () => {
    await VIEWS.usage();
    await page
      .getByRole("button", { name: /^Details/ })
      .first()
      .click();
    await waitText("By model");
    await settle(page);
  },
  // the Vault usage tab: reads, writes, edits and searches, the notes used most, per folder
  "usage-vault": async () => {
    await VIEWS.usage();
    await page.getByRole("radio", { name: "Vault usage" }).click();
    await waitText("Read most this week");
    await settle(page);
  },
  // the usage redesign in dark mode (#105)
  "dark-usage": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page.getByRole("button", { name: /^Usage/ }).click();
    await page.getByRole("button", { name: "View details" }).click();
    await waitText("All of Claude Code", 10000);
    await settle(page);
  },
  "cmd-k": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await page.keyboard.press("Meta+k");
    await settle(page);
  },
  "cmd-k-project": async () => {
    await VIEWS["cmd-k"]();
    await page.keyboard.type("harb");
    await settle(page);
  },
  // a project and the tickets the trackers found for the same text, the first ticket picked
  "cmd-k-ticket": async () => {
    await VIEWS["cmd-k"]();
    await page.keyboard.type("export");
    await settle(page, 600);
    await page.keyboard.press("ArrowDown");
    await settle(page);
  },
  // the tickets still being searched: the spinner next to the hint
  "cmd-k-searching": async () => {
    await VIEWS["cmd-k"]();
    await page.keyboard.type("export");
    await settle(page, 0);
  },
  "deep-link-ask": async () => {
    await open(page, server.url, { sel: keys.switchTo, link: "relay://ask" }); // the link the app was launched with
    await settle(page, 300);
  },
  "deep-link-open": async () => {
    await open(page, server.url);
    await page.evaluate(() => window.__harness.deepLink("relay://open?q=harbor"));
    await settle(page, 300);
  },
  "sidebar-menu": async () => {
    await open(page, server.url);
    await click("GENERAL"); // folded, so the project sits high enough for its whole menu
    await page
      .getByRole("navigation")
      .first()
      .getByText("Northwind Portal", { exact: true })
      .first()
      .click({ button: "right" });
    await settle(page);
  },
  // a project moved to another workspace: what goes and what stays (PR workspace-migrate)
  "migrate-personal": async () => {
    await open(page, server.url, { fixture: "shared" });
    await click("GENERAL"); // folded, so the project's menu fits
    await page.getByRole("navigation").first().getByText("Beacon", { exact: true }).first().click({ button: "right" });
    await page.getByRole("button", { name: "Side vault" }).first().click();
    await waitText("1 linked repo");
    await settle(page);
  },
  // into a team workspace: the files are listed and Move waits for the tick
  "migrate-team": async () => {
    await open(page, server.url, { fixture: "shared" });
    await click("GENERAL"); // folded, so the project's menu fits
    await page.getByRole("navigation").first().getByText("Beacon", { exact: true }).first().click({ button: "right" });
    await page.getByRole("button", { name: "Northwind", exact: true }).first().click();
    await waitText("team workspace");
    await page.getByText(/^\d+ files go$/).click();
    await settle(page);
  },
  // a project of that name in the target: nothing is written
  "migrate-conflict": async () => {
    await open(page, server.url, { fixture: "shared" });
    await click("GENERAL");
    await page
      .getByRole("navigation")
      .first()
      .getByText("Northwind Portal", { exact: true })
      .first()
      .click({ button: "right" });
    await page.getByRole("button", { name: "Side vault" }).first().click();
    await waitText("nothing is written");
    await settle(page);
  },
  "closed-toast": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(() => window.__harness.emit("menu", "close-chat"));
    await waitText(`Closed: ${titles.switchTo}`, 10000).catch(() => waitText("Closed:", 1000));
    await settle(page);
  },
  // a project conversation: its tools in the title bar; the drawer with the terminal, with notes; the board and the PRs
  // opened from the bar as the project's own
  "project-tools": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
  },
  "drawer-terminal": async () => {
    await VIEWS["project-tools"]();
    await page.getByRole("button", { name: "Terminal", exact: true, pressed: false }).click();
    await page.waitForSelector(".xterm-screen");
    await page.keyboard.type("git status");
    await settle(page, 500);
    await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent?.includes("git status"));
  },
  // the title bar's terminal button resumes the conversation in a drawer tab named after it, next to a shell whose
  // close button is hovered: it fills the tab's right end (#230)
  "drawer-terminal-chat": async () => {
    await VIEWS["project-tools"]();
    await page.getByRole("button", { name: "Resume in terminal (⌥-click: external terminal)" }).click();
    await page.waitForSelector(".xterm-screen");
    await page.getByRole("button", { name: "New terminal" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".relay-drawer button[title='Close terminal']").length === 2,
    );
    await page.locator(".relay-drawer button[title='Close terminal']").last().hover();
    await settle(page, 500);
  },
  // a vault note in the drawer: its frontmatter as properties, a callout, ruled headings, a task list and a table (#233)
  "drawer-note": async () => {
    await open(page, server.url, { sel: keys.long });
    await page.locator("a.vlink", { hasText: "Billing Spec" }).last().click();
    await waitText("Archive: old repo");
    await settle(page, 300);
  },
  // a note of the team vault, linked from a conversation, in the drawer: its absolute path in the bar
  "drawer-note-shared": async () => {
    await open(page, server.url, { fixture: "shared", sel: keys.long });
    await page.evaluate(key => {
      window.__harness.emitAgent(key, { type: "text", text: "The handbook is in [[Team Handbook]].", delta: true });
      window.__harness.emitAgent(key, { type: "turn_end" });
    }, keys.long);
    await waitText("The handbook is in");
    await page.locator("a.vlink", { hasText: "Team Handbook" }).last().click();
    await waitText("Archive: old repo");
    await settle(page, 300);
  },
  // the same note with its properties unfolded under the title (the doc panel design)
  "drawer-note-properties": async () => {
    await VIEWS["drawer-note"]();
    await page.locator(".relay-drawer button[aria-expanded]").click();
    await settle(page, 300);
  },
  "drawer-notes": async () => {
    await VIEWS["project-tools"]();
    await page.getByRole("button", { name: "Notes", exact: true, pressed: false }).click();
    await click("+ New note");
    await page
      .getByRole("textbox")
      .last()
      .fill("Ask Mara about the VAT column\n- export: viewers see no button\n- check the staging seed");
  },
  "tool-board": async () => {
    await VIEWS["project-tools"]();
    await page.getByRole("button", { name: "Productive", exact: true, pressed: false }).last().click(); // the sidebar row comes first
    await waitText(markers.card);
  },
  "tool-prs": async () => {
    await VIEWS["project-tools"]();
    await page.getByRole("button", { name: "Pull requests", exact: true, pressed: false }).click();
    await settle(page, 400);
  },
  // the orchestrator: the coordinator with a folded [Relay] report and the worker board in the drawer (running, done
  // with a diff, silent); the report and a worker's details unfolded; live `orch` events; a worker under its project
  orchestrator: async () => {
    await open(page, server.url, { fixture: "orch", sel: keys.orch });
    await waitText(markers.orchReport, 10000).catch(() => waitText("From Relay"));
  },
  "orchestrator-open": async () => {
    await VIEWS.orchestrator();
    await click("From Relay");
    await click("Details");
  },
  // a board pipeline's worker on the board: its ticket and the PR Relay opened
  "orchestrator-pipeline": async () => {
    await VIEWS.orchestrator();
    await intoView("Export invoices as CSV");
  },
  "orchestrator-live": async () => {
    await VIEWS.orchestrator();
    await page.evaluate(() => window.__harness.orchLive());
    await waitText("Draft the depot import ticket");
    await settle(page, 300);
  },
  // Turn 8: a worker's page next to the column (done, with its question, changes and flags), answered from there
  "orchestrator-worker-page": async () => {
    await VIEWS.orchestrator();
    await page.locator(".relay-drawer").getByText("Patch the balance sync", { exact: true }).click();
    await waitText("read from git by Relay");
  },
  "orchestrator-answered": async () => {
    await VIEWS["orchestrator-worker-page"]();
    await click("Deploy tonight");
    await waitText("sent to the orchestrator");
    await settle(page, 300);
  },
  // a blocked worker's page after the live events, with the options it offered
  "orchestrator-blocked-page": async () => {
    await VIEWS["orchestrator-live"]();
    await page.locator(".relay-drawer").getByText("Fix the login redirect", { exact: true }).click();
    await waitText("Ask the client");
  },
  // a running worker the backend marks stalled (a card nobody answered): "Looks stuck" in the column and on its page
  "orchestrator-stuck": async () => {
    await VIEWS.orchestrator();
    await page.evaluate(() => window.__harness.orchStuck());
    await page.locator(".relay-drawer").getByText("Fix the login redirect", { exact: true }).click();
    await waitText("waits on a permission card for Bash");
  },
  // the orchestrator before its first task
  "orchestrator-empty": async () => {
    await open(page, server.url, { fixture: "orch-empty", sel: keys.orch });
    // the starter, not the title: the bare line it replaces also says "Give it a task across projects"
    await waitText("Draft this week's status mail");
  },
  // every worker closed, so the column lists none: still the empty state, not the bare line
  "orchestrator-closed-empty": async () => {
    await open(page, server.url, { fixture: "orch-closed", sel: keys.orch });
    await page.waitForFunction(() => window.__harness.workersRead);
    await page.waitForTimeout(500);
    await waitText("Draft this week's status mail", 2000);
  },
  // Settings › General › Git in project conversations, switched on (off by default)
  "settings-git": async () => {
    await settingsPage("General");
    await click("Git in project conversations");
    await intoView("Git in project conversations");
  },
  // the workers without their crabs (Settings › General › Crabs for the orchestrator's workers off)
  "orchestrator-plain": async () => {
    await open(page, server.url, { fixture: "orch-plain", sel: keys.orch });
    await waitText("Open worker");
  },
  "settings-crabs": async () => {
    await settingsPage("General");
    await intoView("Crabs for the orchestrator's workers");
  },
  "orchestrator-worker": async () => {
    await open(page, server.url, { fixture: "orch", sel: keys.orchWorker });
    await waitText("From Relay");
  },
  ...Object.fromEntries(
    ["General", "Projects", "Agents", "Integrations", "Plugins", "Voice", "Shortcuts", "Updates"].map(tab => [
      `settings-${tab.toLowerCase()}`,
      () => settingsPage(tab),
    ]),
  ),
  // the keys that work in a conversation, Find among them
  // ⌃1 to ⌃9 for the workspaces, changeable like the others (PR #294)
  "settings-shortcuts-workspaces": async () => {
    await settingsPage("Shortcuts");
    await intoView("Workspace 9 in the footer's menu");
  },
  "settings-shortcuts-chat": async () => {
    await settingsPage("Shortcuts");
    await intoView("Find in the conversation");
  },
  // the speech models, Whisper among them
  "settings-voice-models": async () => {
    await settingsPage("Voice");
    await intoView("Whisper Large v3 Turbo");
  },
  // Settings › Machines of the workspace's admin: Team server, paired for workspaces only, with the workspace under it: its
  // last round (a conflict copy, two deletes held), the members open (this Mac, an admin, a member, an open invite), a
  // new invite link made and the recovery key shown again
  // a member left: the workspace's key changes once the remaining members' Relay can receive it (PR key rotation)
  "settings-shared-rekey": async () => {
    await settingsPage("Machines", undefined, "shared-rekey");
    await page.setViewportSize({ width: 900, height: 1000 });
    await waitText("the key has not changed since");
    await page.getByText("the key has not changed since").scrollIntoViewIfNeeded();
    await settle(page);
  },
  // an admin trusts a member's new key, after a confirm (PR key rotation)
  "settings-shared-trust": async () => {
    await VIEWS["settings-shared-rekey"]();
    await button("Trust Studio Mac's new key…").click();
    await waitText("Only if Studio Mac told you");
    await page.getByText("Only if Studio Mac told you").scrollIntoViewIfNeeded();
    await settle(page);
  },
  // an admin turns making the notes documents on (ticket 8b, opt-in per workspace)
  "settings-shared-docs": async () => {
    await settingsPage("Machines", undefined, "shared");
    await page.setViewportSize({ width: 900, height: 1000 });
    await waitText("Notes as shared documents");
    await page.getByRole("switch").first().click();
    await page.getByText("Notes as shared documents").first().scrollIntoViewIfNeeded();
    await settle(page);
  },
  "settings-shared-vaults": async () => {
    await settingsPage("Machines", undefined, "shared");
    await page.setViewportSize({ width: 900, height: 1600 });
    await waitText("Put them back");
    await button("Members").click();
    await waitText("Design laptop");
    await button("Invite…").click();
    await button("Create link").click();
    await waitText("Single use, valid until");
    await button("Show recovery key").click();
    await waitText("Keep this key in your password manager");
    await intoView("Team server");
  },
  // New workspace on this machine… under Team server, filled in and created: the form closes, the new workspace's row
  // under the machine shows its recovery key
  "settings-shared-new": async () => {
    await settingsPage("Machines", undefined, "shared");
    await page.evaluate(() => (window.__harness.pickFolder = "/Users/me/Shared/Launch"));
    await button("New workspace on this machine…").click();
    await page.locator("#shared-name").fill("Launch");
    await page
      .locator("div.justify-between", { has: page.getByText("Folder", { exact: true }) })
      .getByTitle("Choose…")
      .click();
    await button("Create").click();
    await waitText("Keep this key in your password manager");
    await intoView("Keep this key in your password manager");
  },
  // a member's Settings › Machines: no machine, the workspace they joined with a link under Workspaces
  "settings-shared-member": async () => {
    await settingsPage("Machines", undefined, "shared-member");
    await waitText("Put them back");
    await intoView("Workspaces");
  },
  // fixture shared-keeper: that member, made admin on the server, opens Members: the server shows under Machines,
  // for workspaces only, with its workspace under it, an Update button and no Forget or New workspace
  "settings-shared-keeper": async () => {
    await settingsPage("Machines", undefined, "shared-keeper");
    await page.setViewportSize({ width: 900, height: 1300 });
    await waitText("Put them back");
    await button("Members").click();
    await waitText("You keep this server");
    await waitText("Update to");
    await intoView("You keep this server");
  },
  // Relay opened by an invite link: Machines with the join form under Workspaces, the link in it
  "settings-shared-join": async () => {
    await settingsPage("Machines", undefined, "shared-invite");
    await page.setViewportSize({ width: 900, height: 1000 });
    await waitText("Join a workspace");
    await intoView("Join a workspace");
  },
  // the other vault folders under General: a path, Remove, and the project shown under another name (the main vault
  // has one)
  "settings-other-vaults": async () => {
    await settingsPage("General", undefined, "shared");
    await intoView("Other workspace folders");
  },
  // the side vault's and the workspace's projects in the sidebar, in their own context (found by the search)
  "sidebar-shared": async () => {
    await open(page, server.url, { fixture: "shared" });
    // the side vault shown (Ctrl-2); a project shows once it has conversations, the search finds both of its own
    await page.keyboard.press("Control+Digit2");
    await page.getByPlaceholder("Search in Side vault").fill("h");
    await waitText("Team Handbook");
    await page.getByText("Hiring 2027", { exact: true }).scrollIntoViewIfNeeded();
  },
  // the footer's workspace menu: Personal, the side vault and the workspace Northwind, with the three actions (PR workspace-switcher)
  // the menu says which shared workspace's live channel is connected: Northwind "team · live"
  "workspace-menu-live": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.getByRole("button", { name: /^Switch workspace/ }).click();
    await waitText("team · live");
  },
  "workspace-menu": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.getByRole("button", { name: /^Switch workspace/ }).click();
    await waitText("Open a folder as workspace…");
  },
  // Northwind picked there: the footer, the search and a new general conversation follow it (PR workspace-switcher)
  "workspace-switched": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.getByRole("button", { name: /^Switch workspace/ }).click();
    await page.getByRole("menuitemradio", { name: /Northwind/ }).click();
    await page.evaluate(() => window.__harness.emit("menu", "new-general"));
    await settle(page);
  },
  // the sidebar's Chats tab, next to Pages, with the conversations of the workspace counted (PR workspace-pages)
  "chats-tab": async () => {
    await open(page, server.url);
    await page.getByRole("tab", { name: /^Chats/ }).waitFor();
  },
  // the Pages tab: Recent from the conversations' reads, the contexts with their projects, the folders (PR workspace-pages)
  // Files off (the app's default): the sidebar is Chats only, no tab row (experimental switch)
  "sidebar-files-off": async () => {
    await open(page, server.url, { fixture: "files-off" });
    await waitText("GENERAL");
    await settle(page);
  },
  // Files on: the Chats and Pages tabs under the search
  "sidebar-files-on": async () => {
    await open(page, server.url);
    await page.getByRole("tab", { name: /^Chats/ }).waitFor();
    await settle(page);
  },
  // Settings › General, the Experimental section at the bottom with the Files switch off
  "settings-experimental": async () => {
    await settingsPage("General", undefined, "files-off");
    await page.setViewportSize({ width: 900, height: 2400 });
    await page.getByText("Experimental", { exact: true }).scrollIntoViewIfNeeded();
    await settle(page);
  },
  "pages-tab": async () => {
    await open(page, server.url);
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await waitText("Folders");
    await settle(page);
  },
  // the Pages tab's right-click menu on a page: rename, move, duplicate, reveal, copy path, delete (ticket 5)
  "pages-context-menu": async () => {
    await VIEWS["pages-expanded"]();
    await page
      .locator('[data-page="Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md"]')
      .click({ button: "right" });
    await waitText("Move to…");
    await settle(page);
  },
  // the Pages tab's right-click menu on a project: move or copy it to another workspace, as on the Chats tab
  "pages-project-menu": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Beacon Billing"]').first().click({ button: "right" });
    await waitText("Move to workspace");
    await settle(page);
  },
  // and from there the same dialog as on the Chats tab
  "pages-project-migrate": async () => {
    await VIEWS["pages-project-menu"]();
    await page.getByRole("button", { name: "Side vault" }).first().click();
    await waitText("1 linked repo");
    await settle(page);
  },
  // New page from the Folders heading: the name field with Untitled selected
  "pages-new-page": async () => {
    await open(page, server.url);
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.getByText("Folders", { exact: true }).click({ button: "right" });
    await page.getByRole("button", { name: "New page" }).click();
    await waitText("Name");
    await settle(page);
  },
  // a rename that would change links says how many before it goes
  "pages-rename-confirm": async () => {
    await VIEWS["pages-expanded"]();
    await page
      .locator('[data-page="Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md"]')
      .click({ button: "right" });
    await page.getByRole("button", { name: "Rename…" }).click();
    await page.getByRole("dialog").locator("input").fill("Billing Rules");
    await waitText("Update 3 links in 2 notes");
    await settle(page);
  },
  // Delete in a shared workspace asks first and says it deletes for every member (review of #304)
  "pages-delete-confirm-shared": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.getByRole("button", { name: /^Switch workspace/ }).click();
    await page.getByRole("menuitemradio", { name: /Northwind/ }).click();
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-folder="Clients"]').click({ button: "right" });
    await page.getByRole("button", { name: "Delete" }).click();
    await waitText("deletes it for every member");
    await settle(page);
  },
  // a page put in the trash: gone from the tree, Undo in the bar
  "pages-trash-undo": async () => {
    await VIEWS["pages-expanded"]();
    await page
      .locator('[data-page="Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md"]')
      .click({ button: "right" });
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await waitText("Billing Spec is in the trash");
    await settle(page);
  },
  // a project unfolded to its folder, its note open in the drawer, and a top folder unfolded (PR workspace-pages)
  "pages-expanded": async () => {
    await open(page, server.url);
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Beacon Billing"]').click();
    await page.locator('[data-folder="Contexts/Agency/Projects/Beacon Billing/Documents"]').click();
    await page.locator('[data-folder="Resources"]').click();
    await waitText("Billing Spec");
    await settle(page);
  },
  // the side vault's Pages: its notes, opened by their absolute path (PR workspace-pages)
  "pages-shared": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.keyboard.press("Control+Digit2");
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-folder="Contexts"]').click();
    await page.locator('[data-folder="Contexts/Team"]').click();
    await page.locator('[data-folder="Contexts/Team/Projects"]').click();
    await page.locator('[data-page="Contexts/Team/Projects/Team Handbook.md"]').click();
    await settle(page);
  },
  // a shared document's page with two other members on it: their cursors with their names, their avatars in the bar,
  // a line one of them typed, and a line typed here (ticket 9)
  "page-co-editing": async (fixture = "shared-live") => {
    await open(page, server.url, { fixture });
    await page.keyboard.press("Control+Digit2");
    await page.getByRole("tab", { name: /^Pages/ }).click();
    for (const folder of ["Contexts", "Contexts/Team", "Contexts/Team/Projects"])
      await page.locator(`[data-folder="${folder}"]`).click();
    await page.locator('[data-page="Contexts/Team/Projects/Team Handbook.md"]').click();
    await waitText("Stand van zaken");
    await page.waitForFunction(() => window.__harness.liveText().length > 0, null, { timeout: 4000 });
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("Typed on this Mac.");
    await page.evaluate(() => {
      window.__harness.peerType("- [ ] Second open loop", "\n- [ ] A third loop, typed by Laurent");
      window.__harness.peerCursor("a1b2c3d4e5f6a7b8", "Laurent Meersman", "typed by Laurent");
      window.__harness.peerCursor("f0e1d2c3b4a59687", "Jeppe", "It links to", 11);
    });
    await waitText("Laurent Meersman");
    await settle(page);
  },
  "page-co-editing-dark": async () => VIEWS["page-co-editing"]("shared-live-dark"),
  // a project's note as a page in the middle column: properties, its conversations, the body (PR page-view)
  "page-view": async () => {
    await open(page, server.url);
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText("Ask Claude");
    await waitText("Stand van zaken");
    await settle(page);
  },
  "page-view-dark": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText("Stand van zaken");
    await settle(page);
  },
  // a page's history beside it (ticket 10): three sessions, who and when, what made them, lines added and removed
  "page-history": async () => {
    await VIEWS["page-view"]();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await waitText("Ben Lauwers");
    await settle(page);
  },
  // a page's comments beside it (ticket 11): an open thread with a reply, its text marked in the page
  "page-comments": async () => {
    await VIEWS["page-view"]();
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await waitText("Is this still the first thing to do?");
    await page.getByText("“First open loop”").click();
    await settle(page);
  },
  // ticket 12, in dark: a comment on a team workspace's page, @ listing the members whose name starts with what is typed
  "comment-mention": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page.evaluate(() => window.__harness.teamComments());
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText("Stand van zaken");
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await waitText("Is this still the first thing to do?");
    await page.locator(".cm-content").getByText("Second open loop").dblclick();
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.getByPlaceholder("Add a comment… @ names a member").pressSequentially("Can you check this, @");
    await waitText("@Ben Lauwers");
    await settle(page);
  },
  // ticket 12: the team workspace's Inbox in its menu, a thread that mentions you on top
  "workspace-inbox": async () => {
    await open(page, server.url, { fixture: "shared" });
    await page.evaluate(() => window.__harness.teamComments());
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').first().click();
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await waitText("Is this still the first thing to do?");
    await page.keyboard.press("Control+Digit3");
    await page.getByRole("button", { name: /^Switch workspace/ }).click();
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await waitText("Ana Vos");
    await settle(page);
  },
  // in dark, the resolved threads unfolded under the open ones
  "page-comments-resolved": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText("Stand van zaken");
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await page.getByRole("button", { name: "Resolved (1)" }).click();
    await waitText("Which repo is the old one?");
    await settle(page);
  },
  // the oldest version picked: what changed since, green and red, with Restore
  "page-history-diff": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText("Stand van zaken");
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: /^Ana Vos.*disk/ }).click();
    await waitText("Restore this version");
    await settle(page);
  },
  // the page as an editor (ticket 2): a to-do ticked, a line typed at the end, saved a second later; the cursor's line
  // shows its markdown, the others the live preview
  "page-editor": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-task").first().click();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\n- [ ] Third loop, typed in the page [[Billing Spec]]");
    await page.waitForFunction(() => /Third loop/.test(window.__harness.written() ?? ""), null, { timeout: 4000 });
    await settle(page);
  },
  "page-editor-dark": async () => {
    await VIEWS["page-view-dark"]();
    await settle(page);
  },
  // the page's properties as editable rows (ticket 4), in dark: text, a [[link]], a date, a list, a checkbox
  "page-properties": async () => {
    await VIEWS["page-view-dark"]();
    await page.getByLabel("status", { exact: true }).hover();
    await settle(page);
  },
  // status changed from the header: only that line of the file changes, saved with the body's text
  "page-properties-edit": async () => {
    await VIEWS["page-view"]();
    const status = page.getByLabel("status", { exact: true });
    await status.fill("Blocked");
    await status.press("Enter");
    await page.waitForFunction(() => /\nstatus: Blocked\n/.test(window.__harness.written() ?? ""), null, {
      timeout: 4000,
    });
    await page.getByRole("button", { name: "Remove: archive" }).click();
    await page.waitForFunction(() => !/archive:/.test(window.__harness.written() ?? "archive:"), null, {
      timeout: 4000,
    });
    await settle(page);
  },
  // a property added: a link to a note, written as key: "[[Note]]"
  "page-properties-add": async () => {
    await VIEWS["page-view"]();
    await page.getByRole("button", { name: "Add property" }).click();
    await page.getByRole("textbox", { name: "Property name" }).fill("reviewer");
    await page.getByRole("combobox", { name: "Type" }).selectOption("link");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const reviewer = page.getByLabel("reviewer", { exact: true });
    await reviewer.fill("Billing Spec");
    await reviewer.press("Enter");
    await page.waitForFunction(() => /reviewer: "\[\[Billing Spec\]\]"/.test(window.__harness.written() ?? ""), null, {
      timeout: 4000,
    });
    await page.getByRole("button", { name: "Add property" }).click();
    await settle(page);
  },
  // the file changed on disk since the page read it: the save is refused, the bar offers Reload and Keep mine
  "page-editor-changed-on-disk": async () => {
    await VIEWS["page-view"]();
    await page.evaluate(() => window.__harness.changeOnDisk());
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\nMy line");
    await waitText("Keep mine", 4000);
    await settle(page);
  },
  // typing at the end of a page while Claude changes a line above: both land, Claude's line marked for a moment (ticket 6)
  "page-merged-outside": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\nMy line");
    await page.evaluate(() =>
      window.__harness.editOutside("- [ ] Second open loop", "- [ ] Second open loop, moved to Friday"),
    );
    await page.locator(".cm-outside").first().waitFor();
    await settle(page);
  },
  // both sides changed the same line: the bar, nothing merged (ticket 6)
  "page-merge-conflict": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-line", { hasText: "Second open loop" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await page.evaluate(() =>
      window.__harness.editOutside("- [ ] Second open loop", "- [ ] Second open loop, moved to Friday"),
    );
    await waitText("Keep mine", 4000);
    await settle(page);
  },
  // the / menu on a new line of a page, filtered by "/to" (ticket 3)
  "editor-slash-menu": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\n/");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    await settle(page);
  },
  "editor-slash-menu-dark": async () => {
    await VIEWS["page-view-dark"]();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\n/to");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    await settle(page);
  },
  // [[ completes the workspace's notes
  "editor-wikilink-complete": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\nSee [[Nor");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    await settle(page);
  },
  // a table from the / menu, filled with Tab; Tab in the last cell adds a row
  "editor-table": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\n\n/table");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    // CodeMirror takes Enter as a pick only 75 ms after the list opened, by Date.now, which the harness pins: move it on
    await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000));
    await page.keyboard.press("Enter");
    for (const cell of ["Kristof", "Build", "Laurent", "Review"]) {
      await page.keyboard.type(cell);
      await page.keyboard.press("Tab");
    }
    await page.keyboard.type("Jeppe");
    await settle(page);
  },
  // a block's handle clicked: Turn into, Duplicate, Delete
  "editor-block-handle": async () => {
    await VIEWS["page-view"]();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\n\n## Next steps\nCall the client on Thursday");
    const line = await page.locator(".cm-line", { hasText: "Next steps" }).boundingBox();
    await page.mouse.click(line.x + line.width - 4, line.y - 40); // the cursor off the heading: it shows formatted
    await page.mouse.move(line.x + 20, line.y + line.height / 2);
    await page.locator(".cm-block-handle").click();
    await page.locator(".cm-block-menu").waitFor();
    await settle(page);
  },
  // Ask Claude on the side vault's page: a new conversation in that workspace with the note's path typed in
  "page-ask": async () => {
    await VIEWS["pages-shared"]();
    await waitText("Stand van zaken");
    await page.getByRole("button", { name: "Ask Claude" }).click();
    await waitText("New conversation about Team Handbook");
    await settle(page);
  },
  "settings-interface": async () => {
    await settingsPage("General");
    await intoView("Accent");
  },
  "settings-time": async () => {
    await settingsPage("General");
    await intoView("Propose the day's time from conversations");
  },
  // Settings › General › Permissions: the mock has Full Disk Access missing (PR permissions-check)
  "settings-permissions": async () => {
    await settingsPage("General");
    await scrollMain("bottom");
    await settle(page);
  },
  "settings-sidebar": async () => {
    await settingsPage("General");
    await scrollMain("bottom");
    await settle(page);
  },
  ...Object.fromEntries(
    ["Productive", "GitHub", "Mail"].map(name => [
      `settings-integration-${name.toLowerCase()}`,
      () => settingsPage("Integrations", name),
    ]),
  ),
  "settings-integration-mail-experimental": () => settingsPage("Integrations", "Mail", "mailexp"),
  "settings-integration-calendar": () => settingsPage("Integrations", "Calendar", "calendar"),
  // Commonwealth's page with a team brain to join, then after Join: the report of `commonwealth join` (PR team-brain-join)
  "settings-integration-commonwealth": () => settingsPage("Integrations", "Commonwealth", "brain"),
  "settings-commonwealth-joined": async () => {
    await settingsPage("Integrations", "Commonwealth", "brain");
    await page.fill("#cwremote", "git@github.com:northwind/brain.git");
    await click("Join");
    await settle(page);
  },
  // Claude Code's row folded open: no extra accounts yet, then two with the work one active
  "settings-agent-claude": async () => {
    await settingsPage("Agents");
    await unfold("Claude Code");
    await intoView("Add account…");
  },
  "settings-agent-accounts": async () => {
    await settingsPage("Agents", undefined, "accounts");
    await unfold("Claude Code");
    await intoView("Switch accounts automatically");
  },
  // the board pipeline of a project with a linked board, folded open in Settings › Projects
  "settings-pipeline": async () => {
    await settingsPage("Projects");
    await unfold("Northwind Portal");
    await intoView("Agents at once");
  },
  // the same, its top: the per-project switch, the checkout and the branch
  "settings-pipeline-top": async () => {
    await settingsPage("Projects");
    await unfold("Northwind Portal");
    await intoView("Board pipeline");
  },
  // the same: the skill the agent follows per ticket, above plan first
  "settings-pipeline-skill": async () => {
    await settingsPage("Projects");
    await unfold("Northwind Portal");
    await intoView("Plan first");
  },
  // the same with a skill filled in: Plan first is gone, the skill decides that per ticket
  "settings-pipeline-skill-set": async () => {
    await settingsPage("Projects");
    await unfold("Northwind Portal");
    await intoView("Skill");
    const field = page.getByPlaceholder("ticket-flow:develop");
    await field.fill("ticket-flow:develop");
    await field.press("Enter");
    await intoView("Checks");
  },
  // the same: the validation before a PR (checks, review, rounds)
  "settings-pipeline-validation": async () => {
    await settingsPage("Projects");
    await unfold("Northwind Portal");
    await intoView("Rounds");
  },
  // Settings › Plugins with the example plugin (its view found, one tool allowed), and its own page: how the server starts,
  // the secrets (one stored in the keychain) and the tools
  "settings-plugins-list": () => settingsPage("Plugins", undefined, "plugins"),
  "settings-plugin": async () => {
    await settingsPage("Plugins", "Dice", "plugins");
  },
  // the same, scrolled to the tools: the allowed one is listed by name until a test lists them all
  "settings-plugin-tools": async () => {
    await settingsPage("Plugins", "Dice", "plugins");
    await intoView("Switch on the tools");
  },
  // the example plugin's view in the middle column: the frame is up (ui/initialize done) and a roll went through the
  // bridge to the server's tool
  "plugin-view": async () => {
    await open(page, server.url, { fixture: "plugins", sel: "__plugin:example" });
    const view = page.frameLocator("iframe[title=Dice]");
    await view.getByText(/^Ready/).waitFor();
    await view.getByRole("button", { name: "Roll" }).click();
    await view.getByText("Rolled 4 on a d6").waitFor();
    await settle(page);
  },
  "plugin-view-dark": async () => {
    await open(page, server.url, { fixture: "plugins-dark", sel: "__plugin:example" });
    const view = page.frameLocator("iframe[title=Dice]");
    await view.getByText(/^Ready/).waitFor();
    await view.getByRole("button", { name: "Roll" }).click();
    await view.getByText("Rolled 4 on a d6").waitFor();
    await settle(page);
  },
  // a plugin with two views shows a tab per view; picking the second one loads that view in the frame (#189)
  "plugin-view-tabs": async () => {
    await open(page, server.url, { fixture: "plugins", sel: "__plugin:example" });
    await page.getByRole("radio", { name: "History" }).click();
    await page
      .frameLocator("iframe[title=History]")
      .getByText(/^Ready/)
      .waitFor();
    await settle(page);
  },
  // Settings › General › Reminders' agent access: add, done and push default to Runs (#PR)
  "settings-reminders-access": async () => {
    await settingsPage("General");
    await intoView("reminders.push");
  },
  // the vault's git backup under General, after a round that pushed
  "settings-vault-sync": async () => {
    await settingsPage("General");
    await intoView("Last sync");
  },
  // the same after a round the remote refused
  "settings-vault-sync-failed": async () => {
    await settingsPage("General");
    await page.evaluate(() =>
      window.__harness.emit("vault-sync", {
        at: Math.floor(Date.now() / 1000) - 60,
        ok: false,
        error: "the remote is public, a vault only syncs to a private repository",
        commit: null,
      }),
    );
    await intoView("Last sync");
  },
  "settings-agent-access": async () => {
    await settingsPage("Integrations", "Productive");
    await intoView("Agent access");
  },
  onboarding: async () => {
    await open(page, server.url, { fixture: "onboarding" });
  },
  "onboarding-own": async () => {
    await open(page, server.url, { fixture: "onboarding" });
    await button("I have a vault").click();
  },
  // Start offers the setup interview (Set up with Claude) or Skip
  "onboarding-setup": async () => {
    await open(page, server.url, { fixture: "onboarding" });
    await button("Start").click();
    await waitText("Set up with Claude");
  },
  // Set up with Claude: the starter vault is saved and a general conversation runs the setup skill
  "onboarding-setup-started": async () => {
    await open(page, server.url, { fixture: "onboarding" });
    await button("Start").click();
    await button("Set up with Claude").click();
    await waitText("Run the setup skill.");
  },
  "dark-waiting": async () => {
    await open(page, server.url, { fixture: "dark" });
    await waitText(titles.permission);
  },
  "dark-conversation": async () => {
    await open(page, server.url, { fixture: "dark", sel: keys.long });
    await waitText(markers.longEnd);
  },
  "graphite-waiting": async () => {
    await open(page, server.url, { fixture: "graphite" });
    await waitText(titles.permission);
  },
  "sidebar-icons": async () => {
    await open(page, server.url, { fixture: "icons" });
    await waitText(titles.permission);
  },
  "dark-board": async () => {
    await open(page, server.url, { fixture: "dark" });
    await click("Productive");
    await waitText(markers.card);
  },
  // a meeting being recorded: the bar in Waiting for you, the row above the sidebar's footer (#103)
  "recording-meeting": async () => {
    await open(page, server.url, { fixture: "calendar" });
    await waitText("Daily standup");
    await page.locator("section", { hasText: "Daily standup" }).last().getByRole("button", { name: "Record" }).click();
    await page.evaluate(() => window.__harness.recordingTick(754, 0.35, 0.25));
    await waitText("12:34");
  },
  // dictation started in a conversation, then on to Reminders: the sidebar's row links back to it (#103)
  "recording-dictation": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.getByRole("button", { name: /^Dictate/ }).click();
    await page.evaluate(() => window.__harness.dictationLevel(0.4));
    await click("Reminders");
    await waitText("Dictating ·");
  },
  // a folder under a project, made from the project's menu, with a general conversation dragged into it (#254)
  "sidebar-folder": async () => {
    await open(page, server.url);
    const nav = page.locator(".relay-sidebar");
    await nav.locator('[data-kind="proj"]').first().click({ button: "right" });
    await click("New folder");
    await page.getByRole("textbox", { name: "Folder name" }).fill("Quotes");
    await page.keyboard.press("Enter");
    const from = await nav.locator('[data-kind="conv"][data-project=""]').nth(1).boundingBox();
    const to = await nav.locator('[data-kind="folder"]').boundingBox();
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    await settle(page);
  },
  // Today after 16:00 with activity in the day's conversations: the "Book today's time" item (Time from sessions)
  "today-time": async () => {
    await page.clock.setFixedTime(Date.parse("2026-10-01T14:30:00Z"));
    await open(page, server.url);
    await waitText("Book today's time");
    await click("Book today's time");
  },
  // switched off in Settings › General: the item goes, and the transcripts are not read for it
  "today-time-off": async () => {
    await page.clock.setFixedTime(Date.parse("2026-10-01T14:30:00Z"));
    await open(page, server.url);
    await waitText("Book today's time");
    await page.evaluate(() => window.__harness.changeSettings({ timeFromSessions: false }));
    await page.waitForFunction(() => !document.body.innerText.includes("Book today's time"));
  },
  // Claude compacting the conversation (the quiet "42% context" under the field, a pulsing line in the conversation),
  // then the line once it is done: the history stays, the context shrinks (#115)
  "conversation-compacting": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => {
      window.__harness.emitAgent(key, { type: "context", used: 168_000 });
      window.__harness.emitAgent(key, { type: "working" });
      window.__harness.emitAgent(key, { type: "compacting" });
    }, keys.switchTo);
    await waitText("Compacting conversation");
    await scrollMain("bottom");
  },
  "conversation-compacted": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => {
      window.__harness.emitAgent(key, { type: "context", used: 168_000 });
      window.__harness.emitAgent(key, { type: "working" });
      window.__harness.emitAgent(key, { type: "compacting" });
      window.__harness.emitAgent(key, { type: "compacted", trigger: "auto", pre_tokens: 168_000, post_tokens: 9_000 });
    }, keys.switchTo);
    await waitText("Conversation compacted automatically");
    await scrollMain("bottom");
  },
  // a turn with a to-do list (TodoWrite): the checklist above the composer, the timeline line counting the done ones
  "conversation-todos": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => {
      const h = window.__harness;
      const todos = [
        { content: "Read the invoice export", status: "completed", activeForm: "Reading the invoice export" },
        { content: "Group the open invoices by client", status: "completed", activeForm: "Grouping the open invoices" },
        { content: "Draft the reminder mails", status: "in_progress", activeForm: "Drafting the reminder mails" },
        { content: "Check the VAT codes", status: "pending", activeForm: "Checking the VAT codes" },
        { content: "Send the summary to Pieter", status: "pending", activeForm: "Sending the summary" },
      ];
      h.emitAgent(key, { type: "working" });
      h.emitAgent(key, { type: "tool_call", id: "toolu_todo", name: "TodoWrite", input: { todos } });
      h.emitAgent(key, { type: "tool_result", id: "toolu_todo", error: false });
    }, keys.switchTo);
    await waitText("Drafting the reminder mails");
    await scrollMain("bottom");
  },
  // the Brain view with Commonwealth on: the team brain's tab, a note found by search (#158)
  "brain-note": async () => {
    await open(page, server.url, { fixture: "brain", sel: "__brain" });
    await page.getByRole("radio", { name: "team-brain" }).click();
    await page.getByPlaceholder("Search team-brain").fill("cache note 25");
    await waitText("cache note 25 in northwind-portal");
    await page.getByText("cache note 25 in northwind-portal").first().click();
    await settle(page, 400);
  },
  // the team brain as a graph, coloured by kind, index notes hidden (#158)
  "brain-graph": async () => {
    await open(page, server.url, { fixture: "brain", sel: "__brain" });
    await page.getByRole("radio", { name: "team-brain" }).click();
    await page.getByRole("radio", { name: "Graph" }).click();
    await page.waitForTimeout(5000); // the layout settles
  },
  // conversation glow: the notes conversations read and wrote, lit (#158)
  "brain-glow": async () => {
    await open(page, server.url, { fixture: "brain", sel: "__brain" });
    await page.getByRole("radio", { name: "team-brain" }).click();
    await page.getByRole("radio", { name: "Graph" }).click();
    await page.getByRole("button", { name: "Conversation glow" }).click();
    await page.waitForTimeout(5000);
  },
  // Browse's Touched filter: the notes conversations touched, newest first, with the open note's conversation (#158)
  "brain-touched": async () => {
    await open(page, server.url, { fixture: "brain", sel: "__brain" });
    await page.getByRole("radio", { name: "team-brain" }).click();
    await page.getByRole("button", { name: "Touched" }).click();
    await page.getByText("cache note 25 in northwind-portal").first().click();
    await settle(page, 400);
  },
  // the vault alone, without Commonwealth: no tabs (#158)
  "brain-vault": async () => {
    await open(page, server.url, { sel: "__brain" });
    await page.getByRole("button", { name: /^Contexts/ }).click();
    await page.getByRole("button", { name: /^Agency/ }).click();
    await settle(page, 300);
  },
  // a conversation's Brain button opens the graph with only its notes lit (#158)
  "brain-show-conversation": async () => {
    await open(page, server.url, { fixture: "brain", sel: keys.long });
    await waitText(markers.longEnd);
    await page.getByRole("button", { name: "Show in Brain" }).click();
    await page.waitForTimeout(4000);
  },
  "dark-mail": async () => {
    await open(page, server.url, { fixture: "dark" });
    await click("Mail");
    await click(markers.htmlMail);
    await settle(page, 400);
  },
};

const failed = [];
const unmockedAll = new Set();
for (const [name, go] of Object.entries(VIEWS)) {
  if (only?.length && !only.includes(name)) continue;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await go();
    await settle(page);
    await page.screenshot({ path: `${dir}/${name}.png`, animations: "disabled", caret: "hide" });
    for (const c of await page.evaluate(() => [...window.__harness.unmocked])) unmockedAll.add(c);
    console.log(`ok    ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
  }
}
const unmocked = [...unmockedAll];
if (unmocked.length) console.log(`unmocked commands: ${unmocked.join(", ")}`);
console.log(
  `${Object.keys(VIEWS).length - failed.length} views in ${dir}${failed.length ? `, failed: ${failed.join(", ")}` : ""}`,
);
await browser.close();
await server.close();
process.exit(failed.length ? 1 : 0);
