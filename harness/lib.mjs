// Shared by screens.mjs and perf.mjs: the dev server with the mock backend, the browser, and page helpers that only
// use the DOM (visible text, roles, the scroll container), never a component's internals.
import { createServer, build, preview } from "vite";
import { chromium, webkit } from "playwright-core";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

export const HERE = fileURLToPath(new URL(".", import.meta.url));
export const FIXED_NOW = Date.parse("2026-10-01T07:30:00Z"); // = harness/fixtures/util.ts NOW

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** The app with the mock backend: the dev server on :1430, or with `prod` a production build (harness/dist) served on
 * :1431, which is what Tauri ships (no Lit dev mode, bundled modules). --url uses an already running one. */
export async function startServer({ prod = false } = {}) {
  const url = arg("url");
  if (url) return { url, close: async () => {} };
  const configFile = `${HERE}vite.config.ts`;
  if (prod) {
    await build({ configFile, logLevel: "warn", build: { outDir: `${HERE}dist`, emptyOutDir: true } });
    const server = await preview({
      configFile,
      logLevel: "warn",
      build: { outDir: `${HERE}dist` },
      preview: { port: 1431, strictPort: true, host: "127.0.0.1" },
    });
    return { url: "http://127.0.0.1:1431", close: () => new Promise(resolve => server.httpServer.close(resolve)) };
  }
  const server = await createServer({ configFile, logLevel: "warn" });
  await server.listen();
  return { url: "http://127.0.0.1:1430", close: () => server.close() };
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export async function launch(name = "chromium") {
  if (name === "webkit") return webkit.launch();
  // Playwright's own Chromium build when installed, else the system Chrome
  try {
    return await chromium.launch();
  } catch {
    if (!existsSync(CHROME))
      throw new Error("no Chromium: install one with `pnpm exec playwright-core install chromium`");
    return chromium.launch({ executablePath: CHROME, args: ["--headless=new"] });
  }
}

export async function newPage(browser, { scale = 2, fixedTime = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: scale,
    reducedMotion: "reduce",
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "Europe/Brussels",
  });
  const page = await context.newPage();
  if (fixedTime) await page.clock.setFixedTime(FIXED_NOW);
  page.on("pageerror", e => console.error(`  [page error] ${e.message}`));
  page.on("console", m => {
    if (m.type() === "error" || (m.type() === "warning" && m.text().startsWith("[harness]")))
      console.error(`  [console ${m.type()}] ${m.text()}`);
  });
  return page;
}

/** Open a page of the app (index.html or settings.html) with a fixture and a selection, and wait until it settled. */
export async function open(page, base, { path = "/", fixture = "default", sel = "", link = "" } = {}) {
  const q = new URLSearchParams({ fixture, ...(sel ? { sel } : {}), ...(link ? { link } : {}) });
  await page.goto(`${base}${path}?${q}`);
  await page.waitForFunction(() => window.__harness, null, { timeout: 15000 });
  await page.evaluate(() => window.__harness.ready);
  await settle(page);
}

/** Fonts loaded, two frames, no pending network. */
export async function settle(page, ms = 150) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
}

/** The first visible element with this exact text, through open shadow roots. */
// visible text, or a view in the sidebar's row of icons by its label ("Mail", "Reminders: 4 overdue")
export const byText = (page, text, exact = true) =>
  page
    .getByText(text, { exact })
    .or(page.locator(`[data-view][aria-label^="${String(text).replace(/"/g, '\\"')}"]`))
    .locator("visible=true")
    .first();

// in-page helpers, installed with addInitScript: a text search through shadow roots, the main scroll container
export const PAGE_HELPERS = () => {
  const walk = function* (root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      yield node;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      for (let c = node.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    }
  };
  window.__dom = {
    all: selector => [...walk(document.documentElement)].filter(n => n.matches?.(selector)),
    /** some element whose own text contains `text`, rendered (not display:none) */
    hasText: text => {
      for (const n of walk(document.documentElement)) {
        if (n.nodeType !== 1 || n.tagName === "STYLE" || n.tagName === "SCRIPT") continue;
        for (const c of n.childNodes)
          if (c.nodeType === 3 && c.data.includes(text) && n.getClientRects().length) return true;
      }
      return false;
    },
    /** the element that scrolls the most content: the conversation, the mail list, ... */
    mainScroller: () => {
      let best = null,
        most = 0;
      for (const n of walk(document.documentElement)) {
        if (n.nodeType !== 1) continue;
        const extra = n.scrollHeight - n.clientHeight;
        if (extra > most && n.clientHeight > 200 && getComputedStyle(n).overflowY.match(/auto|scroll/)) {
          best = n;
          most = extra;
        }
      }
      return best;
    },
  };
};

export const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN;
};
