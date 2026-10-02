// Behaviour parity against the mock backend: what the frontend asks the backend to do, scenario by scenario.
//   node harness/behaviour.mjs --url http://127.0.0.1:1432 --label lit [--only send,mail]  → harness/results/behaviour-<label>.json
//   node harness/behaviour.mjs --compare lit react                                         → per-scenario diff
// Every scenario starts from a fresh page load and drives the app only through visible text, roles, the composer
// textarea, the keyboard and localStorage. Per scenario it records the backend calls (normalised: conversation keys as
// "chat:<project>/<title>", new ones as "new#n", dates and epoch numbers masked), split into effects (anything that
// changes something) and reads (counted), plus checks (the expected behaviour) and facts (DOM and localStorage).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HERE, arg, startServer, launch, newPage, open, settle, PAGE_HELPERS } from "./lib.mjs";

const RESULTS = `${HERE}results`;

// ---------- classification of the calls
// polls and plumbing: left out entirely, their timing is not behaviour
const IGNORED = new Set(["pending", "subagents", "history_sid", "agents", "app_sids", "app_sessions", "running", "plugin:window|is_focused", "plugin:window|set_title"]);
// reads: counted per command (integration GETs per path), order and count are informational
const READS = new Set([
  "get_settings", "ui_lang", "ui_locale", "vault_status", "snapshot", "vault_notes", "read_note", "project_icons", "project_repos",
  "agents_status", "agent_commands", "action_config", "integration_thumb", "plugin:deep-link|get_current", "chats", "chat_providers", "history", "agent_log", "usage_limits", "usage_tokens",
  "github_status", "github_prs", "github_pr", "mail_list", "mail_read", "integration_status", "integration_has_token",
  "integration_mcp", "favicons", "find_icon_sites", "detect_vault", "check_vault", "plugin:window|theme",
]);
const isIgnored = c => IGNORED.has(c.cmd) || c.cmd.startsWith("plugin:event|");
const isRead = c => READS.has(c.cmd) || (c.cmd === "integration_call" && c.args.method === "GET");

// ---------- in the page, before the app: the IPC boundary, with optional changes to what the backend answers
// (outside: the conversation `key` has a turn running in a process the app did not start, as `agents` reports it)
const IPC_INIT = overrides => {
  const uuid = n => {
    const hex = (n * 2654435761).toString(16).padStart(8, "0").slice(-8);
    return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`;
  };
  let real = null;
  let order = null; // the fixture's conversation order (the mock seeds localStorage before the app's first call)
  const wrapped = async (cmd, args, options) => {
    order ??= Object.keys(JSON.parse(localStorage.getItem("chats") || "{}"));
    const result = await real(cmd, args, options);
    if (overrides.outside && cmd === "agents") {
      const key = window.__harness.keys[overrides.outside];
      const sid = uuid(order.indexOf(key) + 101); // = harness/fixtures/conversations.ts sidOf
      return [...result, { id: "outside-1", sessionId: sid, provider: "claude", kind: "interactive", status: "busy", name: "", startedAt: new Date().toISOString() }];
    }
    return result;
  };
  const internals = (window.__TAURI_INTERNALS__ ??= {});
  Object.defineProperty(internals, "invoke", { configurable: true, get: () => real && wrapped, set: fn => (real = fn) });
};

// ---------- normalising
function normaliser(labels) {
  const fresh = new Map();
  const key = s => labels[s] ?? (fresh.has(s) ? fresh.get(s) : (fresh.set(s, `new#${fresh.size + 1}`), fresh.get(s)));
  const norm = v => {
    if (typeof v === "string") {
      if (labels[v]) return labels[v];
      if (/^c:[0-9a-z]+$/.test(v)) return key(v);
      if (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) return "<iso>";
      if (/^data:[^,]{0,40},/.test(v) || v.length > 2000) return `<data ${v.length}>`;
      return v;
    }
    if (typeof v === "number") return v > 1e11 ? "<epoch>" : v;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [/^c:[0-9a-z]+$/.test(k) ? key(k) : k, norm(v[k])]));
    return v;
  };
  return norm;
}

