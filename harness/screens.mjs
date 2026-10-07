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
const { keys, titles, markers } = await page.evaluate(() => ({ keys: window.__harness.keys, titles: window.__harness.titles, markers: window.__harness.markers }));

const waitText = (text, timeout = 10000) =>
  page.waitForFunction(t => window.__dom.hasText(t), text, { timeout }).catch(() => {
    throw new Error(`text not shown: "${text}"`);
  });
const scrollMain = to => page.evaluate(to => {
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
  await page.getByRole("button", { name: new RegExp(`^${name}\\b`), expanded: false }).locator("visible=true").first().click();
  await settle(page);
};
const settingsPage = async (tab, sub, fixture = "default") => {
  await page.setViewportSize({ width: 900, height: 700 });
  await open(page, server.url, { path: "/settings.html", fixture });
  await click(tab);
  if (sub) await click(sub);
};

const VIEWS = {
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
      h.emitAgent(key, { type: "thinking", text: "I should read the ledger first, then group by client.", delta: true });
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
  // a picture and two files waiting by their path, the drop highlight off (drag-leave)
  "composer-files": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(() => window.__harness.dropPaths(["/Users/demo/Pictures/site photo.png", "/Users/demo/Downloads/Q3 report.pdf", "/Users/demo/Downloads/Budget 2027.xlsx"]));
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
  // a sent message with its files as chips
  "conversation-files": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.evaluate(() => {
      window.__harness.autoReply = false;
      return window.__harness.dropPaths(["/Users/demo/Downloads/Q3 report.pdf", "/Users/demo/Downloads/Budget 2027.xlsx"]);
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
    await page.waitForFunction(() => window.__dom.all("select").some(s => s.selectedOptions[0]?.textContent.includes("Opus (default)")), null, { timeout: 5000 });
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
  "pr-detail": async () => {
    await VIEWS["prs-list"]();
    await click("Fix the SSO redirect loop on the portal");
    await waitText("src/auth/callback.ts");
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
  "board-list": async () => {
    await VIEWS.board();
    await button("List").click();
    await settle(page);
  },
  ...Object.fromEntries([["filters", "Filters"], ["presets", "Presets"], ["group", "Task lists"]].map(([name, label]) => [`board-${name}`, async () => {
    await VIEWS.board();
    await button(label).click();
    await settle(page);
  }])),
  "ticket-activity": async () => {
    await VIEWS["card-detail"]();
    await page.getByPlaceholder(/^(Leave a comment|Comment…)/).first().scrollIntoViewIfNeeded();
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
    await page.getByRole("button", { name: /^(Usage|Claude Code)/ }).first().click();
    await waitText("All of Claude Code", 10000);
    await settle(page);
  },
  // the usage redesign: Claude Code's Details folded open, per model and per conversation (#105)
  "usage-details": async () => {
    await VIEWS.usage();
    await page.getByRole("button", { name: /^Details/ }).first().click();
    await waitText("By model");
    await settle(page);
  },
  // the usage redesign in dark mode (#105)
  "dark-usage": async () => {
    await open(page, server.url, { fixture: "dark" });
    await page.getByRole("button", { name: /^(Usage|Claude Code)/ }).first().click();
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
    await page.getByRole("navigation").first().getByText("Northwind Portal", { exact: true }).first().click({ button: "right" });
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
    await page.getByRole("textbox").last().fill("Ask Mara about the VAT column\n- export: viewers see no button\n- check the staging seed");
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
  "orchestrator-live": async () => {
    await VIEWS.orchestrator();
    await page.evaluate(() => window.__harness.orchLive());
    await waitText("Draft the depot import ticket");
    await settle(page, 300);
  },
  "orchestrator-worker": async () => {
    await open(page, server.url, { fixture: "orch", sel: keys.orchWorker });
    await waitText("From Relay");
  },
  ...Object.fromEntries(["General", "Projects", "Agents", "Integrations", "Voice"].map(tab => [`settings-${tab.toLowerCase()}`, () => settingsPage(tab)])),
  // the speech models, Whisper among them
  "settings-voice-models": async () => {
    await settingsPage("Voice");
    await intoView("Whisper Large v3 Turbo");
  },
  "settings-interface": async () => {
    await settingsPage("General");
    await intoView("Accent");
  },
  "settings-sidebar": async () => {
    await settingsPage("General");
    await scrollMain("bottom");
    await settle(page);
  },
  ...Object.fromEntries(["Productive", "GitHub", "Mail"].map(name => [`settings-integration-${name.toLowerCase()}`, () => settingsPage("Integrations", name)])),
  "settings-integration-mail-experimental": () => settingsPage("Integrations", "Mail", "mailexp"),
  "settings-integration-calendar": () => settingsPage("Integrations", "Calendar", "calendar"),
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
  "settings-agent-access": async () => {
    await settingsPage("Integrations", "Productive");
    await intoView("Agent access");
  },
  onboarding: async () => {
    await open(page, server.url, { fixture: "onboarding" });
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
console.log(`${Object.keys(VIEWS).length - failed.length} views in ${dir}${failed.length ? `, failed: ${failed.join(", ")}` : ""}`);
await browser.close();
await server.close();
process.exit(failed.length ? 1 : 0);
