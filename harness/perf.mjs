// Performance scenarios against the mock backend: node harness/perf.mjs --label <name> [--browser chromium|webkit]
// [--runs 5] [--dev] [--only scenario,scenario]. Each scenario runs on a fresh page load, 5 times; the table shows the
// median over runs. Writes harness/results/<label>-<browser>.json. See README.md for what each number means.
import { mkdirSync, writeFileSync } from "node:fs";
import { HERE, arg, startServer, launch, newPage, open, settle, PAGE_HELPERS, median, pct } from "./lib.mjs";

const label = arg("label", "current");
const browserName = arg("browser", "chromium");
const RUNS = Number(arg("runs", "5"));
const prod = !process.argv.includes("--dev");
const only = arg("only", "")?.split(",").filter(Boolean);
const READY_TEXT = "What is on today"; // the first general conversation in the sidebar

const server = await startServer({ prod });
const browser = await launch(browserName);

// before the app: long tasks (where supported), and a frame loop that stamps when the conversation list first shows
const PERF_INIT = readyText => {
  window.__perf = { longTasks: [], readyAt: 0 };
  // WebKit has no longtask entries (observe() would just ignore the type)
  window.__perf.longTaskSupported = PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
  if (window.__perf.longTaskSupported)
    new PerformanceObserver(list => window.__perf.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask", buffered: true });
  const poll = () => {
    if (window.__dom?.hasText(readyText)) window.__perf.readyAt = performance.now();
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

async function freshPage(sel = "") {
  const page = await newPage(browser, { scale: 1, fixedTime: false });
  await page.addInitScript(PAGE_HELPERS);
  await page.addInitScript(PERF_INIT, READY_TEXT);
  await open(page, server.url, { sel });
  await page.evaluate(() => (window.__harness.autoReply = false));
  return page;
}
const close = page => page.context().close();

// in the page: click the innermost visible element holding `title` (a sidebar row), then wait frame by frame until
// `text` is shown, and until the frame after that has painted
const timeUntilShown = (page, title, text) =>
  page.evaluate(async ({ title, text }) => {
    const el = window.__dom.all("*").filter(n => [...n.childNodes].some(c => c.nodeType === 3 && c.data.trim() === title) && n.getClientRects().length).pop();
    if (!el) throw new Error(`no element with the text ${title}`);
    const start = performance.now();
    el.click();
    while (!window.__dom.hasText(text)) await new Promise(r => requestAnimationFrame(r));
    return (await window.__harness.nextPaint()) - start;
  }, { title, text });

const scenarios = {
  async coldStart() {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const page = await freshPage();
      await page.waitForFunction(() => window.__perf.readyAt > 0, null, { timeout: 20000 });
      runs.push(await page.evaluate(() => window.__perf.readyAt));
      await close(page);
    }
    return { ms: summary(runs) };
  },

  async openLong() {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const page = await freshPage();
      const { titles, markers } = await page.evaluate(() => ({ titles: window.__harness.titles, markers: window.__harness.markers }));
      runs.push(await timeUntilShown(page, titles.long, markers.longEnd));
      await close(page);
    }
    return { ms: summary(runs) };
  },

  async stream1000() {
    const totals = [], p50 = [], p95 = [], longCount = [], longMs = [], heap = [];
    for (let i = 0; i < RUNS; i++) {
      const page = await freshPage();
      const keys = await page.evaluate(() => window.__harness.keys);
      await open(page, server.url, { sel: keys.long });
      await page.evaluate(() => (window.__harness.autoReply = false));
      await page.waitForFunction(m => window.__dom.hasText(m), (await page.evaluate(() => window.__harness.markers.longEnd)));
      await settle(page, 300);
      const r = await page.evaluate(async key => {
        const from = performance.now();
        const stats = await window.__harness.stream({ key, deltas: 1000, tokensPerDelta: 3, ratePerSecond: 0 });
        const tasks = window.__perf.longTaskSupported
          ? window.__perf.longTasks.filter(t => t.start >= from)
          : stats.perDelta.filter(d => d > 50).map(d => ({ duration: d }));
        return { stats, tasks, supported: window.__perf.longTaskSupported };
      }, keys.long);
      totals.push(r.stats.total);
      p50.push(pct(r.stats.perDelta, 50));
      p95.push(pct(r.stats.perDelta, 95));
      longCount.push(r.tasks.length);
      longMs.push(r.tasks.reduce((s, t) => s + t.duration, 0));
      if (browserName === "chromium") heap.push(await heapMB(page));
      scenarios.stream1000.longTaskSource = r.supported ? "PerformanceObserver longtask" : "deltas whose handling took > 50 ms";
      await close(page);
    }
    return { totalMs: summary(totals), deltaP50Ms: summary(p50), deltaP95Ms: summary(p95), longTasks: summary(longCount), longTaskMs: summary(longMs), longTaskSource: scenarios.stream1000.longTaskSource, ...(heap.length ? { heapAfterMB: summary(heap) } : {}) };
  },

  async stream60() {
    const slow = [], maxFrame = [], p95 = [];
    for (let i = 0; i < RUNS; i++) {
      const page = await freshPage();
      const keys = await page.evaluate(() => window.__harness.keys);
      await open(page, server.url, { sel: keys.long });
      await page.evaluate(() => (window.__harness.autoReply = false));
      await settle(page, 300);
      const frames = await page.evaluate(async key => {
        const intervals = [];
        let last = 0, on = true;
        const loop = t => {
          if (last) intervals.push(t - last);
          last = t;
          if (on) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        await window.__harness.stream({ key, deltas: 600, tokensPerDelta: 3, ratePerSecond: 60 });
        on = false;
        return intervals;
      }, keys.long);
      slow.push(frames.filter(f => f > 20).length);
      maxFrame.push(Math.max(...frames));
      p95.push(pct(frames, 95));
      await close(page);
    }
    return { framesOver20ms: summary(slow), maxFrameMs: summary(maxFrame), frameP95Ms: summary(p95) };
  },

  async switch20() {
    const avgs = [];
    for (let i = 0; i < RUNS; i++) {
      const page = await freshPage();
      const { keys, titles, markers } = await page.evaluate(() => ({ keys: window.__harness.keys, titles: window.__harness.titles, markers: window.__harness.markers }));
      await open(page, server.url, { sel: keys.switchTo });
      await page.evaluate(() => (window.__harness.autoReply = false));
      const times = [];
      for (let k = 0; k < 20; k++) {
        const toLong = k % 2 === 0;
        times.push(await timeUntilShown(page, toLong ? titles.long : titles.switchTo, toLong ? markers.longEnd : markers.switchEnd));
      }
      avgs.push(times.reduce((s, t) => s + t, 0) / times.length);
      await close(page);
    }
    return { avgMs: summary(avgs) };
  },

  typing: () => typeText(200, 0),
  // a fast human typist: one key every 50 ms (about 240 characters a minute)
  typingPaced: () => typeText(60, 50),
};

async function typeText(length, delay) {
    const p50 = [], p95 = [], frameP50 = [], frameP95 = [];
    const text = "The billing sync writes a second balance when a credit note arrives first. ".repeat(3).slice(0, length);
    for (let i = 0; i < RUNS; i++) {
      const page = await freshPage();
      const keys = await page.evaluate(() => window.__harness.keys);
      await open(page, server.url, { sel: keys.long });
      await page.evaluate(() => (window.__harness.autoReply = false));
      await settle(page, 300);
      // focus, not click: WebKit's hit test reports the shadow host as covering the textarea
      await page.locator("textarea").locator("visible=true").first().focus();
      await page.evaluate(() => {
        window.__keys = [];
        window.__frames = [];
        window.addEventListener("keydown", e => {
          const start = e.timeStamp;
          window.__harness.nextPaint().then(t => window.__keys.push(t - start));
          // the frame that shows the key: unlike the task after it, not queued behind input still coming in
          requestAnimationFrame(t => window.__frames.push(t - start));
        }, true);
      });
      await page.keyboard.type(text, { delay });
      await page.waitForFunction(n => window.__keys.length >= n, text.length);
      const lat = await page.evaluate(() => window.__keys);
      p50.push(pct(lat, 50));
      p95.push(pct(lat, 95));
      const frames = await page.evaluate(() => window.__frames);
      frameP50.push(pct(frames, 50));
      frameP95.push(pct(frames, 95));
      await close(page);
    }
    return { keyP50Ms: summary(p50), keyP95Ms: summary(p95), frameP50Ms: summary(frameP50), frameP95Ms: summary(frameP95) };
}

async function heapMB(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize / 1048576;
}
function summary(runs) {
  return { median: round(median(runs)), p95: round(pct(runs, 95)), runs: runs.map(round) };
}
const round = x => Math.round(x * 100) / 100;

const results = { label, browser: browserName, build: prod ? "production" : "dev", runs: RUNS, date: new Date().toISOString(), scenarios: {} };
for (const [name, run] of Object.entries(scenarios)) {
  if (only?.length && !only.includes(name)) continue;
  process.stdout.write(`${name} ... `);
  const t = Date.now();
  try {
    results.scenarios[name] = await run();
    console.log(`${((Date.now() - t) / 1000).toFixed(0)} s`);
  } catch (e) {
    results.scenarios[name] = { error: e.message.split("\n")[0] };
    console.log(`FAILED: ${e.message.split("\n")[0]}`);
  }
}
mkdirSync(`${HERE}results`, { recursive: true });
writeFileSync(`${HERE}results/${label}-${browserName}.json`, JSON.stringify(results, null, 2));

const s = results.scenarios;
const row = (name, metric, unit = "ms") => {
  const v = metric?.median;
  return v === undefined ? `| ${name} | ${metric === undefined ? "n/a" : "error"} | |` : `| ${name} | ${v}${unit ? ` ${unit}` : ""} | ${metric.p95}${unit ? ` ${unit}` : ""} |`;
};
console.log(`\n**${label}, ${browserName}, ${results.build} build, median of ${RUNS} runs**\n`);
console.log(["| Scenario | Median | p95 over runs |", "|---|---:|---:|",
  row("Cold start to conversation list (60 conversations)", s.coldStart?.ms),
  row("Open the 300-item conversation", s.openLong?.ms),
  row("1,000 deltas as fast as possible: total until painted", s.stream1000?.totalMs),
  row("  per delta, p50 within a run", s.stream1000?.deltaP50Ms),
  row("  per delta, p95 within a run", s.stream1000?.deltaP95Ms),
  row(`  long tasks > 50 ms (${s.stream1000?.longTaskSource ?? ""})`, s.stream1000?.longTasks, ""),
  row("  long task time", s.stream1000?.longTaskMs),
  ...(s.stream1000?.heapAfterMB ? [row("  JS heap after the stream (after GC)", s.stream1000.heapAfterMB, "MB")] : []),
  row("60 deltas/s for 10 s: frames > 20 ms", s.stream60?.framesOver20ms, ""),
  row("  longest frame", s.stream60?.maxFrameMs),
  row("  frame p95 within a run", s.stream60?.frameP95Ms),
  row("Switch between two conversations (avg of 20)", s.switch20?.avgMs),
  row("Typing 200 characters, no pause: keystroke to its frame, p50", s.typing?.frameP50Ms),
  row("  p95", s.typing?.frameP95Ms),
  row("  keystroke to the task after the frame, p50 (queued behind incoming keys)", s.typing?.keyP50Ms),
  row("  p95", s.typing?.keyP95Ms),
  row("Typing 60 characters, one key per 50 ms: keystroke to its frame, p50", s.typingPaced?.frameP50Ms),
  row("  p95", s.typingPaced?.frameP95Ms),
  row("  keystroke to the task after the frame, p50", s.typingPaced?.keyP50Ms),
  row("  p95", s.typingPaced?.keyP95Ms),
].join("\n"));
for (const [name, r] of Object.entries(s)) if (r.error) console.log(`\n${name} failed: ${r.error}`);
await browser.close();
await server.close();