// ---------- one scenario's page and its recorder
async function session(browser, url, overrides = {}) {
  const page = await newPage(browser, { scale: 1 });
  await page.addInitScript(PAGE_HELPERS);
  await page.addInitScript(IPC_INIT, overrides);
  const log = []; // calls of every load, in order
  let labels = {};
  let norm = v => v;
  let seeded = {};
  const flush = async () => {
    const calls = await page.evaluate(() => window.__harness?.calls.map(c => ({ cmd: c.cmd, args: c.args })) ?? []).catch(() => []);
    log.push(...calls.slice(page.__from ?? 0));
    page.__from = calls.length;
  };
  const s = {
    page,
    checks: {},
    facts: {},
    async load(opts = {}) {
      if (page.__loaded) await flush();
      await open(page, url, opts);
      page.__loaded = true;
      const info = await page.evaluate(() => ({ chats: JSON.parse(localStorage.getItem("chats") || "{}"), keys: window.__harness.keys, n: window.__harness.calls.length }));
      seeded = info.chats;
      labels = Object.fromEntries(Object.entries(info.chats).map(([k, c]) => [k, `chat:${c.project ?? "-"}/${c.title}`]));
      for (const [name, sid] of Object.entries(info.keys)) if (sid.startsWith("t:")) labels[sid] = `term:${name}`;
      norm = normaliser(labels);
      page.__from = info.n; // the start-up calls are not the scenario's
      s.keys = info.keys;
      await page.evaluate(() => (window.__harness.autoReply = false));
    },
    check(name, ok) {
      s.checks[name] = !!ok;
    },
    fact(name, value) {
      s.facts[name] = norm(value);
    },
    /** the calls of the current load so far, normalised, ignored ones left out */
    async calls(cmd) {
      const all = await page.evaluate(from => window.__harness.calls.slice(from).map(c => ({ cmd: c.cmd, args: c.args })), page.__from);
      return all.filter(c => !isIgnored(c) && (!cmd || c.cmd === cmd)).map(c => ({ cmd: c.cmd, args: norm(c.args) }));
    },
    /** wait until `cmd` was called `n` times in this load */
    async waitCall(cmd, n = 1, timeout = 4000) {
      const ok = await page
        .waitForFunction(({ cmd, n, from }) => window.__harness.calls.slice(from).filter(c => c.cmd === cmd).length >= n, { cmd, n, from: page.__from }, { timeout })
        .then(() => true, () => false);
      return ok;
    },
    /** localStorage keys whose value changed since `before` (a local([]) taken earlier: every key), chats and polls left out */
    async localChanges(before) {
      const now = await s.local([]);
      return Object.fromEntries(Object.entries(now).filter(([k, v]) => !["chats", "sel", "typed"].includes(k) && JSON.stringify(v) !== JSON.stringify(before[k])));
    },
    async local(keys) {
      // no keys: every key
      return page.evaluate(keys => Object.fromEntries((keys.length ? keys : Object.keys(localStorage)).map(k => { const v = localStorage.getItem(k); let p = v; try { p = v == null ? null : JSON.parse(v); } catch { /* a plain string */ } return [k, p]; })), keys);
    },
    /** the conversations whose title, project, closed or draft changed since the load, and the new ones */
    async chatChanges() {
      const now = await page.evaluate(() => JSON.parse(localStorage.getItem("chats") || "{}"));
      const out = {};
      for (const [k, c] of Object.entries(now)) {
        const was = seeded[k];
        const pick = x => ({ title: x?.title, project: x?.project ?? null, closed: !!x?.closed, draft: !!x?.draft });
        if (!was || JSON.stringify(pick(was)) !== JSON.stringify(pick(c))) out[k] = pick(c);
      }
      for (const k of Object.keys(seeded)) if (!now[k]) out[k] = "removed";
      return out;
    },
    async result() {
      await flush();
      const kept = log.filter(c => !isIgnored(c)).map(c => ({ cmd: c.cmd, args: norm(c.args) }));
      const effects = kept.filter(c => !isRead(c));
      const reads = {};
      for (const c of kept.filter(isRead)) {
        const name = c.cmd === "integration_call" ? `integration_call GET ${String(c.args.path).split("?")[0].replace(/\/\d+/g, "/:id")}` : c.cmd;
        reads[name] = (reads[name] || 0) + 1;
      }
      return { checks: s.checks, effects, reads: Object.fromEntries(Object.entries(reads).sort()), facts: s.facts };
    },
  };
  return s;
}

// ---------- DOM helpers: visible text, roles, the composer
const hasText = (page, text) => page.evaluate(t => window.__dom.hasText(t), text);
const waitText = (page, text, timeout = 5000) => page.waitForFunction(t => window.__dom.hasText(t), text, { timeout }).then(() => true, () => false);
const visible = locator => locator.locator("visible=true");
const composer = page => visible(page.locator("textarea")).last();
const composerValue = page => composer(page).inputValue({ timeout: 2000 }).catch(() => null);
const click = async (locator, ms = 150) => {
  await visible(locator).first().click({ timeout: 4000 });
  await settle(locator.page(), ms);
};
const byText = (page, text) => page.getByText(text, { exact: true });
const nav = page => page.getByRole("navigation").first();
const navHas = async (page, text) => (await visible(nav(page).getByText(text, { exact: true })).count()) > 0;
const button = (page, name) => page.getByRole("button", { name, exact: true });
/** a settings section in the window's sidebar: its name and its shortcut (⌘1…) */
const navButton = (page, name) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) });
async function typeInComposer(page, text) {
  await composer(page).click({ timeout: 4000 });
  await page.keyboard.type(text);
}
/** the deepest focused element's placeholder (through shadow roots) */
const focusedPlaceholder = page =>
  page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el?.getAttribute("placeholder") ?? el?.tagName ?? null;
  });

