// The drawer's layout in WebKit (the app's engine): the right drawer open on each tab, a pipeline strip and a project
// home, at 1280x820 and 900x600, with long titles (?long=1). Measures that nothing overflows its column and that the
// drawer keeps its width:  node harness/layout.mjs --browser webkit [--label layout] [--url http://127.0.0.1:1460]
import { mkdirSync } from "node:fs";
import { HERE, arg, startServer, launch, newPage, open, settle } from "./lib.mjs";

const label = arg("label", "layout");
const dir = `${HERE}screens/${label}`;
mkdirSync(dir, { recursive: true });
const server = await startServer();
const browser = await launch(arg("browser", "webkit"));
const page = await newPage(browser);

await open(page, server.url);
const K = await page.evaluate(() => window.__harness.keys);
const keys = async () => K;

// [width, height, drawer width the user dragged it to]: the third squeezes the conversation to its minimum
const SIZES = [
  [1280, 820, 0],
  [900, 600, 0],
  [1280, 820, 800],
];
const tab = async name => {
  if (!(await page.locator(".relay-drawer").count()))
    await page.getByRole("button", { name: "Project panel", exact: true }).click();
  await page
    .locator(".relay-drawer")
    .getByRole("button", { name: new RegExp(`^${name}(,|$)`) })
    .click();
  await settle(page, 300);
};
const SCENES = {
  "drawer-prs": async () => {
    await open(page, server.url, { long: true, fixture: "builds", sel: (await keys()).switchTo });
    await tab("Pull requests");
  },
  "drawer-builds": async () => {
    await open(page, server.url, { long: true, fixture: "builds", sel: (await keys()).switchTo });
    await tab("Builds");
  },
  "drawer-security": async () => {
    await open(page, server.url, { long: true, fixture: "aikido", sel: (await keys()).orchard });
    await tab("Security");
  },
  "strip-prs": async () => {
    await open(page, server.url, { long: true, fixture: "pipeline-strip", sel: "c:orch:Northwind Portal" });
    await page.getByRole("button", { name: "Show tickets in flight", exact: true }).click();
    await page.getByText("Tickets in flight").first().waitFor();
    await tab("Pull requests");
  },
  "project-home": async () => {
    await open(page, server.url, { long: true, fixture: "builds" });
    await page.getByText("Northwind Portal", { exact: true }).locator("visible=true").first().hover();
    await page.getByRole("button", { name: "New conversation about Northwind Portal", exact: true }).click();
    await page.getByText("Builds and PRs").first().waitFor();
    await tab("Pull requests");
  },
};

// scrollWidth > clientWidth, for the conversation column, the composer, the drawer and everything inside them
const MEASURE = () => {
  const box = el => el && { w: el.clientWidth, sw: el.scrollWidth, x: Math.round(el.getBoundingClientRect().left) };
  const main = document.querySelector(".relay-app > :nth-child(3)");
  const drawer = document.querySelector(".relay-drawer");
  const composer = document.querySelector("textarea")?.closest("form, div[class*=rounded]");
  const out = { conversation: box(main), drawer: box(drawer), composer: box(composer), inner: [] };
  const check = (root, name) => {
    if (!root) return;
    const r = root.getBoundingClientRect();
    for (const el of root.querySelectorAll("*")) {
      const b = el.getBoundingClientRect();
      if (!b.width || !el.getClientRects().length) continue;
      // a scroller (or a clip) between the element and the column owns its overflow, e.g. the strip's lanes
      let clipped = false;
      for (let a = el.parentElement; a && a !== root; a = a.parentElement)
        if (getComputedStyle(a).overflowX !== "visible") clipped = true;
      if (b.right > r.right + 1 && !clipped)
        out.inner.push(
          `${name}: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right ${Math.round(b.right)} > ${Math.round(r.right)}`,
        );
    }
  };
  check(main, "conversation");
  check(drawer, "drawer");
  return out;
};

let bad = 0;
for (const [name, go] of Object.entries(SCENES)) {
  if (arg("only") && !arg("only").split(",").includes(name)) continue;
  for (const [w, h, dragged] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await go();
    await page.setViewportSize({ width: w, height: h });
    if (dragged) await page.evaluate(d => document.documentElement.style.setProperty("--drawer-w", `${d}px`), dragged);
    await settle(page, 400);
    const m = await page.evaluate(MEASURE);
    const problems = [];
    for (const part of ["conversation", "composer", "drawer"])
      if (m[part] && m[part].sw > m[part].w)
        problems.push(`${part} scrollWidth ${m[part].sw} > clientWidth ${m[part].w}`);
    if (m.drawer && m.drawer.w > 460 && !dragged) problems.push(`drawer is ${m.drawer.w}px wide, not 460`);
    problems.push(...m.inner.slice(0, 6));
    console.log(
      `${problems.length ? "FAIL" : "ok  "} ${name} ${w}x${h}${dragged ? ` (drawer dragged to ${dragged})` : ""} conv=${m.conversation?.w} drawer=${m.drawer?.w}`,
    );
    for (const p of problems) console.log(`      ${p}`);
    bad += problems.length ? 1 : 0;
    await page.screenshot({
      path: `${dir}/${name}-${w}${dragged ? "-dragged" : ""}.png`,
      animations: "disabled",
      caret: "hide",
    });
  }
}
await browser.close();
await server.close();
process.exit(bad ? 1 : 0);
