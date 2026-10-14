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
  // a card whose request carries Claude's permission_suggestions: Deny, Always allow, Allow
  "conversation-permission": async () => {
    await open(page, server.url, { sel: keys.permission });
    await waitText("push origin fix/portal-redirect");
  },
  "conversation-action": async () => {
    await open(page, server.url, { sel: keys.action });
    await waitText("relay productive.create_task", 10000).catch(() => waitText("Depot import script"));
  },
  // the conversation's changes from git in the drawer: the file list, then a file's diff in a window over the app with a
  // comment on a line, then the comments sent to the composer (which closes the window)
  "changes-list": async () => {
    await open(page, server.url, { sel: keys.long });
    await waitText(markers.longEnd);
    await button("Changes").click();
    await waitText("DossierSync.php");
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
  "changes-diff": async () => {
    await VIEWS["changes-list"]();
    await click("DossierSync.php");
    await click("return; // a retried job: the balance is already there");
    await page.keyboard.type("Is a retried job the only way this happens? Check the queue's retry policy too.");
    await button("Add comment").click();
    await click("$this->repository->addBalance($dossier, $balance);");
    await settle(page);
  },
  "changes-sent": async () => {
    await VIEWS["changes-diff"]();
    await page.keyboard.press("Escape");
    // the window's own button: the drawer's is under the backdrop
    await page.locator(".ticket-window").getByRole("button", { name: "Send 1 comment to the composer" }).click();
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
  "composer-resolved": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(key => window.__harness.resolved(key), keys.switchTo);
    // the label is the picker's selected option (a native select)
    await page.waitForFunction(
      () => window.__dom.all("select").some(s => s.selectedOptions[0]?.textContent.includes("Opus (default)")),
      null,
      { timeout: 5000 },
    );
  },
  "conversation-question": async () => {
    await open(page, server.url, { sel: keys.question });
    await waitText("Which sync strategy should the contact import use?");
  },
  "new-general-draft": async () => {
    await open(page, server.url);
    await page.evaluate(() => window.__harness.emit("menu", "new-general")); // the app menu's Cmd-T
    await settle(page);
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
  // the ticket window of a board with a hand-picked pipeline: Build with agent under Start conversation
  "ticket-build": async () => {
    await open(page, server.url, { fixture: "pipeline-manual" });
    await click("Productive");
    await waitText(markers.card);
    await click(markers.card);
    await waitText("Build with agent");
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
  usage: async () => {
    await open(page, server.url);
    await page
      .getByRole("button", { name: /^(Usage|Claude Code)/ })
      .first()
      .click();
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
  // the usage redesign in dark mode (#105)
  "dark-usage": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page
      .getByRole("button", { name: /^(Usage|Claude Code)/ })
      .first()
      .click();
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
    await waitText("Give it a task across projects");
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
    ["General", "Projects", "Agents", "Integrations", "Plugins", "Voice", "Updates"].map(tab => [
      `settings-${tab.toLowerCase()}`,
      () => settingsPage(tab),
    ]),
  ),
  // the speech models, Whisper among them
  "settings-voice-models": async () => {
    await settingsPage("Voice");
    await intoView("Whisper Large v3 Turbo");
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
