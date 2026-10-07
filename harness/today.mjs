// Screenshots of Today against the mock backend, driven the way a user does it: node harness/today.mjs [--browser webkit]
// PNGs go to harness/screens/today/<step>.png.
import { mkdirSync } from "node:fs";
import { HERE, arg, startServer, launch, newPage, open, settle, byText, PAGE_HELPERS } from "./lib.mjs";

const browserName = arg("browser", "webkit");
const dir = `${HERE}screens/today`;
mkdirSync(dir, { recursive: true });
const server = await startServer();
const browser = await launch(browserName);
const page = await newPage(browser);
await page.addInitScript(PAGE_HELPERS);
const shot = async name => {
  await settle(page, 400);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`  ${name}`);
};
// a row, also when it sits in a closed bundle of mails or PRs (the bundles open one by one until it shows)
const rowOf = async text => {
  const row = byText(page, text, false);
  if (!(await row.isVisible().catch(() => false)))
    for (const bundle of await page.locator("button", { hasText: /mails to answer|pull requests/ }).all()) {
      await bundle.click();
      await settle(page, 150);
      if (await row.isVisible().catch(() => false)) break;
    }
  await row.click();
  await settle(page, 300);
};
// the project filter in the header: "" all, a context, or "-" for no project
const context = async value => {
  await page.locator('select[aria-label="All projects"]').selectOption(value);
  await settle(page, 300);
};
try {
  await open(page, server.url, { fixture: "calendar", sel: "__wait" });
  await shot("01-overview");
  await context("Agency");
  await shot("01b-context");
  await context("-");
  await shot("01c-no-project");
  await context("");
  await rowOf("Acceptance checklist portal v2");
  await shot("02-mail");
  await shot("02b-mail-bottom");
  await page.keyboard.press("r");
  await page.waitForTimeout(800);
  await shot("03-mail-compose");
  await page.locator("textarea").first().evaluate(el => el.blur());
  await rowOf("Fix the SSO redirect loop on the portal");
  await shot("04-pr");
  await page.waitForTimeout(500);
  await shot("04b-pr-ticket");
  await page.getByRole("button", { name: /#301 SSO redirect loop/ }).locator("visible=true").first().click();
  await shot("04c-ticket-window");
  await page.keyboard.press("Escape");
  await settle(page, 300);
  // the … menu: find the ticket again (a toast says what came out)
  await page.getByRole("button", { name: "More actions" }).locator("visible=true").first().click();
  await shot("04d-more-menu");
  await page.getByRole("button", { name: /Find the ticket again/ }).locator("visible=true").first().click();
  await page.waitForTimeout(400);
  await shot("04e-found-again");
  // no ticket: not this one, then choose one by hand
  await page.getByRole("button", { name: "Not this ticket" }).locator("visible=true").first().click();
  await shot("04f-no-ticket");
  await page.getByRole("button", { name: "Choose a ticket" }).locator("visible=true").first().click();
  await page.keyboard.type("two");
  await shot("04g-picker");
  await page.locator("div.shadow-sm button", { hasText: "Two-factor setup" }).first().click();
  await shot("04h-picked");
  // a PR whose project has no board: the fix is one click away
  await rowOf("Replace balance instead of adding it");
  await shot("04i-no-board");
  await page.getByRole("button", { name: "Link a board" }).locator("visible=true").first().click();
  await page.waitForTimeout(600);
  await shot("04j-board-linker");
  await page.locator("div.shadow-sm button", { hasText: "Link" }).first().click();
  await page.waitForTimeout(800);
  await shot("04k-board-linked");
  await page.getByRole("button", { name: /^Review with Claude/ }).locator("visible=true").first().click();
  await page.waitForTimeout(1200);
  await shot("05-review");
  await byText(page, "const back = params.get('returnTo') ?? '/';", false).click();
  await shot("06-review-line");
  // the long file: the diff scrolls down and sideways
  await page.locator("button[title=\"src/long.ts\"]").first().click();
  await settle(page, 300);
  const box = await page.locator("div.overflow-x-auto.font-mono").first().boundingBox();
  await page.mouse.move(box.x + 200, box.y + 150);
  await page.mouse.wheel(0, 900);
  await settle(page, 300);
  await page.mouse.wheel(600, 0);
  await settle(page, 300);
  const scrolled = await page.evaluate(() => {
    const diff = document.querySelector("div.overflow-x-auto.font-mono");
    const column = diff?.closest(".overflow-y-auto");
    return { down: column?.scrollTop ?? 0, sideways: diff?.scrollLeft ?? 0, wide: diff ? diff.scrollWidth > diff.clientWidth : false };
  });
  console.log("  diff scroll", JSON.stringify(scrolled));
  await shot("06b-review-scrolled");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle(page, 300);
  await shot("07-back");
  await page.evaluate(() => document.querySelector("nav, aside")?.scrollTo?.(0, 0));
  await rowOf("Which sync strategy");
  await shot("08-question");
  await page.keyboard.press("2");
  await shot("09-question-picked");
  // snooze an Agency item, then the Snoozed list under Agency and under No project
  await context("Agency");
  await rowOf("Chase the client");
  await page.keyboard.press("s");
  await settle(page, 200);
  await byText(page, "Snooze: Next week").click();
  const bottom = async () => {
    await page.evaluate(() => document.querySelectorAll(".overflow-y-auto.border-r").forEach(el => (el.scrollTop = el.scrollHeight)));
    await settle(page, 200);
  };
  await bottom();
  await shot("10-snoozed-agency");
  await context("-");
  await bottom();
  await shot("11-snoozed-no-project");
  // a meeting card in the queue opens its prep (the filter goes back to All when it hides it)
  await byText(page, "Harbor CRM kick-off", true).click();
  await shot("12-meeting-card");
  // the next meeting, named in the header, opens too
  await page.locator("button", { hasText: /· then / }).first().click();
  await shot("13-next-meeting-in-header");
  // a meeting with a briefing already asked: the briefing itself, not the Write briefing button
  await byText(page, "Lunch with the accountant", true).click();
  await shot("13b-meeting-briefing");
  // work in progress in the sidebar: a reply draft under its section, a click brings the mail and its draft back
  await rowOf("Acceptance checklist portal v2");
  await page.keyboard.press("r");
  await page.waitForTimeout(800);
  await page.locator("textarea").first().evaluate(el => el.blur());
  await rowOf("Fix the SSO redirect loop on the portal");
  await page.locator('[data-kind="work"]', { hasText: "Acceptance checklist" }).first().click();
  await shot("14-draft-from-sidebar");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: `${dir}/error.png` });
} finally {
  await browser.close();
  await server.close?.();
  process.exit(0);
}
