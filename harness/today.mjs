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
const rowOf = async text => {
  await byText(page, text, false).click();
  await settle(page, 300);
};
try {
  await open(page, server.url, { fixture: "calendar", sel: "__wait" });
  await shot("01-overview");
  await page.getByRole("button", { name: /^Agency/ }).locator("visible=true").first().click();
  await shot("01b-context");
  await page.getByRole("button", { name: /^No project/ }).locator("visible=true").first().click();
  await shot("01c-no-project");
  await page.getByRole("button", { name: /^All/ }).locator("visible=true").first().click();
  await settle(page, 200);
  await rowOf("Acceptance checklist portal v2");
  await shot("02-mail");
  await shot("02b-mail-bottom");
  await page.keyboard.press("r");
  await page.waitForTimeout(800);
  await shot("03-mail-compose");
  await page.keyboard.press("Escape");
  await rowOf("Fix the SSO redirect loop on the portal");
  await shot("04-pr");
  await page.getByRole("button", { name: /^Review with Claude/ }).locator("visible=true").first().click();
  await page.waitForTimeout(1200);
  await shot("05-review");
  await byText(page, "const back = params.get('returnTo') ?? '/';", false).click();
  await shot("06-review-line");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle(page, 300);
  await shot("07-back");
  await rowOf("Which sync strategy");
  await shot("08-question");
  await page.keyboard.press("2");
  await shot("09-question-picked");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: `${dir}/error.png` });
} finally {
  await browser.close();
  await server.close?.();
  process.exit(0);
}