// ---------- the scenarios
const SCENARIOS = {
  async send(s) {
    await s.load(); // a first load reads the fixture keys
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const text = "Parity check: what is still open?";
    await typeInComposer(page, text);
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    const sends = await s.calls("send");
    // the first message of a project conversation carries the project line in front (<relay-project>…</relay-project>)
    s.check("send once, to this conversation, with the text", sends.length === 1 && sends[0].args.project === "chat:Northwind Portal/Invoice export columns" && String(sends[0].args.text).endsWith(text));
    s.check("the project line goes in front", /^<relay-project>[\s\S]*Northwind Portal[\s\S]*<\/relay-project>/.test(sends[0]?.args.text ?? ""));
    s.check("composer cleared", (await composerValue(page)) === "");
    s.check("message shown", await waitText(page, text));
    s.check("no Done before the turn ends", !(await hasText(page, "Done")));
    await page.evaluate(key => window.__harness.stream({ key, deltas: 6, tokensPerDelta: 3, ratePerSecond: 0 }), s.keys.switchTo);
    await settle(page);
    s.check("streamed tool step shown", await waitText(page, "1 step"));
    s.check("turn end shows Done", await waitText(page, "Done"));
    s.fact("typed", (await s.local(["typed"])).typed);
  },

  async stop(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    await typeInComposer(page, "A long task");
    await page.keyboard.press("Enter");
    await s.waitCall("send");
    await page.keyboard.press("Escape");
    await settle(page);
    s.check("first Escape warns", await hasText(page, "Press Escape again to cancel the request"));
    s.check("first Escape does not stop", (await s.calls("stop")).length === 0);
    await page.keyboard.press("Escape");
    s.check("second Escape stops", await s.waitCall("stop", 1, 2000));
    s.check("stopped note", await waitText(page, "Stopped."));
    await typeInComposer(page, "Another task");
    await page.keyboard.press("Enter");
    await s.waitCall("send", 2);
    await page.keyboard.press("Control+c");
    s.check("Ctrl-C stops a running turn", await s.waitCall("stop", 2, 2000));
    await typeInComposer(page, "typed, then cleared");
    await page.keyboard.press("Control+c");
    await settle(page);
    s.check("Ctrl-C when idle clears the composer", (await composerValue(page)) === "");
    s.check("Ctrl-C when idle does not stop", (await s.calls("stop")).length === 2);
    s.fact("stops", (await s.calls("stop")).map(c => c.args));
  },

  async cards(s) {
    await s.load();
    await s.load({ sel: s.keys.permission });
    const { page } = s;
    s.check("permission card shown", await waitText(page, "git push origin fix/portal-redirect"));
    await click(button(page, "Allow"), 300);
    s.check("answer called", await s.waitCall("answer"));
    const perm = await s.calls("answer");
    s.check("permission answered once with allow", perm.length === 1 && perm[0].args.id === "perm-0001" && perm[0].args.decision?.behavior === "allow");
    await settle(page, 900); // a pending poll
    s.check("permission card gone", (await visible(button(page, "Allow")).count()) === 0);
    s.fact("allowed line", await hasText(page, "Allowed"));
    await s.load({ sel: s.keys.question });
    s.check("question card shown", await waitText(page, "Which sync strategy should the contact import use?"));
    await click(button(page, "Incremental"));
    await click(button(page, "Client PM"));
    await click(button(page, "Dev team"));
    await click(button(page, "Answer"), 300);
    s.check("question answered", await s.waitCall("answer"));
    const ask = await s.calls("answer");
    s.check("question answered once", ask.length === 1 && ask[0].args.id === "ask-0001");
    s.fact("question answers", ask[0]?.args.decision?.updatedInput?.answers ?? null);
    await settle(page, 900);
    s.check("question card gone", (await visible(button(page, "Answer")).count()) === 0);
    // an agent action (`relay`) asks with the same card
    await s.load({ sel: s.keys.action });
    s.check("action card shown", await waitText(page, "relay productive.create_task"));
    await click(button(page, "Deny"), 300);
    const act = await s.calls("answer");
    s.check("action denied once", act.length === 1 && act[0].args.id === "act-0001" && act[0].args.decision?.behavior === "deny");
    s.fact("action answer", act[0]?.args.decision ?? null);
  },

  async cmdk(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    const placeholder = await focusedPlaceholder(page);
    s.check("Cmd-K focuses its field", /ask a question/i.test(placeholder ?? ""));
    const text = "What is open for Harbor CRM today?";
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    await settle(page, 300);
    const sends = await s.calls("send");
    s.check("send to a new conversation", sends.length === 1 && sends[0].args.project === "new#1" && String(sends[0].args.text).endsWith(text));
    const changes = await s.chatChanges();
    const created = Object.values(changes).filter(c => c !== "removed");
    s.check("new conversation routed to the project", created.length === 1 && created[0].project === "Harbor CRM");
    s.check("open view unchanged", (await s.local(["sel"])).sel === s.keys.switchTo);
    s.check("started toast", await hasText(page, `Started: ${text}`));
    s.fact("chat changes", changes);
    s.fact("composer of the open conversation", await composerValue(page));
  },

  async newGeneral(s) {
    await s.load();
    const { page } = s;
    await page.evaluate(() => window.__harness.emit("menu", "new-general"));
    await settle(page, 300);
    const text = "Parity general question";
    await typeInComposer(page, text);
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    await settle(page, 300);
    const sends = await s.calls("send");
    s.check("send to a new general conversation", sends.length === 1 && sends[0].args.project === "new#1" && String(sends[0].args.text).endsWith(text));
    s.fact("text sent", sends[0]?.args.text);
    const changes = await s.chatChanges();
    const created = Object.values(changes).filter(c => c !== "removed");
    s.check("one new general conversation, not a draft", created.length === 1 && created[0].project === null && !created[0].draft);
    s.fact("chat changes", changes);
    s.fact("sel", (await s.local(["sel"])).sel);
  },

  async renameClose(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const title = page.getByRole("textbox", { name: "Conversation title" });
    await title.click();
    await title.fill("Renamed by parity");
    await page.keyboard.press("Enter");
    await settle(page);
    let changes = await s.chatChanges();
    s.check("renamed in localStorage", changes[s.keys.switchTo]?.title === "Renamed by parity");
    s.check("sidebar shows the new title", await hasText(page, "Renamed by parity"));
    await page.evaluate(() => window.__harness.emit("menu", "close-chat"));
    await settle(page, 300);
    changes = await s.chatChanges();
    s.check("closed in localStorage", changes[s.keys.switchTo]?.closed === true);
    s.check("closed toast", await hasText(page, "Closed: Renamed by parity"));
    const dropped = await s.calls("drop_worktrees");
    s.check("its worktrees dropped once", dropped.length === 1 && dropped[0].args.project === "chat:Northwind Portal/Invoice export columns");
    s.check("toast names the removed worktree", await hasText(page, "1 worktree removed"));
    s.check("another view selected", (await s.local(["sel"])).sel !== s.keys.switchTo);
    s.fact("sel after close", (await s.local(["sel"])).sel);
    await click(visible(nav(page).getByText("GENERAL", { exact: true }))); // folded: the project's menu fits in the window
    await nav(page).getByText("Northwind Portal", { exact: true }).first().click({ button: "right" });
    await settle(page);
    s.check("closed list lists it", await hasText(page, "Recently closed"));
    await click(byText(page, "Renamed by parity").last(), 300);
    changes = await s.chatChanges();
    s.check("reopened", changes[s.keys.switchTo]?.closed === false);
    s.check("reopened is selected", (await s.local(["sel"])).sel === s.keys.switchTo);
    s.fact("chat changes", changes);
  },

  async sidebar(s) {
    await s.load();
    const { page } = s;
    const head = name => visible(nav(page).getByText(name, { exact: true })).first();
    await click(head("AGENCY"));
    s.check("section collapsed", !(await navHas(page, "Push the portal fix")));
    s.fact("collapsed", (await s.local(["collapsed"])).collapsed);
    // drag PERSONAL above AGENCY by pointer (the app reorders on pointer events), with AGENCY folded so both are in view
    await head("PERSONAL").scrollIntoViewIfNeeded();
    const from = await head("PERSONAL").boundingBox();
    const to = await head("AGENCY").boundingBox();
    if (from && to) {
      await page.mouse.move(from.x + 10, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 10, from.y - 10, { steps: 4 });
      await page.mouse.move(to.x + 10, to.y + 2, { steps: 8 });
      await page.mouse.up();
      await settle(page);
    }
    const order = (await s.local(["secOrder"])).secOrder;
    s.check("dragged section order saved", Array.isArray(order) && order.includes("Personal") && (!order.includes("Agency") || order.indexOf("Personal") < order.indexOf("Agency")));
    s.fact("secOrder", order);
    await click(head("AGENCY"));
    s.check("section open again", await navHas(page, "Push the portal fix"));
    const search = page.getByPlaceholder("Search projects");
    await search.fill("Harbor");
    await settle(page);
    s.check("search keeps the match", await navHas(page, "Contact sync strategy"));
    s.check("search hides the rest", !(await navHas(page, "Push the portal fix")));
    await search.fill("");
    await settle(page);
    s.check("search cleared shows all", await navHas(page, "Push the portal fix"));
    s.fact("localStorage", await s.local(["collapsed", "secOrder", "projOrder", "convOrder"]));
  },

  async mail(s) {
    await s.load();
    const { page, keys } = s;
    const markers = await page.evaluate(() => window.__harness.markers);
    await click(nav(page).getByText("Mail", { exact: true }), 300);
    s.check("list shown", await waitText(page, markers.plainMail));
    s.check("both accounts merged", await hasText(page, markers.studioMail));
    s.check("mail_list per account", JSON.stringify((await s.calls("mail_list")).map(c => c.args).sort((a, b) => a.account.localeCompare(b.account))) === JSON.stringify([{ account: "laurent@example.com", page: 1 }, { account: "studio@example.org", page: 1 }]));
    await click(byText(page, markers.plainMail), 300);
    s.check("plain mail shown", await waitText(page, "The export should include the VAT column."));
    s.check("mail_read once", (await s.calls("mail_read")).length === 1);
    s.check("opening does not mark it read", (await s.calls("mail_seen")).length === 0);
    await click(button(page, "Mark as read").last(), 300);
    const seen = await s.calls("mail_seen");
    s.check("read toggle calls mail_seen once", seen.length === 1 && seen[0].args.id === "5000" && seen[0].args.seen === true);
    await page.getByRole("searchbox", { name: "Search sender or subject" }).fill("Invoice September");
    await settle(page);
    s.check("search keeps the match", await hasText(page, "Invoice September (2)"));
    s.check("search hides the rest", !(await hasText(page, "Lunch Thursday?")));
    await page.getByRole("searchbox", { name: "Search sender or subject" }).fill("");
    await settle(page);
    await click(button(page, "Load 50 more"), 300);
    const more = (await s.calls("mail_list")).filter(c => c.args.page === 2);
    s.check("load more asks page 2 of the account that has more", more.length === 1 && more[0].args.account === "laurent@example.com");
    s.check("page 2 shown", await waitText(page, "Contract renewal (5)"));
    // a link in the sandboxed html mail: the webview's navigation becomes the backend's mail-link event, as in Tauri
    await page.route("https://beacon.example/**", async route => {
      await page.evaluate(u => window.__harness.emit("mail-link", u), route.request().url()).catch(() => {});
      await route.abort();
    });
    await click(byText(page, markers.studioMail), 300);
    const reads = (await s.calls("mail_read")).map(c => c.args);
    s.check("a mail is read from its own account", reads.at(-1)?.account === "studio@example.org" && reads.at(-1)?.id === "700");
    await click(byText(page, markers.htmlMail), 300);
    s.check("html mail in a frame", await page.waitForFunction(() => window.__dom.all("iframe").some(f => f.srcdoc.includes("Balance report")), null, { timeout: 4000 }).then(() => true, () => false));
    s.check("still no mark-read after the html mail", (await s.calls("mail_seen")).length === 1);
    await page.frameLocator("iframe").getByText("Open dossier").click({ timeout: 4000 }).catch(() => {});
    const url = "https://beacon.example/dossiers/D-1042";
    s.check("confirmation bar shows the url", await waitText(page, url, 3000));
    s.check("nothing opened before the go", (await s.calls("plugin:opener|open_url")).length === 0);
    const bar = page.locator("div").filter({ hasText: url }).filter({ has: button(page, "Open") }).last();
    if (await hasText(page, url)) await click(bar.getByRole("button", { name: "Open", exact: true }));
    const opened = await s.calls("plugin:opener|open_url");
    s.check("confirm opens the url once", opened.length === 1 && opened[0].args.url === url);
    s.check("bar gone", !(await hasText(page, url)));
    void keys;
  },

  async prs(s) {
    await s.load();
    const { page } = s;
    await click(nav(page).getByText("Pull requests", { exact: true }), 300);
    s.check("list shown", await waitText(page, "Fix the SSO redirect loop on the portal"));
    await click(byText(page, "Fix the SSO redirect loop on the portal"), 300);
    s.check("detail shown", await waitText(page, "src/auth/callback.ts"));
    const pr = await s.calls("github_pr");
    s.check("github_pr for the PR", pr.some(c => c.args.repo === "acme/northwind-portal" && c.args.number === 412));
    s.check("list and PR side by side", await hasText(page, "Replace balance instead of adding it"));
    await click(button(page, "AI review"), 400);
    const sends = await s.calls("send");
    s.check("AI review sends one review prompt", sends.length === 1 && String(sends[0].args.text).includes("Review PR https://github.com/acme/northwind-portal/pull/412"));
    const created = Object.values(await s.chatChanges()).filter(c => c !== "removed");
    s.check("in a new conversation under the PR's project", created.length === 1 && created[0].project === "Northwind Portal" && created[0].title === "Review northwind-portal #412");
    s.fact("sel", (await s.local(["sel"])).sel);
  },

  async board(s) {
    await s.load();
    const { page } = s;
    const card = (await page.evaluate(() => window.__harness.markers)).card;
    await click(nav(page).getByText("Productive", { exact: true }), 300);
    s.check("board shown", await waitText(page, card));
    await click(byText(page, card), 500);
    s.check("card detail shown", await waitText(page, "Amount excl. VAT"));
    const comment = visible(page.getByPlaceholder("Leave a comment…")).first();
    await comment.fill("Parity comment");
    await click(button(page, "Comment"), 500);
    const writes = async () => (await s.calls("integration_call")).filter(c => c.args.method !== "GET");
    s.check("comment posted once", (await writes()).filter(c => String(c.args.path).startsWith("/comments")).length === 1);
    s.check("comment box emptied", (await comment.inputValue().catch(() => null)) === "");
    const status = visible(page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "In review", exact: true }) })).first();
    await status.selectOption({ label: "In progress" });
    await settle(page, 500);
    const status_ = (await writes()).filter(c => String(c.args.path).startsWith("/tasks"));
    s.check("status changed once", status_.length === 1 && JSON.stringify(status_[0].args.body).includes("ws2"));
    s.fact("writes", await writes());
    // Start conversation: a new conversation about the card, under the board's vault project; the card goes in front
    await click(button(page, "Start conversation"), 400);
    const created = Object.entries(await s.chatChanges()).filter(([, c]) => c !== "removed");
    s.check("card conversation under the linked project", created.length === 1 && created[0][1].project === "Northwind Portal");
    s.check("card conversation selected", (await s.local(["sel"])).sel === created[0]?.[0]);
    s.fact("card conversation", created[0]?.[1] ?? null);
    s.fact("composer before typing", await composerValue(page));
    await composer(page).click({ timeout: 4000 });
    await composer(page).evaluate(el => el.setSelectionRange(el.value.length, el.value.length)); // type after what is there
    await page.keyboard.type("What is left?");
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    const sends = await s.calls("send");
    s.check("the card goes in front of the first message", sends.length === 1 && String(sends[0].args.text).includes("Invoice export CSV") && String(sends[0].args.text).endsWith("What is left?"));
    s.fact("card send", sends[0]?.args ?? null);
  },

  async boardTools(s) {
    await s.load();
    const { page } = s;
    const before = await s.local([]);
    await click(nav(page).getByText("Productive", { exact: true }), 300);
    s.check("board shown", await waitText(page, "Invoice export CSV"));
    await click(button(page, "List"), 300);
    s.check("list view shows its groups", await hasText(page, "Backlog") && (await page.getByText("#300", { exact: true }).count()) > 0);
    await click(button(page, "Filters"), 300);
    await click(page.getByRole("button", { name: /^Laurent\b/ }), 300);
    s.check("an assignee filter narrows the board", await waitText(page, "3 of 20"));
    await click(button(page, "Show 3 tasks"), 300);
    await click(page.getByRole("button", { name: /^Filters/ }), 300); // with its count now
    await click(button(page, "Clear all filters"), 300);
    s.check("cleared", await waitText(page, "20 tasks"));
    await click(button(page, "Show 20 tasks"), 300);
    await click(button(page, "Presets"), 300);
    s.check("Productive's saved views listed", (await hasText(page, "In review")) && (await hasText(page, "My open tasks")) && (await hasText(page, "Due this week")));
    s.check("a hidden view is left out", !(await hasText(page, "Old hidden view")));
    await click(byText(page, "In review").last(), 300);
    s.check("a saved view applies its filter", await waitText(page, "4 of 20"));
    await click(button(page, "Task lists"), 300);
    s.fact("group menu", await hasText(page, "Group lanes by"));
    s.fact("localStorage", await s.localChanges(before));
  },

  async reminders(s) {
    await s.load();
    const { page } = s;
    await click(nav(page).getByText("Reminders", { exact: true }), 300);
    s.check("list shown", await waitText(page, "Chase the client for the partner API keys"));
    await click(button(page, "New reminder"));
    await page.getByRole("textbox", { name: "What should it remind you of?" }).fill("Parity reminder");
    await page.getByLabel("Date", { exact: true }).fill("2026-10-09");
    await click(button(page, "Add"), 300);
    const added = await s.calls("reminder_add");
    s.check("reminder_add once", added.length === 1);
    s.fact("added", added.map(c => c.args));
    await click(button(page, "Done").first(), 300);
    await click(button(page, "Tomorrow").first(), 300);
    await click(button(page, "+1 week").first(), 300);
    const actions = await s.calls("reminder");
    s.check("done, tomorrow and +1 week: three reminder calls", actions.length === 3);
    s.fact("reminder calls", actions.map(c => c.args));
    s.check("added one is listed", await hasText(page, "Parity reminder"));
  },

  async reminderUndo(s) {
    await s.load();
    const { page } = s;
    await click(nav(page).getByText("Reminders", { exact: true }), 300);
    await click(button(page, "Done").first(), 300);
    s.check("done toast", await waitText(page, "Done: Chase the client for the partner API keys"));
    s.check("done row gone", !(await hasText(page, "3 d overdue")));
    await click(button(page, "Undo"), 400);
    const added = await s.calls("reminder_add");
    s.check("undo writes it again with its date", added.length === 1 && added[0].args.date === "2026-09-28" && String(added[0].args.text).startsWith("Chase the client for the partner API keys"));
    s.check("back in the list", await waitText(page, "Chase the client for the partner API keys"));
    // a push is undone by pushing it back
    await click(button(page, "+1 week").first(), 300);
    await click(button(page, "Undo"), 400);
    const pushes = (await s.calls("reminder")).map(c => c.args);
    s.check("undo of a push pushes it back to its date", pushes.length === 3 && pushes[1].action === "push" && pushes[1].date === "+1w" && pushes[2].action === "push" && pushes[2].id === pushes[1].id && pushes[2].date === "2026-09-28");
    s.fact("reminder calls", pushes);
    s.fact("reminder_add", added.map(c => c.args));
  },

  async settings(s) {
    await s.load({ path: "/settings.html" });
    const { page } = s;
    const select = name => visible(page.getByRole("combobox").filter({ has: page.getByRole("option", { name, exact: true }) })).first();
    await click(visible(page.getByRole("radio", { name: "Dark", exact: true })).first(), 300);
    let saves = await s.calls("set_settings");
    s.check("theme saved dark", saves.at(-1)?.args.settings?.theme === "dark");
    s.check("theme applied to the window", (await s.calls("plugin:window|set_theme")).some(c => c.args.value === "dark" || c.args.theme === "dark"));
    await click(visible(page.getByRole("radio", { name: "Graphite", exact: true })).first(), 300);
    saves = await s.calls("set_settings");
    s.check("accent saved graphite", saves.at(-1)?.args.settings?.accent === "graphite");
    await click(navButton(page, "Integrations"), 300);
    await click(byText(page, "GitHub"), 300);
    const owners = page.getByPlaceholder("Empty is everywhere, e.g. weareantenna");
    await owners.fill("acme, globex");
    const save = visible(page.locator("*").filter({ has: owners }).filter({ has: button(page, "Save") }).last().getByRole("button", { name: "Save", exact: true })).first();
    await click(save, 300);
    saves = await s.calls("set_settings");
    s.check("owners saved", JSON.stringify(saves.at(-1)?.args.settings?.github ?? {}).includes("acme, globex") || JSON.stringify(saves.at(-1)?.args.settings?.github ?? {}).includes("globex"));
    await click(navButton(page, "General"), 300);
    const english = select("English");
    const dutch = await english.locator("option").evaluateAll(os => os.find(o => /nederlands|dutch/i.test(o.textContent))?.textContent ?? null);
    if (dutch) await english.selectOption({ label: dutch });
    await settle(page, 400);
    saves = await s.calls("set_settings");
    s.check("language saved nl", saves.at(-1)?.args.settings?.language === "nl");
    s.check("ui in Dutch", await waitText(page, "Integraties", 2000));
    s.fact("saved", saves.map(c => ({ language: c.args.settings?.language, theme: c.args.settings?.theme, accent: c.args.settings?.accent, github: c.args.settings?.github })));
  },

  // Agent access per extension: the vault's .relay/config.json `actions`, through action_config / set_action_config
  async agentAccess(s) {
    await s.load({ path: "/settings.html" });
    const { page } = s;
    await click(navButton(page, "Integrations"), 300);
    await click(byText(page, "Productive"), 400);
    s.check("actions listed", await waitText(page, "Create a task on a board."));
    await visible(page.locator("select#act-create_task")).first().selectOption({ label: "Runs" }).catch(() =>
      visible(page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "Runs", exact: true }) })).nth(1).selectOption({ label: "Runs" }));
    await settle(page, 300);
    let sets = await s.calls("set_action_config");
    s.check("a policy saved for the extension", sets.length === 1 && sets[0].args.ext === "productive" && sets[0].args.entry?.create_task === "auto" && sets[0].args.entry?.["*"] === "ask");
    await click(visible(page.getByRole("switch", { name: /Let the agent use Productive/ })).first(), 300);
    sets = await s.calls("set_action_config");
    s.check("access switched off", sets.length === 2 && sets[1].args.entry?.access === false);
    s.fact("entries", sets.map(c => c.args));
  },

  async cmdkProject(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("harb");
    await settle(page);
    s.check("a matching project listed", await hasText(page, "Harbor CRM"));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await settle(page, 300);
    s.check("Enter on a picked project sends nothing", (await s.calls("send")).length === 0);
    s.check("the project opens", (await s.local(["sel"])).sel !== s.keys.switchTo && (await hasText(page, "Contact sync testen op staging")));
    s.fact("sel", (await s.local(["sel"])).sel);
    s.fact("chat changes", await s.chatChanges());
  },

  // relay:// links: the one the app was launched with (get_current) and one while it runs (deep-link://new-url)
  async deepLinks(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo, link: "relay://ask" });
    const { page } = s;
    await settle(page, 300);
    s.check("relay://ask at launch opens Cmd-K", /ask a question/i.test((await focusedPlaceholder(page)) ?? ""));
    await page.keyboard.press("Escape");
    await settle(page);
    await page.evaluate(() => window.__harness.deepLink("relay://open?q=harbor"));
    await settle(page, 300);
    s.check("relay://open?q= opens the best match", await waitText(page, "Contact sync testen op staging"));
    s.fact("sel after open", (await s.local(["sel"])).sel);
    const text = "What is due today?";
    await page.evaluate(t => window.__harness.deepLink(`relay://ask?q=${encodeURIComponent(t)}`), text);
    s.check("relay://ask?q= sends", await s.waitCall("send"));
    await settle(page, 300);
    const sends = await s.calls("send");
    s.check("as a quick question in a new conversation", sends.length === 1 && sends[0].args.project === "new#1" && String(sends[0].args.text).endsWith(text));
    s.fact("chat changes", await s.chatChanges());
  },

  // what a fresh session ran on, when model and effort were left to the CLI (`resolved`): the pickers name it
  async resolvedDefaults(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const shown = () => page.evaluate(() => window.__dom.all("select").map(x => x.selectedOptions[0]?.textContent.trim()).filter(t => /default/i.test(t ?? "")));
    s.fact("pickers before", await shown());
    await page.evaluate(key => window.__harness.resolved(key), s.keys.switchTo);
    await settle(page);
    const after = await shown();
    s.check("model picker names the default", after.includes("Opus (default)"));
    s.check("effort picker names the default", after.includes("High (default)"));
    s.fact("pickers after", after);
    s.fact("localStorage", await s.local(["defaults.claude"]));
  },

  async slashCommands(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const asked = (await s.calls("agent_commands")).length;
    await typeInComposer(page, "/rev");
    await settle(page);
    s.check("the provider's commands complete", await hasText(page, "Review a pull request"));
    await page.keyboard.press("Tab");
    await settle(page);
    s.check("Tab takes the command", /^\/review\b/.test((await composerValue(page)) ?? ""));
    s.check("nothing sent", (await s.calls("send")).length === 0);
    s.fact("composer", await composerValue(page));
    s.fact("agent_commands after the load", asked);
  },

  async closeAll(s) {
    await s.load();
    const { page } = s;
    await click(visible(nav(page).getByText("GENERAL", { exact: true })));
    await nav(page).getByText("Northwind Portal", { exact: true }).first().click({ button: "right" });
    await settle(page);
    await click(byText(page, "Close all conversations"), 600);
    const changes = await s.chatChanges();
    const closed = Object.entries(changes).filter(([, c]) => c !== "removed" && c.closed);
    s.check("the project's conversations closed", closed.length === 4 && closed.every(([, c]) => c.project === "Northwind Portal"));
    s.check("each one's worktrees dropped", (await s.calls("drop_worktrees")).length === 4);
    s.fact("closed", closed.map(([k]) => k).sort());
    s.fact("stops", (await s.calls("stop")).length);
  },

  async typedDraft(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const text = "Unsent draft text";
    await typeInComposer(page, text);
    await settle(page);
    s.fact("typed", (await s.local(["typed"])).typed);
    await click(nav(page).getByText("Push the portal fix", { exact: true }), 300);
    s.check("other conversation has its own empty composer", (await composerValue(page)) === "");
    await click(nav(page).getByText("Invoice export columns", { exact: true }), 300);
    s.check("draft restored", (await composerValue(page)) === text);
    s.check("draft kept in localStorage typed", (await s.local(["typed"])).typed?.[s.keys.switchTo] === text);
    s.check("nothing sent", (await s.calls("send")).length === 0);
  },

  async typingOutside(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    s.fact("outside indicator", await waitText(page, "Still running outside the app", 3000));
    const text = "Typed while it runs outside";
    await typeInComposer(page, text);
    await page.keyboard.press("Enter");
    await settle(page, 400);
    const value = await composerValue(page);
    s.fact("composer after Enter", value);
    s.fact("send calls", (await s.calls("send")).length);
    s.fact("wait note shown", await hasText(page, "This turn still runs outside the app"));
    s.fact("typed", (await s.local(["typed"])).typed);
    // the expected behaviour; the Lit baseline loses the text (src/domain/chats/actions.ts takeText before the outside check)
    s.check("text not lost", value === text || ((await s.local(["typed"])).typed?.[s.keys.switchTo] ?? "") === text);
    s.check("no second process on the session", (await s.calls("send")).length === 0);
  },
};
const OVERRIDES = { typingOutside: { outside: "switchTo" } };
// a scenario that is allowed to fail on a frontend (known bug), shown but not counted
const KNOWN = {
  typingOutside: "Lit loses the text: takeText runs before the outside check (src/domain/chats/actions.ts)",
  mail: "Lit drops a link clicked in a mail: mailLinkClicked checks panel.open, the Mail view keeps the mail in panel.mailOpen (src/domain/mail.ts)",
};

