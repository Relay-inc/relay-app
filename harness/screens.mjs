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

const VIEWS = {
  waiting: async () => {
    await open(page, server.url);
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
  "conversation-permission": async () => {
    await open(page, server.url, { sel: keys.permission });
    await waitText("git push origin fix/portal-redirect");
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
  "mail-html": async () => {
    await VIEWS["mail-list"]();
    await click(markers.htmlMail);
    await page.waitForFunction(() => window.__dom.all("iframe").some(f => f.srcdoc.includes("Balance report")));
    await settle(page, 400);
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
  usage: async () => {
    await open(page, server.url);
    await page.getByRole("button", { name: /^(Usage|Claude Code)/ }).first().click();
    await waitText("claude-opus-5-5", 10000).catch(() => waitText("Plan limits"));
    await settle(page);
  },
  "cmd-k": async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await page.keyboard.press("Meta+k");
    await settle(page);
  },
  ...Object.fromEntries(["Open", "Status", "Reminders", "PRs"].map(tab => [`panel-${tab.toLowerCase()}`, async () => {
    await open(page, server.url, { sel: keys.switchTo });
    await waitText(markers.switchEnd);
    await page.getByRole("button", { name: tab, exact: true }).last().click(); // the right panel comes after the sidebar
    await settle(page);
  }])),
  ...Object.fromEntries(["General", "Projects", "Agents", "Integrations"].map(tab => [`settings-${tab.toLowerCase()}`, async () => {
    await page.setViewportSize({ width: 900, height: 700 });
    await open(page, server.url, { path: "/settings.html" });
    await click(tab);
  }])),
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