// ---------- compare
function compare(a, b) {
  const A = JSON.parse(readFileSync(`${RESULTS}/behaviour-${a}.json`, "utf8"));
  const B = JSON.parse(readFileSync(`${RESULTS}/behaviour-${b}.json`, "utf8"));
  const line = c => `${c.cmd} ${JSON.stringify(c.args)}`;
  // a plain LCS diff of two lists of lines
  const diff = (x, y) => {
    const m = x.length, n = y.length, t = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && x[i] === y[j]) (out.push(`    ${x[i]}`), i++, j++);
      else if (j < n && (i === m || t[i][j + 1] >= t[i + 1][j])) out.push(`  + ${y[j++]}`);
      else out.push(`  - ${x[i++]}`);
    }
    return out;
  };
  let same = 0;
  const names = [...new Set([...Object.keys(A.scenarios), ...Object.keys(B.scenarios)])];
  console.log(`behaviour: ${a} (-) vs ${b} (+)\n`);
  for (const name of names) {
    const x = A.scenarios[name] ?? {}, y = B.scenarios[name] ?? {};
    const out = [];
    if (x.error || y.error) out.push(`  error: ${a}: ${x.error ?? "-"} | ${b}: ${y.error ?? "-"}`);
    for (const check of new Set([...Object.keys(x.checks ?? {}), ...Object.keys(y.checks ?? {})])) {
      const p = x.checks?.[check], q = y.checks?.[check];
      if (p !== q) out.push(`  check "${check}": ${a} ${p === undefined ? "-" : p ? "pass" : "FAIL"}, ${b} ${q === undefined ? "-" : q ? "pass" : "FAIL"}`);
    }
    const effects = diff((x.effects ?? []).map(line), (y.effects ?? []).map(line));
    if (effects.some(l => !l.startsWith("    "))) out.push("  effects:", ...effects.map(l => `  ${l}`));
    for (const fact of new Set([...Object.keys(x.facts ?? {}), ...Object.keys(y.facts ?? {})])) {
      const p = JSON.stringify(x.facts?.[fact]), q = JSON.stringify(y.facts?.[fact]);
      if (p !== q) out.push(`  fact "${fact}":\n    - ${p}\n    + ${q}`);
    }
    const reads = [];
    for (const r of new Set([...Object.keys(x.reads ?? {}), ...Object.keys(y.reads ?? {})])) if ((x.reads?.[r] ?? 0) !== (y.reads?.[r] ?? 0)) reads.push(`${r} ${x.reads?.[r] ?? 0}→${y.reads?.[r] ?? 0}`);
    if (reads.length) out.push(`  reads (info): ${reads.join(", ")}`);
    const status = sc => (sc.error ? "error" : `${Object.values(sc.checks ?? {}).filter(Boolean).length}/${Object.keys(sc.checks ?? {}).length}`);
    console.log(`${out.filter(l => !l.startsWith("  reads")).length ? "DIFF" : "same"}  ${name}  (${a} ${status(x)}, ${b} ${status(y)})`);
    if (out.length) console.log(out.join("\n"));
    if (!out.filter(l => !l.startsWith("  reads")).length) same++;
  }
  console.log(`\n${same}/${names.length} scenarios behave the same`);
}

// ---------- main
const cmp = process.argv.indexOf("--compare");
if (cmp > 0) {
  compare(process.argv[cmp + 1], process.argv[cmp + 2]);
} else {
  const label = arg("label", "current");
  const only = arg("only", "")?.split(",").filter(Boolean);
  const server = await startServer();
  const browser = await launch(arg("browser", "chromium"));
  const results = { label, url: server.url, scenarios: {} };
  for (const [name, run] of Object.entries(SCENARIOS)) {
    if (only?.length && !only.includes(name)) continue;
    const s = await session(browser, server.url, OVERRIDES[name]);
    let error;
    try {
      await run(s);
    } catch (e) {
      error = e.message.split("\n")[0];
      if (process.env.DEBUG) console.error(e.message);
    }
    const r = await s.result().catch(() => ({ checks: s.checks, effects: [], reads: {}, facts: s.facts }));
    if (error) r.error = error;
    const known = label.startsWith("lit") ? KNOWN[name] : undefined;
    if (known) r.known = known;
    results.scenarios[name] = r;
    await s.page.context().close();
    const failed = Object.entries(r.checks).filter(([, ok]) => !ok).map(([c]) => c);
    const tag = error ? "ERROR" : failed.length ? (known ? "KNOWN" : "FAIL ") : "ok   ";
    console.log(`${tag} ${name}  ${Object.keys(r.checks).length - failed.length}/${Object.keys(r.checks).length}${error ? `  ${error}` : ""}${failed.length ? `  failed: ${failed.join("; ")}` : ""}`);
  }
  mkdirSync(RESULTS, { recursive: true });
  // --only updates those scenarios in an existing result
  if (only?.length) {
    try {
      const old = JSON.parse(readFileSync(`${RESULTS}/behaviour-${label}.json`, "utf8"));
      results.scenarios = { ...old.scenarios, ...results.scenarios };
    } catch {
      /* no earlier result */
    }
  }
  writeFileSync(`${RESULTS}/behaviour-${label}.json`, JSON.stringify(results, null, 2) + "\n");
  console.log(`→ harness/results/behaviour-${label}.json`);
  await browser.close();
  await server.close();
  const bad = Object.values(results.scenarios).filter(r => !r.known && (r.error || Object.values(r.checks).some(ok => !ok)));
  process.exit(bad.length ? 1 : 0);
}
