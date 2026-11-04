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
const IGNORED = new Set([
  "pending",
  "subagents",
  "agent_history",
  "history_sid",
  "agents",
  "app_sids",
  "app_sessions",
  "running",
  "plugin:window|is_focused",
  "plugin:window|set_title",
]);
// reads: counted per command (integration GETs per path), order and count are informational
const READS = new Set([
  "get_settings",
  "ui_lang",
  "ui_locale",
  "vault_status",
  "snapshot",
  "vault_notes",
  "read_note",
  "project_icons",
  "project_repos",
  "agents_status",
  "agent_commands",
  "action_config",
  "integration_thumb",
  "plugin:deep-link|get_current",
  "chats",
  "chat_providers",
  "history",
  "usage_limits",
  "usage_tokens",
  "github_status",
  "github_prs",
  "github_pr",
  "mail_list",
  "mail_read",
  "calendar_meetings",
  "integration_status",
  "integration_has_token",
  "integration_mcp",
  "favicons",
  "find_icon_sites",
  "detect_vault",
  "check_vault",
  "plugin:window|theme",
  "find_notes",
  "note_times",
  "note_templates",
  "favourites",
  "note_rail",
  "note_touches",
]);
const isIgnored = c => IGNORED.has(c.cmd) || c.cmd.startsWith("plugin:event|");
const isRead = c => READS.has(c.cmd) || (c.cmd === "integration_call" && c.args.method === "GET");

// ---------- in the page, before the app: the IPC boundary, with optional changes to what the backend answers
// (outside: the conversation `key` has a turn running in a process the app did not start, as `agents` reports it;
// agents: changes to agents_status, `default` the default agent, `off` the providers switched off)
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
    if (overrides.agents && cmd === "agents_status") {
      const { default: def, off = [] } = overrides.agents;
      return {
        ...result,
        default: def ?? result.default,
        providers: result.providers.map(p => (off.includes(p.id) ? { ...p, on: false } : p)),
      };
    }
    if (overrides.outside && cmd === "agents") {
      const key = window.__harness.keys[overrides.outside];
      const sid = uuid(order.indexOf(key) + 101); // = harness/fixtures/conversations.ts sidOf
      return [
        ...result,
        {
          id: "outside-1",
          sessionId: sid,
          provider: "claude",
          kind: "interactive",
          status: "busy",
          name: "",
          startedAt: new Date().toISOString(),
        },
      ];
    }
    return result;
  };
  const internals = (window.__TAURI_INTERNALS__ ??= {});
  Object.defineProperty(internals, "invoke", {
    configurable: true,
    get: () => real && wrapped,
    set: fn => (real = fn),
  });
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
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map(k => [/^c:[0-9a-z]+$/.test(k) ? key(k) : k, norm(v[k])]),
      );
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
    const calls = await page
      .evaluate(() => window.__harness?.calls.map(c => ({ cmd: c.cmd, args: c.args })) ?? [])
      .catch(() => []);
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
      const info = await page.evaluate(() => ({
        chats: JSON.parse(localStorage.getItem("chats") || "{}"),
        keys: window.__harness.keys,
        n: window.__harness.calls.length,
      }));
      seeded = info.chats;
      labels = Object.fromEntries(
        Object.entries(info.chats).map(([k, c]) => [k, `chat:${c.project ?? "-"}/${c.title}`]),
      );
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
      const all = await page.evaluate(
        from => window.__harness.calls.slice(from).map(c => ({ cmd: c.cmd, args: c.args })),
        page.__from,
      );
      return all.filter(c => !isIgnored(c) && (!cmd || c.cmd === cmd)).map(c => ({ cmd: c.cmd, args: norm(c.args) }));
    },
    /** wait until `cmd` was called `n` times in this load */
    async waitCall(cmd, n = 1, timeout = 4000) {
      const ok = await page
        .waitForFunction(
          ({ cmd, n, from }) => window.__harness.calls.slice(from).filter(c => c.cmd === cmd).length >= n,
          { cmd, n, from: page.__from },
          { timeout },
        )
        .then(
          () => true,
          () => false,
        );
      return ok;
    },
    /** localStorage keys whose value changed since `before` (a local([]) taken earlier: every key), chats and polls left out */
    async localChanges(before) {
      const now = await s.local([]);
      return Object.fromEntries(
        Object.entries(now).filter(
          ([k, v]) => !["chats", "sel", "typed"].includes(k) && JSON.stringify(v) !== JSON.stringify(before[k]),
        ),
      );
    },
    async local(keys) {
      // no keys: every key
      return page.evaluate(
        keys =>
          Object.fromEntries(
            (keys.length ? keys : Object.keys(localStorage)).map(k => {
              const v = localStorage.getItem(k);
              let p = v;
              try {
                p = v == null ? null : JSON.parse(v);
              } catch {
                /* a plain string */
              }
              return [k, p];
            }),
          ),
        keys,
      );
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
        const name =
          c.cmd === "integration_call"
            ? `integration_call GET ${String(c.args.path).split("?")[0].replace(/\/\d+/g, "/:id")}`
            : c.cmd;
        reads[name] = (reads[name] || 0) + 1;
      }
      return { checks: s.checks, effects, reads: Object.fromEntries(Object.entries(reads).sort()), facts: s.facts };
    },
  };
  return s;
}

// ---------- DOM helpers: visible text, roles, the composer
const hasText = (page, text) => page.evaluate(t => window.__dom.hasText(t), text);
const waitText = (page, text, timeout = 5000) =>
  page
    .waitForFunction(t => window.__dom.hasText(t), text, { timeout })
    .then(
      () => true,
      () => false,
    );
const visible = locator => locator.locator("visible=true");
const composer = page => visible(page.locator("textarea")).last();
const composerValue = page =>
  composer(page)
    .inputValue({ timeout: 2000 })
    .catch(() => null);
const click = async (locator, ms = 150) => {
  await visible(locator).first().click({ timeout: 4000 });
  await settle(locator.page(), ms);
};
const byText = (page, text) => page.getByText(text, { exact: true });
const nav = page => page.getByRole("navigation").first();
const navHas = async (page, text) => (await visible(nav(page).getByText(text, { exact: true })).count()) > 0;
// the Beacon Billing spec open in Pages (fixture kb): where the Changes pill is
const openBilling = async s => {
  const { page } = s;
  const billing = "Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md";
  await click(page.getByRole("tab", { name: /^Pages/ }));
  await click(page.locator('[data-project="Beacon Billing"]'));
  await click(page.locator('[data-folder="Contexts/Agency/Projects/Beacon Billing/Documents"]'));
  await click(page.locator(`[data-page="${billing}"]`).first());
  await waitText(page, "Billing Spec");
  return { billing, findings: "Contexts/Agency/Projects/Northwind Portal/Documents/Rate limit findings.md" };
};
const button = (page, name) => page.getByRole("button", { name, exact: true });
/** a visible element whose whole text is `text` (a mail row's subject, not a longer subject that contains it) */
const listed = async (page, text) => (await visible(byText(page, text)).count()) > 0;
/** a settings section in the window's sidebar, by its name */
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
  // the Pages tab's virtual groups (#367): a project's linked notes, Show all, a click opens the note at its own place,
  // and a flat project (its note alone) unfolds to its groups too
  async linked(s) {
    await s.load({ fixture: "linked" });
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    s.check("linked here shows", await waitText(page, "linked here"));
    const group = page.locator('[data-linked-group="meetings"]');
    s.check("the group counts 6 meetings", (await group.textContent())?.includes("6") ?? false);
    await group.click();
    const rows = page.locator('[data-linked] [data-page^="Calendar/Meetings/"]');
    s.check("the newest 4 show first", (await rows.count()) === 4);
    // Show all opens the collection (#373): Meetings about the project, 6 rows, the about: chip, no other project's
    await page.getByText("Show all 6").click();
    s.check("Show all opens the Meetings collection", await waitText(page, "6 match this view"));
    s.check(
      "filtered on the group's own rule for Northwind Portal",
      ((await page.locator('[data-filter="linked"]').textContent()) ?? "").includes("Northwind Portal"),
    );
    const titles = page.locator('[role="row"] [data-cell="title"]');
    s.check("it lists all 6, as many as the group counts", (await titles.count()) === 6);
    s.check(
      "among them the meeting that points at the project through context: only",
      (await page.locator('[data-cell="title"]', { hasText: "Northwind Portal design review" }).count()) === 1,
    );
    s.check(
      "another project's meeting is not among them",
      (await page.locator('[data-cell="title"]', { hasText: "Atlas Logistics sync" }).count()) === 0,
    );
    await rows.first().click();
    await page.locator("[data-breadcrumb]").waitFor();
    s.check(
      "the note opens at its own place",
      (await page.locator("[data-breadcrumb]").textContent()) === "CalendarMeetings2026",
    );
    // a flat project: no folder, only its note
    await page.locator('[data-project="Delmas Bakery"]').click();
    s.check("a flat project unfolds to its groups", await waitText(page, "linked here"));
    const flat = page.locator(
      '[data-linked="Contexts/Agency/Projects/Delmas Bakery.md"] [data-linked-group="meetings"]',
    );
    s.check("with its 2 meetings", (await flat.textContent())?.includes("2") ?? false);
  },
  // collections (#373, K8): Meetings in a context lists every type: Meeting note with that context:, a filter about:
  // narrows it, editing the about: cell writes only that note's frontmatter, and a saved view comes back after a restart
  async collectionTable(s) {
    const kb = { fixture: "linked-collections", keep: true };
    await s.load(kb);
    const { page } = s;
    const note = p => page.evaluate(x => window.__harness.noteText(x), p);
    const open = async (collection, context = "Agency") => {
      await page.getByRole("tab", { name: /^Pages/ }).click();
      const folder = page.locator(`[data-collections="${context}"]`);
      if (!(await folder.locator(`[data-collection="${collection}"]`).count()))
        await click(folder.getByRole("button", { name: "Collections" }).or(folder.locator("[aria-expanded]").first()));
      await click(folder.locator(`[data-collection="${collection}"]`));
    };
    await open("meetings");
    s.check("the Meetings collection opens", await waitText(page, "9 match this view"));
    s.check("in the context", await hasText(page, "in Agency"));
    const titles = page.locator('[role="row"] [data-cell="title"]');
    s.check("it lists the 9 meetings with context: Agency, no thread or person", (await titles.count()) === 9);
    // filter about: Northwind Portal
    await click(button(page, "+ Filter"));
    await click(page.getByRole("option", { name: "about" }));
    await page.getByRole("combobox", { name: "about" }).fill("Northwind Portal"); // an input with a list is a combobox
    await page.keyboard.press("Enter");
    s.check(
      "the about: filter narrows it to 5 (the sixth links through context: only)",
      (await waitText(page, "5 match this view")) && (await titles.count()) === 5,
    );
    s.check(
      "Followed up has its column, set on two meetings",
      (await hasText(page, "Followed up")) && (await page.getByText("✓ Mail drafted").count()) === 2,
    );
    s.check(
      "the chip is there",
      ((await page.locator('[data-filter="about"]').textContent()) ?? "").includes("Northwind Portal"),
    );
    // editing the about: cell writes that note's frontmatter and nothing else
    const file = "Calendar/Meetings/2026/2026-10-08 Northwind Portal sync.md";
    const before = await note(file);
    const cell = page
      .locator('[role="row"]', { hasText: "2026-10-08 Northwind Portal sync" })
      .locator('[data-cell="about"]');
    await click(cell.locator("div").first());
    s.check(
      "the cell opens a listbox of projects, the link ticked",
      await waitText(page, "Writes about: in 2026-10-08 Northwind Portal sync.md"),
    );
    s.check(
      "with the one linked ticked",
      (await page.getByRole("option", { name: /^N\s*Northwind Portal/ }).getAttribute("aria-selected")) === "true",
    );
    await click(page.getByRole("option", { name: /Atlas Logistics/ }));
    await settle(page, 300);
    const writes = await s.calls("write_note");
    const after = await note(file);
    s.check("one write_note, to that note", writes.length === 1 && writes[0].args.target === file);
    s.check(
      "only the about: line changed, every other byte kept",
      after === before.replace('about: "[[Northwind Portal]]"', 'about: "[[Atlas Logistics]]"') && after !== before,
    );
    s.check("it left the filtered table", (await titles.count()) === 4);
    // sort and save the view
    await click(page.getByRole("button", { name: /^Sort / }));
    await click(page.getByRole("option", { name: "Title" }));
    await click(button(page, "Save view"));
    await page.getByRole("textbox", { name: "View name" }).fill("Portal meetings");
    await click(button(page, "Save"));
    await settle(page, 200);
    const saved = await s.calls("view_save");
    s.check(
      "Save view writes the view with its filter and sort",
      saved.length === 1 &&
        saved[0].args.name === "Portal meetings" &&
        saved[0].args.view.filters[0].is === "Northwind Portal" &&
        saved[0].args.view.sort.key === "title",
    );
    s.check("its file is named", await hasText(page, ".relay/views/Portal meetings.json"));
    await settle(page, 500);
    // restart: the saved view reopens with its filter and sort
    await s.load(kb);
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await click(page.locator("[data-saved-views] [aria-expanded]").first());
    await click(page.locator('[data-saved-view="Portal meetings"]'));
    s.check("the saved view reopens with its about: filter", await waitText(page, "Northwind Portal"));
    s.check(
      "and its sort",
      (await button(page, "Sort Title ↓").count()) === 1 && (await page.locator('[data-filter="about"]').count()) === 1,
    );
    // a note that was not meant to be touched stays as it was
    s.check(
      "the other meeting notes are untouched",
      (await note("Calendar/Meetings/2026/2026-09-24 Northwind Portal sync.md")).includes(
        'about: "[[Northwind Portal]]"',
      ),
    );
  },

  // collections (#373, K9): Projects by status as a board; dragging a card to a lane writes status: and only that line;
  // a meeting's stage is derived, so its board has no moves
  async collectionBoard(s) {
    await s.load({ fixture: "linked-collections" });
    const { page } = s;
    const note = p => page.evaluate(x => window.__harness.noteText(x), p);
    await page.getByRole("tab", { name: /^Pages/ }).click();
    const folder = page.locator('[data-collections="Agency"]');
    await click(folder.locator("[aria-expanded]").first());
    await click(folder.locator('[data-collection="projects"]'));
    await waitText(page, "match this view");
    await click(page.getByRole("tab", { name: "Board" }));
    const lane = name => page.locator(`[data-lane="${name}"]`);
    s.check(
      "the board has the lanes of status:",
      (await lane("Active").count()) === 1 && (await lane("Paused").count()) === 1,
    );
    const card = "Contexts/Agency/Projects/Atlas Logistics/Atlas Logistics.md";
    const before = await note(card);
    s.check("Atlas Logistics is Active", (await lane("Active").locator(`[data-card="${card}"]`).count()) === 1);
    const from = await page.locator(`[data-card="${card}"]`).boundingBox();
    const to = await lane("Paused").boundingBox();
    await page.mouse.move(from.x + 20, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 40, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 8 });
    s.check("a card in the air says where it lands", await waitText(page, "Drop to set status: Paused"));
    await page.mouse.up();
    await settle(page, 300);
    const writes = await s.calls("write_note");
    const after = await note(card);
    s.check("one write_note for that note", writes.length === 1 && writes[0].args.target === card);
    s.check(
      "status: is Paused and nothing else changed, the comment and the keys after it as they were",
      after === before.replace("status: Active", "status: Paused") && after.includes("# kept as written\npriority: 2"),
    );
    s.check("the card is in the Paused lane", (await lane("Paused").locator(`[data-card="${card}"]`).count()) === 1);
    // a meeting's stage: derived, no moves
    await page.locator("[data-collections]").first().locator('[data-collection="meetings"]').click();
    await click(page.getByRole("tab", { name: "Board" }));
    s.check("the stage lanes", (await lane("planned").count()) === 1 && (await lane("wrapped").count()) === 1);
    s.check("the board says its cards do not move", await hasText(page, "Stage is worked out from each note"));
    const meet = page.locator('[data-card^="Calendar/Meetings/"]').first();
    const mb = await meet.boundingBox();
    const wb = await lane("wrapped").boundingBox();
    await page.mouse.move(mb.x + 20, mb.y + 20);
    await page.mouse.down();
    await page.mouse.move(wb.x + wb.width / 2, wb.y + 40, { steps: 8 });
    await page.mouse.up();
    await settle(page, 300);
    s.check("dragging a meeting card writes nothing", (await s.calls("write_note")).length === 1);
  },

  // files inside a page (#368, K4): an image, a PDF, audio and a section of a note drawn in place of their markdown; a
  // screenshot pasted, files dropped (with the insertion line) and a 312 MB one refused with the toast
  async embeds(s) {
    await s.load({ fixture: "embeds" });
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    s.check("the page opens", await waitText(page, "Next: confirm the window"));
    const image = page.locator('.cm-embed[data-kind="image"] img').first();
    await image.waitFor({ timeout: 4000 });
    s.check("the picture loads", await image.evaluate(i => i.complete && i.naturalWidth > 0));
    s.check("its width is the |560", (await image.evaluate(i => Math.round(i.parentElement.clientWidth))) === 560);
    s.check(
      "its caption is the alt text",
      ((await page.locator(".cm-embed-caption").first().textContent()) ?? "").includes(
        "Configurator traffic, last 7 days",
      ),
    );
    const content = await page.locator(".cm-content").innerText();
    s.check("no embed markdown shows", !content.includes("![[") && !content.includes("|560"));
    const card = page.locator('.cm-embed[data-kind="pdf"]');
    const cardText = (await card.textContent()) ?? "";
    s.check(
      "the PDF is a card with its name, pages and size",
      cardText.includes("Hosting quote cluster 2026.pdf") && cardText.includes("6 pages") && /1[.,]2 MB/.test(cardText),
    );
    await card.getByRole("button", { name: "Open" }).click();
    s.check(
      "Open opens the PDF from where it is",
      (await s.calls("open_file")).some(c =>
        String(c.args.path).endsWith("Attachments/2026/Hosting quote cluster 2026.pdf"),
      ),
    );
    const player = page.locator('.cm-embed[data-kind="audio"]');
    await player.getByRole("button", { name: "Play" }).click();
    s.check(
      "the audio plays",
      await page
        .waitForFunction(() => document.querySelector(".cm-embed-audio audio")?.currentTime > 0.2, null, {
          timeout: 4000,
        })
        .then(
          () => true,
          () => false,
        ),
    );
    await player.getByRole("button", { name: "Pause" }).click();
    s.check("with its clock", ((await player.textContent()) ?? "").includes("/ 0:32"));
    const note = page.locator('.cm-embed[data-kind="note"]');
    const noteText = (await note.textContent()) ?? "";
    s.check(
      "an embedded section shows only that section",
      noteText.includes("60 requests per minute") &&
        !noteText.includes("An API key per client") &&
        !noteText.includes("retried twice"),
    );
    // the picture selected: a ring and two handles; dragging one writes |<width>
    await image.click();
    s.check(
      "a click selects the picture",
      (await page.locator(".cm-embed-selected .cm-embed-grip-right").count()) === 1,
    );
    const grip = await page.locator(".cm-embed-grip-right").boundingBox();
    await page.mouse.move(grip.x + 3, grip.y + 14);
    await page.mouse.down();
    await page.mouse.move(grip.x - 197, grip.y + 14, { steps: 6 });
    await page.mouse.up();
    await page
      .waitForFunction(() => /\|360\]\]/.test(window.__harness.written() ?? ""), null, { timeout: 4000 })
      .catch(() => {});
    s.check(
      "the width handle writes |360",
      /\|a?[^|\]]*\|360\]\]/.test((await page.evaluate(() => window.__harness.written())) ?? ""),
    );
    // a screenshot pasted at the end of the page
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.evaluate(() => {
      const png = Uint8Array.from(
        atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
        c => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([png], "image.png", { type: "image/png" }));
      document
        .querySelector(".cm-content")
        .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const stamped = /^Pasted image \d{14}\.png$/;
    await page.waitForFunction(() => window.__harness.attached().length > 0, null, { timeout: 4000 });
    s.check(
      "a pasted screenshot is saved as Pasted image <stamp>.png",
      (await page.evaluate(() => window.__harness.attached())).every(a => stamped.test(a.name)),
    );
    await page
      .waitForFunction(() => /!\[\[Pasted image \d{14}\.png\]\]/.test(window.__harness.written() ?? ""), null, {
        timeout: 4000,
      })
      .catch(() => {});
    s.check(
      "and embedded where the cursor was",
      /!\[\[Pasted image \d{14}\.png\]\]\s*$/.test((await page.evaluate(() => window.__harness.written())) ?? ""),
    );
    s.check("it shows as a picture", (await page.locator('.cm-embed[data-kind="image"]').count()) === 2);
    // files hovering: the insertion line between two lines, then dropped there
    const target = await page.locator('.cm-embed[data-kind="pdf"]').boundingBox();
    const at = { x: target.x + 40, y: target.y + 4 };
    await page.evaluate(
      ([paths, at]) => window.__harness.dropHover(paths, at),
      [["/Users/me/Downloads/dealer-portal-error.png"], at],
    );
    const mark = page.locator(".cm-file-drop");
    s.check(
      "the drop shows its line and what happens",
      (await mark.isVisible()) && ((await mark.textContent()) ?? "").includes("Copy to Attachments/2026 and embed"),
    );
    await page.evaluate(
      ([paths, at]) => window.__harness.dropPaths(paths, at),
      [["/Users/me/Downloads/dealer-portal-error.png"], at],
    );
    await page
      .waitForFunction(() => /dealer-portal-error\.png/.test(window.__harness.written() ?? ""), null, { timeout: 4000 })
      .catch(() => {});
    const written = (await page.evaluate(() => window.__harness.written())) ?? "";
    s.check(
      "a drop is embedded on its own line before the line it landed on",
      /!\[\[dealer-portal-error\.png\]\]\n!\[\[Hosting quote cluster 2026\.pdf\]\]/.test(written),
    );
    s.check("the line is gone after the drop", !(await mark.isVisible()));
    // 312 MB: refused, the toast says so, nothing is embedded
    await page.evaluate(() => window.__harness.dropPaths(["/Users/me/Downloads/configurator-db-dump.sql.gz"]));
    s.check("a file over 25 MB gets the toast", await waitText(page, "Too large: 25 MB max per file"));
    s.check(
      "and no embed",
      !((await page.evaluate(() => window.__harness.written())) ?? "").includes("configurator-db-dump"),
    );
    // Open on the section: the note opens with the cursor on its heading
    await note.getByRole("button", { name: "Open" }).click();
    s.check("Open shows the note", await waitText(page, "retried twice"));
    const opened = await page.locator(".cm-content").innerText();
    s.check("at the section's heading", opened.includes("## Rate limits"));
  },
  async send(s) {
    await s.load(); // a first load reads the fixture keys
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const text = "Parity check: what is still open?";
    await typeInComposer(page, text);
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    const sends = await s.calls("send");
    // the first message of a project conversation tells the agent the project (the backend puts the line in front)
    s.check(
      "send once, to this conversation, with the text",
      sends.length === 1 &&
        sends[0].args.project === "chat:Northwind Portal/Invoice export columns" &&
        sends[0].args.text === text,
    );
    s.check("the agent is told the project", sends[0]?.args.told === "Northwind Portal");
    s.check("composer cleared", (await composerValue(page)) === "");
    s.check("message shown", await waitText(page, text));
    s.check("no Done before the turn ends", !(await hasText(page, "Done")));
    await page.evaluate(
      key => window.__harness.stream({ key, deltas: 6, tokensPerDelta: 3, ratePerSecond: 0 }),
      s.keys.switchTo,
    );
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
    s.fact(
      "stops",
      (await s.calls("stop")).map(c => c.args),
    );
  },

  async cards(s) {
    await s.load();
    await s.load({ sel: s.keys.permission });
    const { page } = s;
    s.check("permission card shown", await waitText(page, "push origin fix/portal-redirect"));
    await click(button(page, "Allow"), 300);
    s.check("answer called", await s.waitCall("answer"));
    const perm = await s.calls("answer");
    s.check(
      "permission answered once with allow",
      perm.length === 1 && perm[0].args.id === "perm-0001" && perm[0].args.decision?.behavior === "allow",
    );
    await settle(page, 900); // a pending poll
    s.check("permission card gone", (await visible(button(page, "Allow")).count()) === 0);
    s.fact("allowed line", await hasText(page, "Allowed"));
    await s.load({ sel: s.keys.question });
    s.check("question card shown", await waitText(page, "Which sync strategy should the contact import use?"));
    await click(button(page, "Incremental"));
    s.check("the picked option's preview shows", await waitText(page, "updated_at > cursor"));
    await page.getByPlaceholder("Note on your choice…").first().fill("Keep the nightly full run as a fallback");
    await click(button(page, "Client PM"));
    await click(button(page, "Dev team"));
    await click(button(page, "Answer"), 300);
    s.check("question answered", await s.waitCall("answer"));
    const ask = await s.calls("answer");
    s.check("question answered once", ask.length === 1 && ask[0].args.id === "ask-0001");
    s.fact("question answers", ask[0]?.args.decision?.updatedInput?.answers ?? null);
    const annotations =
      ask[0]?.args.decision?.updatedInput?.annotations?.["Which sync strategy should the contact import use?"];
    s.check(
      "the answer carries the picked preview and the note",
      annotations?.preview?.includes("updated_at > cursor") &&
        annotations?.notes === "Keep the nightly full run as a fallback",
    );
    await settle(page, 900);
    s.check("question card gone", (await visible(button(page, "Answer")).count()) === 0);
    // an agent action (`relay`) asks with the same card
    await s.load({ sel: s.keys.action });
    s.check("action card shown", await waitText(page, "relay productive.create_task"));
    await click(button(page, "Deny"), 300);
    const act = await s.calls("answer");
    s.check(
      "action denied once",
      act.length === 1 && act[0].args.id === "act-0001" && act[0].args.decision?.behavior === "deny",
    );
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
    s.check(
      "send to a new conversation",
      sends.length === 1 && sends[0].args.project === "new#1" && String(sends[0].args.text).endsWith(text),
    );
    const changes = await s.chatChanges();
    const created = Object.values(changes).filter(c => c !== "removed");
    // Cmd-K always starts a general conversation and only offers the named project (e5c162bc)
    s.check(
      "new general conversation (no project, not a draft)",
      created.length === 1 && created[0].project === null && !created[0].draft,
    );
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
    s.check(
      "send to a new general conversation",
      sends.length === 1 && sends[0].args.project === "new#1" && String(sends[0].args.text).endsWith(text),
    );
    s.fact("text sent", sends[0]?.args.text);
    const changes = await s.chatChanges();
    const created = Object.values(changes).filter(c => c !== "removed");
    s.check(
      "one new general conversation, not a draft",
      created.length === 1 && created[0].project === null && !created[0].draft,
    );
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
    s.check(
      "its worktrees dropped once",
      dropped.length === 1 && dropped[0].args.project === "chat:Northwind Portal/Invoice export columns",
    );
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
    s.check(
      "dragged section order saved",
      Array.isArray(order) &&
        order.includes("Personal") &&
        (!order.includes("Agency") || order.indexOf("Personal") < order.indexOf("Agency")),
    );
    s.fact("secOrder", order);
    await click(head("AGENCY"));
    s.check("section open again", await navHas(page, "Push the portal fix"));
    const search = page.getByPlaceholder(/^Search in /);
    await search.fill("Harbor");
    await settle(page);
    s.check("search keeps the match", await navHas(page, "Contact sync strategy"));
    s.check("search hides the rest", !(await navHas(page, "Push the portal fix")));
    await search.fill("");
    await settle(page);
    s.check("search cleared shows all", await navHas(page, "Push the portal fix"));
    s.fact("localStorage", await s.local(["collapsed", "secOrder", "projOrder", "convOrder"]));
  },

  // one workspace at a time (PR #294): ⌃2 shows the side vault's, the footer's menu brings Personal back; the choice
  // stays out of the settings, which the settings window saves whole
  async workspaces(s) {
    await s.load({ fixture: "shared" });
    const { page } = s;
    s.check("Personal shows the main vault's conversations", await navHas(page, "Push the portal fix"));
    await page.keyboard.press("Control+Digit2");
    await settle(page);
    s.check("⌃2 shows the side vault", (await page.getByPlaceholder("Search in Side vault").count()) === 1);
    s.check("the main vault's conversations hidden", !(await navHas(page, "Push the portal fix")));
    const stored = async () =>
      (await s.calls("ui_state_set")).filter(c => c.args.key === "workspace").map(c => JSON.parse(c.args.value));
    await page.waitForTimeout(400); // the UI state is written a quarter second after the last change
    s.check("kept in the UI state", (await stored()).at(-1) === "/Users/me/Side vault");
    s.check(
      "not saved in the settings",
      (await s.calls("set_settings")).every(c => !JSON.stringify(c.args).includes('"workspace"')),
    );
    await page.evaluate(() => window.__harness.emit("menu", "new-general"));
    await settle(page);
    s.check(
      "a new general conversation runs in it",
      ((await page.getByRole("button", { name: "Runs in" }).first().textContent()) ?? "").includes("Side vault"),
    );
    await click(page.getByRole("button", { name: /^Switch workspace/ }));
    await click(page.getByRole("menuitemradio", { name: /Personal/ }));
    s.check("Personal again from the menu", await navHas(page, "Push the portal fix"));
    await page.waitForTimeout(400);
    s.check("Personal stored as none", (await stored()).at(-1) === "");
  },

  // the workspaces stay apart: a page open in Personal is put away by ⌃2 (Today shows) and comes back with ⌃1
  async workspacesApart(s) {
    await s.load({ fixture: "shared" });
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').first().click();
    await settle(page);
    const editor = () => page.locator(".cm-content").count();
    s.check("the page opens in Personal", (await editor()) === 1);
    await page.keyboard.press("Control+Digit2");
    await settle(page);
    s.check("⌃2 puts it away", (await editor()) === 0);
    s.check("and shows Today", (await s.local(["sel"])).sel === "__wait");
    await page.keyboard.press("Control+Digit1");
    await settle(page);
    s.check("⌃1 opens it again", (await editor()) === 1);
  },

  // a project moved to another workspace takes its conversations along: they show under it there
  // one conversation moved to another workspace from its menu: it shows there, as a general conversation
  async chatmigrate(s) {
    await s.load({ fixture: "shared" });
    const { page } = s;
    await nav(page).getByText("Billing sync double balances", { exact: true }).first().click({ button: "right" });
    await click(page.getByRole("button", { name: "Side vault", exact: true }).first());
    s.check("done", await waitText(page, "Moved to Side vault"));
    const run = (await s.calls("move_chat_workspace")).at(-1);
    s.check("move_chat_workspace to the side vault", run?.args.to === "/Users/me/Side vault");
    s.check("gone from Personal", !(await navHas(page, "Billing sync double balances")));
    await page.keyboard.press("Control+Digit2");
    await settle(page);
    s.check("it shows in the side vault", await navHas(page, "Billing sync double balances"));
  },

  async migrate(s) {
    await s.load({ fixture: "shared" });
    const { page } = s;
    await click(nav(page).getByText("GENERAL", { exact: true })); // folded, so the project's menu fits
    await nav(page).getByText("Beacon", { exact: true }).first().click({ button: "right" });
    await click(page.getByRole("button", { name: "Side vault", exact: true }).first());
    s.check("the dialog says the conversations go along", await waitText(page, "go along and continue there"));
    await click(page.getByRole("button", { name: "Move", exact: true }));
    s.check(
      "migrate_project moved it",
      await page
        .waitForFunction(() => window.__harness.calls.some(c => c.cmd === "migrate_project" && !c.args.dry), null, {
          timeout: 4000,
        })
        .then(
          () => true,
          () => false,
        ),
    );
    await settle(page);
    const run = (await s.calls("migrate_project")).find(c => !c.args.dry);
    s.check("a move", run?.args.mode === "move");
    s.check(
      "the started conversations are sent along",
      (run?.args.chats ?? []).some(c => c.title === "Prepare the client call"),
    );
    s.check("done", await waitText(page, "Moved to Side vault"));
    s.check("gone from Personal", !(await navHas(page, "Billing sync double balances")));
    await page.keyboard.press("Control+Digit2");
    await settle(page);
    s.check("the project shows in the side vault", await navHas(page, "Beacon Billing"));
    s.check("its conversations show under it there", await navHas(page, "Billing sync double balances"));
  },

  // a page's history (ticket 10): the versions listed with who made them, the oldest picked shows what changed since,
  // and Restore makes it the page's text again
  async pageHistory(s) {
    await s.load();
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText(page, "Stand van zaken");
    await click(page.getByRole("button", { name: "History", exact: true }));
    s.check("three versions with their authors", await waitText(page, "Ben Lauwers"));
    s.check("what made one is said", await hasText(page, "on disk"));
    await click(page.getByRole("button", { name: /^Ana Vos.*disk/ }));
    s.check("the diff shows with Restore", await waitText(page, "Restore this version"));
    await click(page.getByRole("button", { name: "Restore this version" }));
    const restore = (await s.calls("page_restore")).pop();
    s.check(
      "restore was asked for the oldest version",
      !!restore?.args.text && /Stand van zaken/.test(restore.args.text),
    );
    s.check("the toast says so", await waitText(page, "Restored the version of"));
    const now = await page.evaluate(() => window.__harness.written());
    s.check("the page's note holds that version", now === restore?.args.text);
  },

  // comments on a page (ticket 11): a word selected gets a comment, the thread a reply, then it is resolved
  async pageComments(s) {
    await s.load();
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await waitText(page, "Stand van zaken");
    await click(page.getByRole("button", { name: "Comments", exact: true }));
    s.check("the threads load", await waitText(page, "Is this still the first thing to do?"));
    s.check("the commented text is marked in the page", (await page.locator(".cm-comment").count()) > 0);
    await page.locator(".cm-content").getByText("Second open loop").dblclick();
    await click(page.getByRole("button", { name: "Comment", exact: true }));
    await page.getByPlaceholder("Add a comment…").fill("Who picks this up?");
    await click(page.getByRole("button", { name: "Comment", exact: true }).last());
    const made = (await s.calls("page_comment")).pop();
    s.check(
      "a comment on the selection was made",
      made?.args.kind === "comment" && /Second|open|loop/.test(made.args.quote),
    );
    s.check("it shows as a thread", await waitText(page, "Who picks this up?"));
    await click(page.getByRole("button", { name: "Reply", exact: true }).last());
    await page.getByPlaceholder("Reply…").fill("Ben does");
    await click(page.getByRole("button", { name: "Reply", exact: true }).last());
    s.check("the reply shows", await waitText(page, "Ben does"));
    await click(page.getByRole("button", { name: "Resolve", exact: true }).last());
    s.check("resolved goes under Resolved", await waitText(page, "Resolved (2)"));
    s.check(
      "the note's file is untouched by comments",
      !(await s.calls("write_note")).some(c => /Who picks this up/.test(c.args.text)),
    );
  },

  // ticket 12: @ names a member in a comment; the team workspace's Inbox counts a thread that mentions you, opens its
  // page on it, and resolving it there takes it out
  async pageMentions(s) {
    await s.load({ fixture: "shared" });
    const { page } = s;
    await page.evaluate(() => window.__harness.teamComments());
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Northwind Portal"]').first());
    await click(page.getByRole("button", { name: "Comments", exact: true }));
    await waitText(page, "Is this still the first thing to do?");
    await page.locator(".cm-content").getByText("Second open loop").dblclick();
    await click(page.getByRole("button", { name: "Comment", exact: true }));
    await page.getByPlaceholder("Add a comment… @ names a member").pressSequentially("Over to you @Be");
    s.check(
      "@ lists the members by what is typed",
      await page.getByRole("option", { name: "@Ben Lauwers" }).isVisible(),
    );
    await page.keyboard.press("Enter");
    await click(page.getByRole("button", { name: "Comment", exact: true }).last());
    const made = (await s.calls("page_comment")).pop();
    s.check("the comment carries who it mentions", JSON.stringify(made?.args.mentions) === '["bbbbbbbbbbbbbbbb"]');
    s.check("the text names them", /@Ben Lauwers/.test(made?.args.text ?? ""));
    await page.keyboard.press("Control+Digit3");
    await click(page.getByRole("button", { name: /^Switch workspace/ }));
    const inbox = page.getByRole("button", { name: /^Inbox/ });
    s.check("the Inbox counts the thread that mentions you", (await inbox.textContent())?.trim() === "Inbox1");
    await click(inbox);
    await click(page.getByRole("button", { name: /Northwind Portal/ }).first());
    s.check("its page opens on that thread", await waitText(page, "Is this still the first thing to do?"));
    await click(page.getByRole("button", { name: "Resolve", exact: true }).first());
    await click(page.getByRole("button", { name: /^Switch workspace/ }));
    s.check(
      "resolving takes it out of the Inbox",
      await page
        .getByRole("button", { name: /^Inbox$/ })
        .waitFor({ timeout: 3000 })
        .then(
          () => true,
          () => false,
        ),
    );
  },

  // managing files in the Pages tab (ticket 5): a new page opens, a rename says how many links follow and the tree
  // follows it, a page in the trash comes back with Undo
  // Files is experimental and off by default: no tab row, no page view; switching it on shows the tabs without a
  // restart, switching it off again takes them and the open page away
  async filesSwitch(s) {
    await s.load({ fixture: "files-off" });
    const { page } = s;
    const tabs = () => page.getByRole("tab", { name: /^Pages/ }).count();
    s.check("off: no Pages tab", (await tabs()) === 0);
    s.check("off: the chats show", await waitText(page, "GENERAL"));
    await page.evaluate(() => window.__harness.setFiles(true));
    await settle(page);
    s.check("on: the Pages tab shows without a restart", (await tabs()) === 1);
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Beacon Billing"]'));
    s.check(
      "on: a note opens as a page",
      await page
        .getByRole("button", { name: /History|Geschiedenis/ })
        .first()
        .isVisible(),
    );
    await page.evaluate(() => window.__harness.setFiles(false));
    await settle(page);
    s.check("off again: no tabs", (await tabs()) === 0);
    s.check(
      "off again: the page is gone",
      !(await page
        .getByRole("button", { name: /History|Geschiedenis/ })
        .first()
        .isVisible()
        .catch(() => false)),
    );
  },

  async pageFiles(s) {
    await s.load();
    const { page } = s;
    const row = path => page.locator(`[data-page="${path}"]`);
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Beacon Billing"]'));
    await click(page.locator('[data-folder="Contexts/Agency/Projects/Beacon Billing/Documents"]'));
    await row(spec).click({ button: "right" });
    await click(page.getByRole("button", { name: "Rename…" }));
    await page.getByRole("dialog").locator("input").fill("Billing Rules");
    await page.getByText("Update 3 links in 2 notes").waitFor();
    s.check("the rename counts the links first", true);
    await click(page.getByRole("dialog").getByRole("button", { name: "Rename" }));
    s.check(
      "the tree shows the new name",
      await row("Contexts/Agency/Projects/Beacon Billing/Documents/Billing Rules.md").isVisible(),
    );
    await row("Contexts/Agency/Projects/Beacon Billing/Documents/Billing Rules.md").click({ button: "right" });
    await click(page.getByRole("button", { name: "Delete" }));
    s.check("Delete asks first", await page.getByText("Delete Billing Rules?").isVisible());
    await click(page.getByRole("dialog").getByRole("button", { name: "Delete" }));
    s.check(
      "Delete takes it out of the tree",
      (await row("Contexts/Agency/Projects/Beacon Billing/Documents/Billing Rules.md").count()) === 0,
    );
    await click(page.getByRole("button", { name: "Undo" }));
    await page.waitForTimeout(300);
    s.check(
      "Undo brings it back",
      (await row("Contexts/Agency/Projects/Beacon Billing/Documents/Billing Rules.md").count()) === 1,
    );
    await page.getByText("Folders", { exact: true }).click({ button: "right" });
    await click(page.getByRole("button", { name: "New page" }));
    await click(page.getByRole("dialog").getByRole("button", { name: "Create" }));
    s.check("a new page opens", await page.getByText("Untitled", { exact: true }).first().isVisible());
    // a project's own note (in Recent) keeps its name
    await row("Contexts/Agency/Projects/Northwind Portal/Northwind Portal.md").first().click({ button: "right" });
    await click(page.getByRole("button", { name: "Rename…" }));
    s.check(
      "a project's own note is not renamed here",
      (await page.getByRole("dialog").count()) === 0 &&
        (await page.getByText("rename the project from the sidebar", { exact: false }).count()) > 0,
    );
  },

  // ticket 9: a shared document's page; a peer's line and cursor show, what is typed here reaches the document, and
  // ⌘Z undoes only this Mac's text
  async pageCoEdit(s) {
    await s.load({ fixture: "shared-live" });
    const { page } = s;
    await page.keyboard.press("Control+Digit2");
    await page.getByRole("tab", { name: /^Pages/ }).click();
    for (const folder of ["Contexts", "Contexts/Team", "Contexts/Team/Projects"])
      await page.locator(`[data-folder="${folder}"]`).click();
    await page.locator('[data-page="Contexts/Team/Projects/Team Handbook.md"]').click();
    await page.waitForFunction(() => window.__harness.liveText().length > 0, null, { timeout: 4000 });
    const doc = () => page.evaluate(() => window.__harness.liveText());
    const editor = () => page.locator(".cm-content").textContent();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("Mine here");
    for (let i = 0; i < 20 && !(await doc()).includes("Mine here"); i++) await page.waitForTimeout(100);
    s.check("what is typed reaches the document", (await doc()).endsWith("Mine here"));
    s.check("and no file is written", (await page.evaluate(() => window.__harness.written())) === null);
    await page.evaluate(() => window.__harness.peerType("- [ ] First open loop", " (Jonas)"));
    s.check("a peer's text appears", (await editor()).includes("First open loop (Jonas)"));
    s.check("the head stays out of the editor", !(await editor()).includes("type: Document"));
    await page.evaluate(() => window.__harness.peerCursor("a1b2c3d4e5f6a7b8", "Jonas Peeters", "(Jonas)"));
    s.check(
      "a peer's cursor shows with their name",
      (await page.locator(".cm-peer-name", { hasText: "Jonas Peeters" }).count()) === 1,
    );
    s.check("and their avatar in the bar", (await page.getByRole("img", { name: /Jonas Peeters/ }).count()) === 1);
    s.check(
      "this Mac's cursor was sent",
      (await page.evaluate(() => window.__harness.liveCursors())).some(c => c.includes("Alex")),
    );
    await page.keyboard.press("Meta+z");
    for (let i = 0; i < 20 && (await doc()).includes("Mine here"); i++) await page.waitForTimeout(100);
    s.check(
      "⌘Z undoes this Mac's text",
      !(await editor()).includes("Mine here") && !(await doc()).includes("Mine here"),
    );
    s.check("but not the peer's", (await editor()).includes("(Jonas)") && (await doc()).includes("(Jonas)"));
  },

  // Notion-like editing on a page (ticket 3): /to + Enter makes a to-do, its box toggles the file, a heading dragged
  // above the text before it takes its section along
  // ticket 6: the file changes outside Relay while the page has unsaved typing; apart, both stay, on one line, the bar
  async pageMerge(s) {
    await s.load();
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\nMy line");
    await page.evaluate(() =>
      window.__harness.editOutside("- [ ] First open loop", "- [ ] First open loop, by Claude"),
    );
    await page
      .locator(".cm-outside")
      .first()
      .waitFor({ timeout: 3000 })
      .catch(() => {});
    const text = await page.locator(".cm-content").textContent();
    s.check("Claude's change is in the editor", text.includes("First open loop, by Claude"));
    s.check("what was typed is still there", text.includes("My line"));
    s.check("the changed line is marked", (await page.locator(".cm-outside").count()) > 0);
    const written = async () => (await page.evaluate(() => window.__harness.written())) ?? "";
    for (let i = 0; i < 20 && !/My line/.test(await written()); i++) await page.waitForTimeout(200);
    s.check("the save keeps both", /First open loop, by Claude[\s\S]*My line/.test(await written()));
    await page.locator(".cm-line", { hasText: "Second open loop" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await page.evaluate(() => window.__harness.editOutside("- [ ] Second open loop", "- [ ] Second open loop, moved"));
    s.check(
      "the same line changed both ways shows the bar",
      await page
        .getByText("Keep mine")
        .waitFor({ timeout: 3000 })
        .then(
          () => true,
          () => false,
        ),
    );
  },
  async pageBlocks(s) {
    await s.load();
    const { page } = s;
    await page.getByRole("tab", { name: /^Pages/ }).click();
    await page.locator('[data-project="Northwind Portal"]').click();
    await page.locator(".cm-content").waitFor();
    const written = async () => (await page.evaluate(() => window.__harness.written())) ?? ""; // calls() shortens long args
    const saved = async re => {
      for (let i = 0; i < 20 && !re.test(await written()); i++) await page.waitForTimeout(200);
      return re.test(await written());
    };
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("\n/to");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    s.check(
      "/to offers To-do first",
      (await page.locator(".cm-tooltip-autocomplete li").first().textContent())?.startsWith("To-do"),
    );
    // CodeMirror takes Enter as a pick only 75 ms after the list opened, by Date.now, which the harness pins: move it on
    await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000));
    await page.keyboard.press("Enter");
    await page.keyboard.type("Call the client");
    s.check("the to-do is saved as markdown", await saved(/\n- \[ \] Call the client$/));
    // typed Enter would continue the to-do list; WebKit's insertText takes one line at a time
    for (const part of ["\n", "\n", "## Later", "\n", "After the demo"]) await page.keyboard.insertText(part);
    await page.locator(".cm-line", { hasText: "Call the client" }).locator(".cm-task").click();
    s.check("its box ticks it in the file", await saved(/- \[x\] Call the client\n[\s\S]*## Later\nAfter the demo/));
    // drag the Later heading (its section) above the first line
    const heading = page.locator(".cm-line", { hasText: "Later" });
    const box = await heading.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    // the drop goes on the page's first line: scrolled into view, the handle still holds the Later section
    await page.locator(".cm-line", { hasText: "Archive: old repo" }).scrollIntoViewIfNeeded();
    const first = await page.locator(".cm-line", { hasText: "Archive: old repo" }).boundingBox();
    await page.evaluate(
      ({ y }) => {
        const handle = document.querySelector(".cm-block-handle");
        const content = document.querySelector(".cm-content");
        const data = new DataTransfer();
        handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
        const over = content.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, cancelable: true, clientY: y, dataTransfer: data }),
        );
        const dropped = content.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, clientY: y, dataTransfer: data }),
        );
        handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
        if (over || dropped) throw new Error("the editor did not take the drag");
      },
      { y: first.y + 2 },
    );
    s.check(
      "the heading moved with its section",
      await saved(/# Northwind Portal\n\n## Later\nAfter the demo\n\n> \[!note\]/),
    );
    s.check("and nothing else changed", /```\n\n- \[x\] Call the client/.test(await written()));
  },

  async mail(s) {
    await s.load();
    const { page, keys } = s;
    const markers = await page.evaluate(() => window.__harness.markers);
    await click(nav(page).getByText("Mail", { exact: true }), 300);
    s.check("list shown", await waitText(page, markers.plainMail));
    s.check("both accounts merged", await hasText(page, markers.studioMail));
    s.check(
      "mail_list per account",
      JSON.stringify(
        (await s.calls("mail_list")).map(c => c.args).sort((a, b) => a.account.localeCompare(b.account)),
      ) ===
        JSON.stringify([
          { account: "lena@example.com", page: 1 },
          { account: "studio@example.org", page: 1 },
        ]),
    );
    await click(byText(page, markers.plainMail), 300);
    s.check("plain mail shown", await waitText(page, "The export should include the VAT column."));
    s.check("mail_read once", (await s.calls("mail_read")).length === 1);
    s.check("opening does not mark it read", (await s.calls("mail_seen")).length === 0);
    await click(button(page, "Mark as read").last(), 300);
    const seen = await s.calls("mail_seen");
    s.check(
      "read toggle calls mail_seen once",
      seen.length === 1 && seen[0].args.id === "5000" && seen[0].args.seen === true,
    );
    await page.getByRole("searchbox", { name: "Search sender or subject" }).fill("Invoice September");
    await settle(page);
    s.check("search keeps the match", await hasText(page, "Invoice September (2)"));
    s.check("search hides the rest", !(await hasText(page, "Lunch Thursday?")));
    await page.getByRole("searchbox", { name: "Search sender or subject" }).fill("");
    await settle(page);
    await click(button(page, "Load 50 more"), 300);
    const more = (await s.calls("mail_list")).filter(c => c.args.page === 2);
    s.check(
      "load more asks page 2 of the account that has more",
      more.length === 1 && more[0].args.account === "lena@example.com",
    );
    s.check("page 2 shown", await waitText(page, "Contract renewal (5)"));
    // a link in the sandboxed html mail: the webview's navigation becomes the backend's mail-link event, as in Tauri
    await page.route("https://beacon.example/**", async route => {
      await page.evaluate(u => window.__harness.emit("mail-link", u), route.request().url()).catch(() => {});
      await route.abort();
    });
    await click(byText(page, markers.studioMail), 300);
    const reads = (await s.calls("mail_read")).map(c => c.args);
    s.check(
      "a mail is read from its own account",
      reads.at(-1)?.account === "studio@example.org" && reads.at(-1)?.id === "700",
    );
    await click(byText(page, markers.htmlMail), 300);
    s.check(
      "html mail in a frame",
      await page
        .waitForFunction(() => window.__dom.all("iframe").some(f => f.srcdoc.includes("Balance report")), null, {
          timeout: 4000,
        })
        .then(
          () => true,
          () => false,
        ),
    );
    s.check("still no mark-read after the html mail", (await s.calls("mail_seen")).length === 1);
    await page
      .frameLocator("iframe")
      .getByText("Open dossier")
      .click({ timeout: 4000 })
      .catch(() => {});
    const url = "https://beacon.example/dossiers/D-1042";
    s.check("confirmation bar shows the url", await waitText(page, url, 3000));
    s.check("nothing opened before the go", (await s.calls("plugin:opener|open_url")).length === 0);
    const bar = page
      .locator("div")
      .filter({ hasText: url })
      .filter({ has: button(page, "Open") })
      .last();
    if (await hasText(page, url)) await click(bar.getByRole("button", { name: "Open", exact: true }));
    const opened = await s.calls("plugin:opener|open_url");
    s.check("confirm opens the url once", opened.length === 1 && opened[0].args.url === url);
    s.check("bar gone", !(await hasText(page, url)));
    void keys;
  },

  // the experimental mail flag: Inbox/Other, archive and delete by key, button and selection, bulk read
  async mailTriage(s) {
    await s.load({ fixture: "mailexp" });
    const { page } = s;
    const markers = await page.evaluate(() => window.__harness.markers);
    await click(nav(page).getByText("Mail", { exact: true }), 300);
    s.check("list shown", await waitText(page, markers.plainMail));
    s.check("Other mails left out of the Inbox", !(await listed(page, markers.otherMail)));
    await click(page.getByRole("button", { name: /^Other( \d+)?$/ }), 300);
    s.check(
      "Other tab shows them",
      (await listed(page, markers.otherMail)) && !(await listed(page, markers.plainMail)),
    );
    s.fact("filter after Other", (await s.local(["mailFilter"])).mailFilter);
    await click(page.getByRole("button", { name: /^Inbox( \d+)?$/ }), 300);
    await click(byText(page, markers.plainMail), 300);
    s.check("opening does not mark it read", (await s.calls("mail_seen")).length === 0);
    await page.keyboard.press("e");
    s.check("E archives the open mail", await s.waitCall("mail_move"));
    await settle(page, 300);
    const first = (await s.calls("mail_move"))[0]?.args;
    s.check(
      "archive asks one mail, no trash",
      JSON.stringify(first) === JSON.stringify({ account: "lena@example.com", ids: ["5000"], trash: false }),
    );
    s.check("the archived mail left the list", !(await listed(page, markers.plainMail)));
    s.fact("opened next", (await s.calls("mail_read")).at(-1)?.args);
    // a held key acts once
    await page.keyboard.down("e");
    await page.keyboard.down("e");
    await page.keyboard.up("e");
    await settle(page, 300);
    s.check("a held E archives once", (await s.calls("mail_move")).length === 2);
    // Cmd-click, Shift-click a range, Esc clears
    await click(byText(page, markers.htmlMail), 300);
    await byText(page, "Depot coordinates")
      .first()
      .click({ modifiers: ["Meta"] });
    await byText(page, "Intake form French translation")
      .first()
      .click({ modifiers: ["Shift"] });
    await settle(page);
    s.check("Shift-click ticks the range", await waitText(page, "2 selected", 2000));
    await page.keyboard.press("Escape");
    await settle(page);
    s.check("Esc clears the selection", !(await hasText(page, "2 selected")));
    await page.keyboard.press("Meta+a");
    await settle(page);
    s.fact(
      "Cmd-A ticks",
      await page.evaluate(
        () =>
          window.__dom
            .all("span")
            .map(x => x.textContent.trim())
            .find(t => /^\d+ selected$/.test(t)) ?? null,
      ),
    );
    await page.keyboard.press("Escape");
    await settle(page);
    await byText(page, markers.htmlMail)
      .first()
      .click({ modifiers: ["Meta"] });
    await byText(page, "Depot coordinates")
      .first()
      .click({ modifiers: ["Meta"] });
    await settle(page);
    await click(button(page, "Mark as read").first(), 300);
    const seen = (await s.calls("mail_seen")).map(c => c.args);
    s.check("bulk read marks both", seen.length === 2 && seen.every(a => a.seen === true));
    s.fact("bulk read", seen.map(a => a.id).sort());
    await click(button(page, "Delete (#)").first(), 300);
    const trash = (await s.calls("mail_move")).at(-1)?.args;
    s.check(
      "bulk delete trashes both",
      trash?.trash === true && JSON.stringify([...(trash?.ids ?? [])].sort()) === JSON.stringify(["4997", "4999"]),
    );
    s.check(
      "both left the list",
      !(await listed(page, markers.htmlMail)) && !(await listed(page, "Depot coordinates")),
    );
    // # on the open mail of the other account
    await click(byText(page, "Quote request intranet"), 300);
    await page.keyboard.press("#");
    await settle(page, 300);
    const hash = (await s.calls("mail_move")).at(-1)?.args;
    s.check(
      "# deletes the open mail from its own account",
      JSON.stringify(hash) === JSON.stringify({ account: "studio@example.org", ids: ["699"], trash: true }),
    );
    // a reload does not bring them back
    await click(button(page, "Refresh").first(), 300);
    s.check(
      "moved mails stay gone after a reload",
      !(await listed(page, markers.plainMail)) && !(await listed(page, markers.htmlMail)),
    );
  },
  // a read filter hides mails once marked read: they leave the selection, so E or # cannot act on mails out of sight
  async mailTriageFilter(s) {
    await s.load({ fixture: "mailexp" });
    const { page } = s;
    await click(nav(page).getByText("Mail", { exact: true }), 300);
    await click(button(page, "Unread"), 300);
    await byText(page, "Invoice September")
      .first()
      .click({ modifiers: ["Meta"] });
    await byText(page, "Re: Planner demo")
      .first()
      .click({ modifiers: ["Meta"] });
    await settle(page);
    s.check("two ticked", await waitText(page, "2 selected", 2000));
    await click(button(page, "Mark as read").first(), 300);
    s.check("bulk read marks both", (await s.calls("mail_seen")).length === 2);
    s.check(
      "the hidden mails left the selection",
      !(await hasText(page, "2 selected")) && !(await hasText(page, "1 selected")),
    );
    await page.keyboard.press("e");
    await settle(page, 300);
    s.check("E has nothing to act on", (await s.calls("mail_move")).length === 0);
  },
  // without the flag nothing of it shows and E does nothing
  async mailTriageOff(s) {
    await s.load();
    const { page } = s;
    const markers = await page.evaluate(() => window.__harness.markers);
    await click(nav(page).getByText("Mail", { exact: true }), 300);
    await click(byText(page, markers.plainMail), 300);
    s.check("no Other tab", (await visible(page.getByRole("button", { name: /^Other( \d+)?$/ })).count()) === 0);
    s.check("no checkboxes", (await visible(page.getByRole("checkbox")).count()) === 0);
    s.check("no archive button", (await visible(button(page, "Archive")).count()) === 0);
    await page.keyboard.press("e");
    await page.keyboard.press("Meta+a");
    await settle(page, 300);
    s.check("E does nothing", (await s.calls("mail_move")).length === 0);
    s.check("the mail stays", await listed(page, markers.plainMail));
  },
  async prs(s) {
    await s.load();
    const { page } = s;
    await click(nav(page).getByText("Pull requests", { exact: true }), 300);
    s.check("list shown", await waitText(page, "Fix the SSO redirect loop on the portal"));
    await click(byText(page, "Fix the SSO redirect loop on the portal"), 300);
    s.check("detail shown", await waitText(page, "src/auth/callback.ts"));
    const pr = await s.calls("github_pr");
    s.check(
      "github_pr for the PR",
      pr.some(c => c.args.repo === "acme/northwind-portal" && c.args.number === 412),
    );
    s.check("list and PR side by side", await hasText(page, "Replace balance instead of adding it"));
    await click(button(page, "Review with Claude"), 400);
    const sends = await s.calls("send");
    s.check(
      "Review with Claude sends one review prompt",
      sends.length === 1 &&
        String(sends[0].args.text).includes("Review PR https://github.com/acme/northwind-portal/pull/412"),
    );
    const created = Object.values(await s.chatChanges()).filter(c => c !== "removed");
    s.check(
      "in a new conversation under the PR's project",
      created.length === 1 &&
        created[0].project === "Northwind Portal" &&
        created[0].title === "Review northwind-portal #412",
    );
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
    s.check(
      "comment posted once",
      (await writes()).filter(c => String(c.args.path).startsWith("/comments")).length === 1,
    );
    s.check("comment box emptied", (await comment.inputValue().catch(() => null)) === "");
    // the status pill opens a menu of the workflow's statuses
    await click(button(page, "Status"), 200);
    await click(page.getByRole("menuitemradio", { name: "In progress", exact: true }), 500);
    const status_ = (await writes()).filter(c => String(c.args.path).startsWith("/tasks"));
    s.check("status changed once", status_.length === 1 && JSON.stringify(status_[0].args.body).includes("ws2"));
    s.fact("writes", await writes());
    // Start conversation: a new conversation about the card, under the board's vault project; the card goes in front
    await click(button(page, "Start conversation"), 400);
    const created = Object.entries(await s.chatChanges()).filter(([, c]) => c !== "removed");
    s.check(
      "card conversation under the linked project",
      created.length === 1 && created[0][1].project === "Northwind Portal",
    );
    s.check("card conversation selected", (await s.local(["sel"])).sel === created[0]?.[0]);
    s.fact("card conversation", created[0]?.[1] ?? null);
    s.fact("composer before typing", await composerValue(page));
    await composer(page).click({ timeout: 4000 });
    await composer(page).evaluate(el => el.setSelectionRange(el.value.length, el.value.length)); // type after what is there
    await page.keyboard.type("What is left?");
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    const sends = await s.calls("send");
    s.check(
      "the card goes in front of the first message",
      sends.length === 1 &&
        String(sends[0].args.text).includes("Invoice export CSV") &&
        String(sends[0].args.text).endsWith("What is left?"),
    );
    s.fact("card send", sends[0]?.args ?? null);
  },

  async boardNewTask(s) {
    await s.load();
    const { page } = s;
    await click(nav(page).getByText("Productive", { exact: true }), 300);
    s.check("board shown", await waitText(page, "Invoice export CSV"));
    const posts = async () =>
      (await s.calls("integration_call")).filter(c => c.args.method === "POST" && c.args.path === "/tasks");
    // New task in the title bar: the first column, Enter in the title creates it
    await click(button(page, "New task"), 300);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Parity task");
    await page.keyboard.press("Enter");
    await settle(page, 500);
    const first = await posts();
    s.check(
      "one task created, in the first task list",
      first.length === 1 &&
        JSON.stringify(first[0].args.body).includes('"title":"Parity task"') &&
        JSON.stringify(first[0].args.body).includes('"tl1"'),
    );
    s.check("the card shows on the board", await waitText(page, "Parity task"));
    s.check("the board says 21 tasks", await waitText(page, "21 tasks"));
    // a lane's + puts it in that lane, with its description
    await click(button(page, "New task in Review"), 300);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Review the parity task");
    await page.getByRole("textbox", { name: "Description (optional)", exact: true }).fill("Check it twice");
    await click(button(page, "Create task"), 500);
    const both = await posts();
    s.check(
      "the lane's task goes in its task list",
      both.length === 2 &&
        JSON.stringify(both[1].args.body).includes('"tl4"') &&
        JSON.stringify(both[1].args.body).includes("Check it twice"),
    );
    s.check("the second card shows", await waitText(page, "Review the parity task"));
    // Escape closes the dialog without creating anything, and leaves the board open
    await click(button(page, "New task"), 300);
    await page.keyboard.press("Escape");
    await settle(page, 300);
    s.check(
      "Escape creates nothing",
      (await posts()).length === 2 &&
        !(await hasText(page, "Create task")) &&
        (await hasText(page, "Review the parity task")),
    );
    s.fact(
      "creates",
      (await posts()).map(c => c.args.body),
    );
  },

  async boardTools(s) {
    await s.load();
    const { page } = s;
    const before = await s.local([]);
    await click(nav(page).getByText("Productive", { exact: true }), 300);
    s.check("board shown", await waitText(page, "Invoice export CSV"));
    await click(button(page, "List"), 300);
    s.check(
      "list view shows its groups",
      (await hasText(page, "Backlog")) && (await page.getByText("#300", { exact: true }).count()) > 0,
    );
    await click(button(page, "Filters"), 300);
    await click(page.getByRole("button", { name: /^Lena\b/ }), 300);
    s.check("an assignee filter narrows the board", await waitText(page, "3 of 20"));
    await click(button(page, "Show 3 tasks"), 300);
    await click(page.getByRole("button", { name: /^Filters/ }), 300); // with its count now
    await click(button(page, "Clear all filters"), 300);
    s.check("cleared", await waitText(page, "20 tasks"));
    await click(button(page, "Show 20 tasks"), 300);
    await click(button(page, "Presets"), 300);
    s.check(
      "Productive's saved views listed",
      (await hasText(page, "In review")) &&
        (await hasText(page, "My open tasks")) &&
        (await hasText(page, "Due this week")),
    );
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
    s.fact(
      "added",
      added.map(c => c.args),
    );
    await click(button(page, "Done").first(), 300);
    await click(button(page, "Tomorrow").first(), 300);
    await click(button(page, "+1 week").first(), 300);
    const actions = await s.calls("reminder");
    s.check("done, tomorrow and +1 week: three reminder calls", actions.length === 3);
    s.fact(
      "reminder calls",
      actions.map(c => c.args),
    );
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
    s.check(
      "undo writes it again with its date",
      added.length === 1 &&
        added[0].args.date === "2026-09-28" &&
        String(added[0].args.text).startsWith("Chase the client for the partner API keys"),
    );
    s.check("back in the list", await waitText(page, "Chase the client for the partner API keys"));
    // a push is undone by pushing it back
    await click(button(page, "+1 week").first(), 300);
    await click(button(page, "Undo"), 400);
    const pushes = (await s.calls("reminder")).map(c => c.args);
    s.check(
      "undo of a push pushes it back to its date",
      pushes.length === 3 &&
        pushes[1].action === "push" &&
        pushes[1].date === "+1w" &&
        pushes[2].action === "push" &&
        pushes[2].id === pushes[1].id &&
        pushes[2].date === "2026-09-28",
    );
    s.fact("reminder calls", pushes);
    s.fact(
      "reminder_add",
      added.map(c => c.args),
    );
  },

  async settings(s) {
    await s.load({ path: "/settings.html" });
    const { page } = s;
    const select = name =>
      visible(page.getByRole("combobox").filter({ has: page.getByRole("option", { name, exact: true }) })).first();
    await click(visible(page.getByRole("radio", { name: "Dark", exact: true })).first(), 300);
    let saves = await s.calls("set_settings");
    s.check("theme saved dark", saves.at(-1)?.args.settings?.theme === "dark");
    s.check(
      "theme applied to the window",
      (await s.calls("plugin:window|set_theme")).some(c => c.args.value === "dark" || c.args.theme === "dark"),
    );
    await click(visible(page.getByRole("radio", { name: "Graphite", exact: true })).first(), 300);
    saves = await s.calls("set_settings");
    s.check("accent saved graphite", saves.at(-1)?.args.settings?.accent === "graphite");
    await click(navButton(page, "Integrations"), 300);
    await click(byText(page, "GitHub"), 300);
    const owners = page.getByPlaceholder("Empty is everywhere, e.g. your-org");
    await owners.fill("acme, globex");
    const save = visible(
      page
        .locator("*")
        .filter({ has: owners })
        .filter({ has: button(page, "Save") })
        .last()
        .getByRole("button", { name: "Save", exact: true }),
    ).first();
    await click(save, 300);
    saves = await s.calls("set_settings");
    s.check(
      "owners saved",
      JSON.stringify(saves.at(-1)?.args.settings?.github ?? {}).includes("acme, globex") ||
        JSON.stringify(saves.at(-1)?.args.settings?.github ?? {}).includes("globex"),
    );
    await click(navButton(page, "General"), 300);
    const english = select("English");
    const dutch = await english
      .locator("option")
      .evaluateAll(os => os.find(o => /nederlands|dutch/i.test(o.textContent))?.textContent ?? null);
    if (dutch) await english.selectOption({ label: dutch });
    await settle(page, 400);
    saves = await s.calls("set_settings");
    s.check("language saved nl", saves.at(-1)?.args.settings?.language === "nl");
    s.check("ui in Dutch", await waitText(page, "Integraties", 2000));
    s.fact(
      "saved",
      saves.map(c => ({
        language: c.args.settings?.language,
        theme: c.args.settings?.theme,
        accent: c.args.settings?.accent,
        github: c.args.settings?.github,
      })),
    );
  },

  // Agent access per extension: the vault's .relay/config.json `actions`, through action_config / set_action_config
  async calendar(s) {
    await s.load({ fixture: "calendar" });
    const { page } = s;
    // the day's meetings are blocks in the strip, the running or next one is the card above the queue
    const block = title =>
      visible(page.locator('section[aria-label="Day"]').getByRole("button", { name: title, exact: true })).first();
    await block("Sprint review Northwind Portal")
      .waitFor({ timeout: 4000 })
      .catch(() => {});
    s.check("the day strip has the meetings", (await block("Sprint review Northwind Portal").count()) === 1);
    s.check(
      "every meeting of the day, the one an hour ago and the one in 90 minutes too",
      (await block("Daily standup").count()) === 1 &&
        (await block("Sprint review Northwind Portal").count()) === 1 &&
        (await block("Harbor CRM kick-off").count()) === 1 &&
        (await block("Retro Atlas Logistics").count()) === 1 &&
        (await block("Lunch with the accountant").count()) === 1,
    );
    s.check(
      "the running meeting is the card above the queue, with its time",
      (await hasText(page, "Now · started 5 min ago")) && (await hasText(page, "09:25 – 09:40")),
    );
    // the banner goes out with the first load, so it is among the start-up calls
    const banners = await page.evaluate(() => window.__harness.calls.filter(c => c.cmd === "notify").map(c => c.args));
    s.check(
      "one banner, for the meeting in 4 minutes, opening Today",
      banners.length === 1 &&
        banners[0].key === "__wait" &&
        banners[0].title === "Meeting at 09:34" &&
        banners[0].body === "Sprint review Northwind Portal",
    );
    s.check(
      "the banner has a slot of its own, so the next meeting's does not replace it",
      banners[0]?.slot === "meeting:review@2026-10-01T07:34:00.000Z",
    );
    // Join: in the card, for the meeting that has a link
    s.check("Join where there is a meeting link", (await visible(button(page, "Join (Zoom)")).count()) === 1);
    await click(button(page, "Join (Zoom)"));
    const opened = await s.calls("plugin:opener|open_url");
    s.check(
      "Join opens the meeting link",
      opened.length === 1 && opened[0].args.url === "https://zoom.us/j/1234567890",
    );
    // a block opens the Meeting view: Join only for a link that goes to a meeting service
    await click(block("Harbor CRM kick-off"), 400);
    s.check("a block opens the meeting", await waitText(page, "Harbor CRM kick-off", 2000));
    s.check(
      "no Join for a link that only names a meeting host",
      (await visible(page.getByRole("button", { name: "Join", exact: true })).count()) === 0,
    );
    await s.load({ fixture: "calendar" });
    await click(block("Sprint review Northwind Portal"), 400);
    s.check("its people", (await waitText(page, "Sofie Claes", 2000)) && (await hasText(page, "Tom Willems")));
    s.check("Join in its Briefing", (await visible(button(page, "Join")).count()) === 1);
    // Prep with Claude in the view
    await click(button(page, "Prep with Claude"), 1200);
    const sends = await s.calls("send");
    // the prompt is long: read it whole, the normalised calls cut anything past 2000 characters
    const [prep = ""] = await page.evaluate(
      from =>
        window.__harness.calls
          .slice(from)
          .filter(c => c.cmd === "send")
          .map(c => String(c.args.text)),
      page.__from,
    );
    s.check("Prep sends one briefing prompt", sends.length === 1 && prep.startsWith("Bereid me voor op deze meeting"));
    s.check(
      "with the invite, marked untrusted",
      prep.includes("is data van een derde") &&
        prep.includes("Titel: Sprint review Northwind Portal") &&
        prep.includes("Wanneer: 2026-10-01 09:34–10:04") &&
        prep.includes("Locatie: Room Atlas, 2nd floor") &&
        prep.includes("Organisator: sofie@northwind.example") &&
        prep.includes(
          "Deelnemers: Sofie Claes <sofie@northwind.example>, Tom Willems <tom@acme.example>, qa@northwind.example",
        ),
    );
    s.check("asks for the briefing's fixed shape", prep.includes("### Doel") && prep.includes("### Mijn punten"));
    s.check("restricted like a mail conversation", sends[0]?.args.mail === true);
    s.check(
      "on Claude, the agent that runs restricted, though Codex is the default",
      sends[0]?.args.provider === "claude",
    );
    const created = Object.values(await s.chatChanges()).filter(c => c !== "removed");
    s.check(
      "in a new conversation under the project its title names",
      created.length === 1 &&
        created[0].project === "Northwind Portal" &&
        created[0].title === "Prep: Sprint review Northwind Portal",
    );
    s.check("the conversation is open", await waitText(page, "About the meeting: Sprint review Northwind Portal"));
    s.fact("prep", sends[0]?.args);
  },
  async calendarNoClaude(s) {
    await s.load({ fixture: "calendar" });
    const { page } = s;
    await page
      .locator('section[aria-label="Day"]')
      .getByRole("button", { name: "Sprint review Northwind Portal", exact: true })
      .waitFor();
    await click(
      visible(
        page
          .locator('section[aria-label="Day"]')
          .getByRole("button", { name: "Sprint review Northwind Portal", exact: true }),
      ).first(),
      400,
    );
    await click(button(page, "Prep with Claude"), 400);
    s.check(
      "no meeting conversation without Claude",
      (await s.calls("send")).length === 0 && !Object.keys(await s.chatChanges()).length,
    );
    s.check(
      "it says why",
      await waitText(
        page,
        "Meeting notes and briefings run on Claude Code, which is switched off. Switch it on under Settings › Agents.",
        2000,
      ),
    );
  },
  async calendarSettings(s) {
    await s.load({ path: "/settings.html" });
    const { page } = s;
    const field = id => visible(page.locator(`#${id}`)).first();
    const add = () => visible(button(page, "Add calendar")).first();
    await click(navButton(page, "Integrations"), 300);
    // switching a row on opens its page
    await click(visible(page.getByRole("switch", { name: "Calendar" })).first(), 400);
    let saves = await s.calls("set_settings");
    s.check("switched on from its row", saves.length === 1 && saves[0].args.settings?.calendar?.on === true);
    s.check("its page opens on the list of calendars", await waitText(page, "Calendars"));
    await click(button(page, "+ Add calendar"), 300);
    s.check("+ Add calendar opens the form", await waitText(page, "Add a calendar"));
    s.check("Add calendar waits for both fields", await add().isDisabled());
    await field("calemail").fill("lena@example.com");
    await field("calurl").fill("https://example.com/calendar.ics");
    await click(add(), 300);
    let connects = await s.calls("calendar_connect");
    s.check(
      "the address goes to the backend as typed",
      connects.length === 1 &&
        connects[0].args.email === "lena@example.com" &&
        connects[0].args.url === "https://example.com/calendar.ics",
    );
    s.check("a refused address shows why", await waitText(page, "That is no secret iCal address", 2000));
    s.check("and saves nothing", (await s.calls("set_settings")).length === 1);
    s.check("the fields stay to fix", (await field("calemail").inputValue()) === "lena@example.com");
    const url = "https://calendar.google.com/calendar/ical/lena%40example.com/private-0123456789abcdef/basic.ics";
    await field("calurl").fill(url);
    await click(add(), 300);
    saves = await s.calls("set_settings"); // args come normalised, keys sorted
    s.check(
      "a calendar that loads is saved by its email only",
      saves.length === 2 &&
        JSON.stringify(saves[1].args.settings?.calendar) ===
          JSON.stringify({ feeds: [{ email: "lena@example.com" }], on: true }),
    );
    s.check(
      "the address never reaches the settings",
      !JSON.stringify(saves.map(c => c.args)).includes("calendar.google.com"),
    );
    s.check(
      "it says how many meetings",
      await waitText(page, "lena@example.com added: 3 meetings in the next 7 days", 2000),
    );
    s.check("back on the list with the calendar", await waitText(page, "lena@example.com", 2000));
    // the calendar's own Remove comes before the integration's in the page
    await click(visible(button(page, "Remove")).first(), 300);
    connects = await s.calls("calendar_connect");
    saves = await s.calls("set_settings");
    s.check("removing a calendar empties its keychain entry", connects.length === 3 && connects[2].args.url === "");
    s.check(
      "and drops it from the settings",
      JSON.stringify(saves.at(-1)?.args.settings?.calendar) === JSON.stringify({ feeds: [], on: true }),
    );
    await click(visible(button(page, "Remove")).last(), 300);
    saves = await s.calls("set_settings");
    s.check("Remove switches the integration off", saves.at(-1)?.args.settings?.calendar?.on === false);
    s.check(
      "back on the list, switched off",
      !(await visible(page.getByRole("switch", { name: "Calendar" }))
        .first()
        .isChecked()),
    );
    s.fact(
      "calendar_connect",
      connects.map(c => c.args),
    );
    s.fact(
      "saved",
      saves.map(c => c.args.settings?.calendar),
    );
  },
  async agentAccess(s) {
    await s.load({ path: "/settings.html" });
    const { page } = s;
    await click(navButton(page, "Integrations"), 300);
    await click(byText(page, "Productive"), 400);
    s.check("actions listed", await waitText(page, "Create a task on a board."));
    await visible(page.locator("select#act-create_task"))
      .first()
      .selectOption({ label: "Runs" })
      .catch(() =>
        visible(page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "Runs", exact: true }) }))
          .nth(1)
          .selectOption({ label: "Runs" }),
      );
    await settle(page, 300);
    let sets = await s.calls("set_action_config");
    s.check(
      "a policy saved for the extension",
      sets.length === 1 &&
        sets[0].args.ext === "productive" &&
        sets[0].args.entry?.create_task === "auto" &&
        sets[0].args.entry?.["*"] === "ask",
    );
    await click(visible(page.getByRole("switch", { name: /Let the agent use Productive/ })).first(), 300);
    sets = await s.calls("set_action_config");
    s.check("access switched off", sets.length === 2 && sets[1].args.entry?.access === false);
    s.fact(
      "entries",
      sets.map(c => c.args),
    );
  },

  // Claude Code's logins: an extra config folder per account (settings.agents.providers.claude), all through set_settings
  async agentAccounts(s) {
    await s.load({ path: "/settings.html" });
    const { page } = s;
    const claude = async () => (await s.calls("set_settings")).at(-1)?.args.settings?.agents?.providers?.claude;
    await click(navButton(page, "Agents"), 300);
    await click(page.getByRole("button", { name: /^Claude Code\b/, expanded: false }), 300);
    s.check("accounts offered", await waitText(page, "Add account…"));
    s.check("no account choice with only the CLI's own", !(await hasText(page, "New conversations use")));
    await click(button(page, "Add account…"), 300);
    s.check("a cancelled pick saves nothing", (await s.calls("set_settings")).length === 0);
    await page.evaluate(() => {
      window.__harness.pickFolder = "/Users/demo/.claude-work";
    });
    await click(button(page, "Add account…"), 300);
    const added = (await claude())?.accounts;
    s.check(
      "the folder added, named after itself",
      added?.length === 1 && added[0].name === "claude-work" && added[0].dir === "/Users/demo/.claude-work",
    );
    s.check(
      "the login command shown",
      (await visible(
        page.locator("code", { hasText: "CLAUDE_CONFIG_DIR=/Users/demo/.claude-work claude /login" }),
      ).count()) === 1,
    );
    await click(button(page, "Add account…"), 300);
    s.check("the same folder twice adds nothing", (await s.calls("set_settings")).length === 1);
    await visible(page.locator("#agact-claude")).first().selectOption({ label: "claude-work" });
    await settle(page, 300);
    s.check("new conversations on the account", (await claude())?.active === "/Users/demo/.claude-work");
    await click(visible(page.getByRole("switch", { name: "Switch accounts automatically" })), 300);
    s.check("auto-switch saved", (await claude())?.auto === true);
    const name = visible(page.getByRole("textbox", { name: "Account name" })).first();
    const saves = (await s.calls("set_settings")).length;
    await name.fill("   ");
    await name.press("Enter");
    await settle(page, 300);
    s.check(
      "a blank name is not saved",
      (await s.calls("set_settings")).length === saves && (await name.inputValue()) === "claude-work",
    );
    await name.fill("  Work ");
    await name.press("Enter");
    await settle(page, 300);
    s.check("renamed, trimmed", (await claude())?.accounts?.[0]?.name === "Work");
    await click(visible(page.getByRole("button", { name: "Remove Work", exact: true })), 300);
    const last = await claude();
    s.check(
      "removed, back on the CLI's own",
      last?.accounts?.length === 0 && last?.active === "" && last?.auto === true,
    );
    s.fact(
      "saved",
      (await s.calls("set_settings")).map(c => {
        const x = c.args.settings?.agents?.providers?.claude;
        return { accounts: x?.accounts, active: x?.active, auto: x?.auto };
      }),
    );
  },

  async cmdkProject(s) {
    await s.load();
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
    s.check(
      "the project opens on its latest conversation",
      (await s.local(["sel"])).sel !== "__wait" && (await hasText(page, "Contact sync strategy")),
    );
    s.fact("sel", (await s.local(["sel"])).sel);
    s.fact("chat changes", await s.chatChanges());
  },

  // K5, issue 369: ⌘K over names and content. Typing finds notes by name and lines of content with the match marked,
  // `type:` and `in:` become pills that narrow what the backend is asked, ↵ opens, ⌘↵ opens beside the chat, ⌘O opens it
  async quickSwitcher(s) {
    const kb = { fixture: "kb" };
    await s.load(kb);
    await s.load({ ...kb, sel: s.keys.switchTo });
    const { page } = s;
    const searches = async () => (await s.calls("find_notes")).map(c => c.args.query);
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    s.check("opening ⌘K warms the index (an empty search)", (await searches()).includes(""));
    await page.keyboard.type("rate limit");
    s.check("a content match shows", await waitText(page, "Content matches"));
    s.check("a name group shows", await waitText(page, "Notes by name"));
    const hit = visible(page.locator("[data-option=content] mark")).first();
    s.check("the matched words are marked", (await hit.textContent())?.toLowerCase().startsWith("rate limit"));
    s.check("a content match names its line", /line \d+/.test(await page.locator("#quick-options").innerText()));
    s.check("the query reached the backend as typed", (await searches()).includes("rate limit"));
    // pills: typed as text, a space finishes them
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("type:Document in:Agency rate limit");
    await settle(page, 300);
    const pills = await visible(page.locator("[data-filter]")).evaluateAll(els => els.map(e => e.dataset.filter));
    s.check("type: and in: become pills", pills.join(",") === "type:Document,in:Agency");
    s.check(
      "the backend gets the pills with the words",
      (await searches()).includes("type:Document in:Agency rate limit"),
    );
    s.check("the meeting is narrowed away", !(await hasText(page, "Portal sync")));
    s.check("the other context is narrowed away", !(await hasText(page, "Rate card")));
    s.check("a Document of the context stays", await hasText(page, "Rate limit findings"));
    s.fact(
      "results with the filters",
      await visible(page.locator("[data-option]")).evaluateAll(els => els.map(e => e.textContent.slice(0, 60))),
    );
    // a pill comes off with Backspace on the empty field
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await settle(page);
    await page.keyboard.press("Backspace");
    await settle(page);
    s.check(
      "Backspace on the empty field takes the last pill off",
      (await visible(page.locator("[data-filter]")).count()) === 1,
    );
    await page.keyboard.type("rate limit");
    await settle(page, 300);
    s.check(
      "a pill still narrows after one is taken off",
      (await visible(page.locator("[data-filter]")).count()) === 1,
    );
    // ↵ opens the first result (with a filter on, nothing is asked)
    await page.keyboard.press("Enter");
    await settle(page, 300);
    const sel = (await s.local(["sel"])).sel;
    s.check("↵ opens a note as a page", String(sel).startsWith("page:") && (await s.calls("send")).length === 0);
    s.check("the note is shown", await waitText(page, "Rate limit"));
    s.fact("sel", sel);
    // a content match opens at its line: the cursor stands on it
    await s.load({ ...kb, sel: s.keys.switchTo });
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("retry-after");
    await waitText(page, "Content matches");
    const line = /line (\d+)/.exec(await page.locator("#quick-options").innerText())?.[1];
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await settle(page, 600);
    const active = await page.evaluate(
      () =>
        (getSelection()?.anchorNode instanceof Node
          ? getSelection().anchorNode.parentElement?.closest(".cm-line")?.textContent
          : "") ?? "",
    );
    s.check("↵ on a content match puts the cursor on its line", !!line && active.includes("Retry-After"));
    s.fact("line asked, line under the cursor", [line, active]);
    // ⌘↵: beside the conversation, which stays
    await s.load({ ...kb, sel: s.keys.switchTo });
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("retry-after");
    await waitText(page, "Content matches");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Meta+Enter");
    await settle(page, 500);
    s.check("⌘↵ leaves the conversation open", (await s.local(["sel"])).sel === s.keys.switchTo);
    s.check("⌘↵ shows the note beside it", await waitText(page, "429 with Retry-After"));
    // ⌘O is the same switcher
    await s.load(kb);
    await page.keyboard.press("Meta+o");
    await settle(page, 300);
    s.check("⌘O opens the switcher", /search notes/i.test((await focusedPlaceholder(page)) ?? ""));
    // an action: Today's note, made once
    await page.keyboard.type("today");
    await waitText(page, "Actions");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await settle(page, 500);
    s.check("the action makes today's note", (await s.calls("daily_note")).length === 1);
    s.check("and opens it", String((await s.local(["sel"])).sel).includes("2026-10-01.md"));
    // New <template> from the open page's project
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("new meeting");
    await waitText(page, "Actions");
    await click(page.getByRole("option", { name: /New Meeting/ }));
    await settle(page, 500);
    const made = await s.calls("new_from_template");
    s.check("New Meeting asks for a meeting from a template", made.length === 1 && made[0].args.template === "Meeting");
    s.fact("new from template", made[0]?.args ?? null);
  },

  // ⇥ in ⌘K searches the other workspace; its note opens by its absolute path
  async quickSwitcherWorkspace(s) {
    const kb = { fixture: "kb-shared" };
    await s.load(kb);
    await s.load({ ...kb, sel: s.keys.switchTo });
    const { page } = s;
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("policy");
    await s.waitCall("find_notes", 2);
    await settle(page, 200);
    const folders = async () => [...new Set((await s.calls("find_notes")).map(c => c.args.folder))];
    s.check("it searches the workspace shown first", (await folders()).length === 1);
    s.check("nothing of the other workspace yet", !(await hasText(page, "Rate policy")));
    await page.keyboard.press("Tab");
    await settle(page, 300);
    s.check("⇥ names the other workspace", await hasText(page, "in Side vault"));
    s.check("it searches that workspace", (await folders()).length === 2);
    s.check("its note is listed", await waitText(page, "Rate policy"));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await settle(page, 300);
    s.check(
      "its note opens by its absolute path",
      String((await s.local(["sel"])).sel).startsWith("page:/Users/me/Side vault/"),
    );
    s.fact("sel", (await s.local(["sel"])).sel);
  },

  // issue 370: @ in the composer picks a note as a chip and the message carries its path; Add to conversation (the
  // page's menu and ⌥↵ in ⌘K) puts the chip in the note's project conversation
  async noteMention(s) {
    const kb = { fixture: "kb" };
    await s.load(kb);
    await s.load({ ...kb, sel: s.keys.switchTo });
    const { page } = s;
    const hosting = "Contexts/Agency/Projects/Northwind Portal/Documents/Hosting plan.md";
    const chips = name => visible(page.getByRole("button", { name: new RegExp(`^${name}`) })).count();
    await typeInComposer(page, "Check @hosti");
    s.check("@ lists the notes by name", await waitText(page, "Hosting plan", 3000));
    await page.keyboard.press("Enter");
    await settle(page, 300);
    s.check("picking one shows a chip", (await chips("Hosting plan")) === 1);
    s.check("and takes the @name out of the text", (await composerValue(page)) === "Check ");
    s.check("nothing sent by the pick", (await s.calls("send")).length === 0);
    await page.keyboard.type("and summarise it");
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    const sent = (await s.calls("send"))[0]?.args.text ?? "";
    s.check("the sent message carries the absolute path", String(sent).includes(`\n/Users/demo/Vault/${hosting}\n`));
    s.check("and the typed text", String(sent).startsWith("Check and summarise it"));
    s.fact("send text", sent);
    // the page's menu: the chip lands in a new conversation of the note's project
    await settle(page, 300);
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Northwind Portal"]'));
    await click(page.locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]'));
    await page.locator(`[data-page="${hosting}"]`).first().click({ button: "right" });
    await click(button(page, "Add to conversation"));
    await settle(page, 400);
    s.check("Add to conversation shows the chip in a composer", (await chips("Hosting plan")) >= 1);
    s.check(
      "in a conversation of the note's project",
      (await composer(page).getAttribute("placeholder")) === "Ask something about Northwind Portal…",
    );
    // ⌥↵ in ⌘K
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("billing spec");
    await waitText(page, "Notes by name");
    await page.keyboard.press("ArrowDown");
    s.check("the hint offers ⌥↵", await hasText(page, "⌥↵ add to conversation"));
    await page.keyboard.press("Alt+Enter");
    await settle(page, 500);
    s.check("⌥↵ puts the note's chip in a composer", (await chips("Billing Spec")) === 1);
    s.check("⌘K is closed", !(await hasText(page, "Notes by name")));
    s.check(
      "in a conversation of that note's project",
      (await composer(page).getAttribute("placeholder")) === "Ask something about Beacon…",
    );
  },

  // issue 370: a note of another workspace is refused, and no chip is made
  async noteMentionOtherWorkspace(s) {
    const kb = { fixture: "kb-shared" };
    await s.load(kb);
    await s.load({ ...kb, sel: s.keys.switchTo });
    const { page } = s;
    const chips = () => visible(page.getByRole("button", { name: /^Rate policy/ })).count();
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await page.keyboard.type("policy");
    await s.waitCall("find_notes", 2);
    await page.keyboard.press("Tab");
    await settle(page, 300);
    s.check("its note is listed", await waitText(page, "Rate policy"));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Alt+Enter");
    await settle(page, 400);
    s.check("it says to switch workspace", await waitText(page, "Switch workspace to add this note", 3000));
    s.check("no chip is added", (await chips()) === 0);
    s.check("nothing is attached for the next message", (await s.calls("send")).length === 0);
  },

  // K6, issue 371: the feed shows a capture run as one entry with both diffs and its reason; Undo puts one note back
  // and leaves the other
  async changesFeed(s) {
    await s.load({ fixture: "kb-changes" });
    const { page } = s;
    const { billing, findings } = await openBilling(s);
    const note = path => page.evaluate(p => window.__harness.noteText(p), path);
    s.check(
      "the pill counts the entries to review",
      (await page.getByRole("button", { name: "Changes, 2 to review" }).count()) === 1,
    );
    await click(page.getByRole("button", { name: "Changes, 2 to review" }));
    s.check("the feed opens", await waitText(page, "written to the vault by Relay"));
    s.check(
      "one entry with the reason line",
      await hasText(page, "Decision: dry run first, live after Sofie confirms the rate rule"),
    );
    s.check(
      "and both notes' diffs",
      (await page.locator("[data-file]").count()) === 2 && (await hasText(page, "2 notes changed")),
    );
    await click(page.locator(`[data-file="${findings}"]`).getByRole("button", { name: "Undo", exact: true }));
    await settle(page, 300);
    s.check("Undo puts that note back", (await note(findings)).includes("Go live in sprint 24."));
    s.check("the other note stays", (await note(billing)).includes("Dry run first"));
    s.check("the row says so", await hasText(page, "Undone"));
    s.fact(
      "backend calls",
      (await s.calls("change_undo")).map(c => c.args.path),
    );
  },

  // issue 371: Undo on a note the user edited since shows the merge and writes nothing until it is applied
  async changesMerge(s) {
    await s.load({ fixture: "kb-changes" });
    const { page } = s;
    const { billing, findings } = await openBilling(s);
    const note = path => page.evaluate(p => window.__harness.noteText(p), path);
    await click(page.getByRole("button", { name: "Changes, 2 to review" }));
    await waitText(page, "written to the vault by Relay");
    // my line added after the run: the merge keeps it and takes the run's change out
    const mine = (await note(findings)) + "My own line.\n";
    await page.evaluate(([p, t]) => window.__harness.typeInto(p, t), [findings, mine]);
    await click(page.locator(`[data-file="${findings}"]`).getByRole("button", { name: "Undo", exact: true }));
    s.check("a merge is shown", await waitText(page, "You edited this note after the run"));
    s.check("and nothing is written yet", (await note(findings)) === mine);
    await click(button(page, "Apply merge"));
    await settle(page, 300);
    const merged = await note(findings);
    s.check("the merge keeps my line", merged.includes("My own line."));
    s.check(
      "and takes the run's change out",
      merged.includes("Go live in sprint 24.") && !merged.includes("Dry run in sprint 24"),
    );
    // my rewrite of the same lines: no merge, my text stays
    const rewrite = (await note(billing)).replace(
      "Dry run first, live after [[Sofie Claes]] confirms the rate rule",
      "Something else entirely",
    );
    await page.evaluate(([p, t]) => window.__harness.typeInto(p, t), [billing, rewrite]);
    await click(page.locator(`[data-file="${billing}"]`).getByRole("button", { name: "Undo", exact: true }));
    s.check("the same lines: nothing is overwritten", await waitText(page, "Nothing is overwritten"));
    s.check("my text is still there", (await note(billing)) === rewrite);
    s.check("and no merge to apply", (await button(page, "Apply merge").count()) === 0);
    await click(button(page, "Keep mine"));
    await settle(page, 200);
    s.check("Keep mine leaves it as it is", (await note(billing)) === rewrite);
  },

  // K7, issue 372: File with Claude proposes per note and writes nothing; Edit picks another folder, Skip leaves a note,
  // Accept moves it with its links and the filing is one entry in the Changes feed, undone from there
  async inboxFiling(s) {
    await s.load({ fixture: "kb-changes-inbox" });
    const { page } = s;
    const note = path => page.evaluate(p => window.__harness.noteText(p), path);
    await click(page.getByRole("tab", { name: /^Pages/ }));
    s.check(
      "the Pages tab has an Inbox row with its count",
      (await page.locator("[data-inbox]").textContent())?.includes("4") ?? false,
    );
    await click(page.locator("[data-inbox]"));
    s.check("the Inbox lists the 4 notes", await waitText(page, "4 notes"));
    s.check("no proposal and no Accept before File with Claude", (await button(page, "Accept", true).count()) === 0);
    await click(button(page, "File with Claude"));
    s.check("a proposal per note", await waitText(page, "Claude proposed a home for each"));
    s.check("File with Claude asked once", (await s.calls("inbox_propose")).length === 1);
    s.check(
      "nothing moved yet",
      (await note("Inbox/2026-10-01 0915.md")) !== null && (await s.calls("inbox_accept")).length === 0,
    );
    // Edit: another folder
    const row = path => page.locator(`[data-inbox-note="${path}"]`);
    await click(row("Inbox/2026-10-01 0830.md").getByRole("button", { name: "Edit" }));
    s.check(
      "Edit shows the destination as a picker with the type's home marked",
      await waitText(page, "home for Meeting"),
    );
    await click(page.getByRole("option", { name: /^Calendar\/Daily\/2026\// }));
    await click(row("Inbox/2026-10-01 0830.md").getByRole("button", { name: "Save" }));
    s.check(
      "Save keeps the picked folder",
      (await row("Inbox/2026-10-01 0830.md").textContent())?.includes("Calendar/Daily/2026/") ?? false,
    );
    // Skip
    await click(row("Inbox/2026-09-30 1740.md").getByRole("button", { name: "Skip" }));
    s.check(
      "Skip leaves the note in the list",
      (await row("Inbox/2026-09-30 1740.md").count()) === 1 && (await hasText(page, "Skipped")),
    );
    // Accept one: moved, linked, in the feed
    await click(row("Inbox/2026-10-01 0915.md").getByRole("button", { name: "Accept" }));
    await settle(page, 400);
    const dest = "Contexts/Agency/Projects/Northwind Portal/Documents/Portal go-live after tax rule check.md";
    const after = await note(dest);
    s.check(
      "Accept moved the note and set type, about and with",
      !!after &&
        after.includes("type: Document") &&
        after.includes('about: "[[Northwind Portal]]"') &&
        after.includes('with: "[[Sofie Claes]]"'),
    );
    s.check(
      "it left the Inbox",
      (await note("Inbox/2026-10-01 0915.md")) === null &&
        (await page.locator("[data-inbox]").textContent())?.includes("3"),
    );
    const fed = await s.calls("inbox_accept");
    s.check("one inbox_accept with that note only", fed.length === 1 && fed[0].args.items.length === 1);
    // the entry is in Changes (on a page), and Undo from there puts the note back
    await click(page.locator('[data-project="Northwind Portal"]'));
    await click(page.locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]'));
    await click(page.locator(`[data-page="${dest}"]`).first());
    await waitText(page, "Portal go-live after tax rule check");
    await click(page.getByRole("button", { name: /^Changes, \d+ to review/ }));
    s.check(
      "the filing is an Inbox filing entry with its reason",
      (await waitText(page, "Inbox filing")) && (await hasText(page, "Filed 1 capture: 1 Document")),
    );
    await click(
      page.locator(`[data-file="Inbox/2026-10-01 0915.md"]`).getByRole("button", { name: "Undo", exact: true }),
    );
    await click(page.locator(`[data-file="${dest}"]`).getByRole("button", { name: "Undo", exact: true }));
    await settle(page, 300);
    s.check(
      "Undo puts the note back in the Inbox as it was",
      (await note("Inbox/2026-10-01 0915.md")) ===
        "Sofie confirms the tax rule Friday → then take the Northwind portal live, tell Tom\n" &&
        (await note(dest)) === null,
    );
    // Accept all: the rest in one entry
    await click(page.getByRole("button", { name: "Close changes" }));
    await click(page.locator("[data-inbox]"));
    await click(button(page, "File with Claude"));
    await waitText(page, "Claude proposed a home for each");
    await click(button(page, "Accept all"));
    await settle(page, 400);
    s.check(
      "Accept all filed every note",
      (await page.locator("[data-inbox]").textContent())?.includes("4") === false &&
        (await hasText(page, "The Inbox is empty")),
    );
  },

  // K7, issue 372: the old scratch notes show a dry run first, Move writes them into the Inbox with about: set and the
  // drawer shows them per project, one Undo puts them back
  async inboxScratch(s) {
    await s.load({ fixture: "kb-changes-inbox" });
    const { page } = s;
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator("[data-inbox]"));
    await waitText(page, "2 older scratch notes");
    s.check("nothing was moved by looking", (await s.calls("scratch_migrate")).length === 0);
    await click(button(page, "Move into Inbox…"));
    s.check(
      "the dry run lists each note's project and new name",
      (await waitText(page, "Move scratch notes into the vault")) && (await hasText(page, "Inbox/2026-09-20 1015.md")),
    );
    s.check("one primary button on screen", (await page.locator(".btn-primary").count()) === 1);
    await click(button(page, "Move 2 notes"));
    await settle(page, 400);
    s.check(
      "the notes are in the Inbox with about:",
      (await page.evaluate(() => window.__harness.noteText("Inbox/2026-09-20 1015.md")))?.includes(
        'about: "[[Northwind Portal]]"',
      ),
    );
    s.check("the Inbox counts them", await waitText(page, "6 notes"));
    s.check("the toast offers the one Undo", await hasText(page, "Moved 2 scratch notes into the Inbox"));
    await click(page.getByRole("button", { name: "Undo", exact: true }));
    await settle(page, 400);
    s.check(
      "Undo puts them back outside the vault",
      (await s.calls("scratch_migrate_undo")).length === 1 &&
        (await waitText(page, "4 notes")) &&
        (await hasText(page, "2 older scratch notes")),
    );
  },

  // K7, issue 372: the capture window saves its text through quick_capture_save with ⌘↵ and puts the window away; Esc
  // puts it away without saving
  async quickCapture(s) {
    await s.load({ path: "/capture.html", fixture: "kb-changes-inbox" });
    const { page } = s;
    const field = page.getByRole("textbox", { name: "Quick capture" });
    s.check(
      "Save is off while the field is empty",
      await page.getByRole("button", { name: /^Save to Inbox/ }).isDisabled(),
    );
    await field.fill("Call Tom about the hosting window");
    await page.keyboard.press("Escape");
    await settle(page, 200);
    s.check(
      "Esc hides the window and saves nothing",
      (await s.calls("quick_capture_hide")).length === 1 && (await s.calls("quick_capture_save")).length === 0,
    );
    s.check("what was typed stays", (await field.inputValue()) === "Call Tom about the hosting window");
    await page.keyboard.press("Meta+Enter");
    await settle(page, 300);
    const saved = await s.calls("quick_capture_save");
    s.check(
      "⌘↵ saves the text to the Inbox",
      saved.length === 1 && saved[0].args.text === "Call Tom about the hosting window",
    );
    s.check("and the field is empty again", (await field.inputValue()) === "");
  },

  // K6, issue 371: a capture run lands in the feed as one entry; Fix properties (Ask Claude's menu) adds the missing
  // type and its run shows up there too
  async changesActions(s) {
    await s.load({ fixture: "kb-sketch" });
    const { page } = s;
    await openBilling(s);
    const note = path => page.evaluate(p => window.__harness.noteText(p), path);
    s.check("no badge before a run", (await page.getByRole("button", { name: "Changes, 0 to review" }).count()) === 1);
    await page.evaluate(() => window.__harness.capture());
    await settle(page, 300);
    await click(page.getByRole("button", { name: "Changes, 1 to review" }));
    s.check(
      "a capture run that edited 2 notes is one entry with 2 diffs",
      (await page.locator("[data-file]").count()) === 2 && (await hasText(page, "2 notes changed")),
    );
    s.check("with its reason", await hasText(page, "Decision: dry run first"));
    await click(page.getByRole("button", { name: "Close changes" }));
    // a note without type:
    const sketch = "Contexts/Agency/Projects/Northwind Portal/Documents/Pricing sketch.md";
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Northwind Portal"]'));
    await click(page.locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]'));
    await click(page.locator(`[data-page="${sketch}"]`).first());
    await waitText(page, "Pricing sketch");
    await click(button(page, "Ask Claude"));
    await click(button(page, "Fix properties"));
    await settle(page, 400);
    s.check(
      "page_action asked for the properties",
      (await s.calls("page_action")).some(c => c.args.action === "properties" && c.args.path === sketch),
    );
    s.check("the note has its type now", (await note(sketch)).startsWith("---\ntype: Document"));
    await click(page.getByRole("button", { name: /^Changes, 2 to review/ }));
    s.check("and the run is in the feed", await waitText(page, "Added type: Document"));
  },

  // issue 374 (K10): the Garden tab of the vault check. One of each problem with its count; a project picked on a meeting
  // writes about: and the row goes; Move to trash is a dry run, then one Undo; Ask Claude is a dry run too and its run is
  // one entry in the feed; one filled button at a time, also with a sheet open
  async vaultGarden(s) {
    await s.load({ fixture: "kb-sketch" });
    const { page } = s;
    await click(page.getByRole("button", { name: /^Switch workspace/ }));
    await click(button(page, "Check workspace…"), 300);
    await click(page.getByRole("tab", { name: /^Garden/ }), 300);
    const count = async kind => Number((await page.locator(`[data-garden=${kind}] span`).first().textContent()) ?? 0);
    const counts = [];
    for (const kind of ["outside_home", "no_project", "broken_link", "orphan", "unused_attachment", "no_type"])
      counts.push(await count(kind));
    s.check("each finding shows its count", counts.join(",") === "10,3,2,4,3,3");
    s.check("the tab counts them all", (await page.getByRole("tab", { name: /^Garden\s*25$/ }).count()) === 1);
    const primary = () =>
      page.locator('[role=dialog][aria-label^="Check"] .btn-primary').locator("visible=true").count();
    s.check("one filled button: Tidy structure", (await primary()) === 1);
    // a project picked on a meeting
    const meeting = "Calendar/Meetings/2026/2026-10-30 Call Sofie planning Q1.md";
    await page
      .getByLabel("Pick project: 2026-10-30 Call Sofie planning Q1")
      .selectOption({ label: "Northwind Portal" });
    await settle(page, 400);
    const about = (await s.calls("garden_about")).map(c => c.args);
    s.check(
      "the pick writes about:",
      about.length === 1 && about[0].path === meeting && about[0].project === "Northwind Portal",
    );
    s.check(
      "and the row is gone",
      (await count("no_project")) === 2 &&
        (await page.getByLabel("Pick project: 2026-10-30 Call Sofie planning Q1").count()) === 0,
    );
    // Move to trash: a dry run, one Undo
    await click(button(page, "Move to trash"), 300);
    s.check(
      "the dry run lists the files",
      (await hasText(page, "Dry run")) && (await hasText(page, "floor-plan-v1.png")),
    );
    s.check("with the sheet open the Apply button is the only filled one", (await primary()) === 1);
    await click(button(page, "Move 3 files to trash"), 500);
    s.check("three files went to the trash", (await s.calls("trash_path")).length === 3);
    s.check(
      "the dialog closes so the toast with Undo is reachable",
      (await page.getByRole("tab", { name: /^Garden/ }).count()) === 0,
    );
    await click(button(page, "Undo"), 400);
    s.check("one Undo puts all three back", (await s.calls("restore_path")).length === 3);
    await click(page.getByRole("button", { name: /^Switch workspace/ }));
    await click(button(page, "Check workspace…"), 300);
    await click(page.getByRole("tab", { name: /^Garden/ }), 300);
    s.check("and the row is there again", (await count("unused_attachment")) === 3);
    // Ask Claude to fix properties
    await click(button(page, "Ask Claude to fix properties"), 300);
    s.check(
      "its dry run lists the notes, one filled button",
      (await hasText(page, "Pricing ideas")) && (await primary()) === 1,
    );
    await click(button(page, "Ask Claude"), 600);
    const asked = (await s.calls("garden_ask")).map(c => c.args);
    s.check(
      "Claude is asked once for the 3 notes",
      asked.length === 1 && asked[0].action === "properties" && asked[0].paths.length === 3,
    );
    s.check("the row is gone", (await page.locator("[data-garden=no_type]").count()) === 0);
    await click(button(page, "Close"), 300);
    await openBilling(s);
    s.check(
      "its writes are one entry in the feed",
      (await page.getByRole("button", { name: /^Changes, [1-9]\d* to review/ }).count()) === 1,
    );
    // a broken link opens its note at the line
    await click(page.getByRole("button", { name: /^Switch workspace/ }));
    await click(button(page, "Check workspace…"), 300);
    await click(page.getByRole("tab", { name: /^Garden/ }), 300);
    await click(page.locator("[data-garden=broken_link]").getByRole("button", { name: "Review" }), 200);
    s.check("Review lists the links with their line", await hasText(page, "Northwind Portal.md:12"));
  },

  // issue 371: the meeting flow's own writes are in the feed: a prep's briefing, a wrap-up's Accept and a decision added
  // to its project's note, each one entry; Undo on the decision restores the project note exactly
  async changesMeeting(s) {
    await s.load({ fixture: "calendar" });
    const { page } = s;
    const notePath = "Calendar/2026-10-01 Sprint review Northwind Portal.md";
    const project = "Contexts/Agency/Projects/Northwind Portal/Northwind Portal.md";
    const projectText =
      "---\ntype: Product\n---\n# Northwind Portal\n\n## Status\nBuilding.\n\n## Decisions\n- 2026-09-20: Billing per month ([[Billing Spec]])\n\n## Open\n";
    const meetingText = [
      "---",
      "type: Meeting",
      'event: "EVENT"',
      "created: 2026-10-01",
      "language: nl",
      "---",
      "",
      "# Sprint review Northwind Portal",
      "",
      "## Notes",
      "- [09:31] Sprint 23 demo: API-koppeling werkt op staging, geen issues",
      "- [09:33] = Pricing-simulator komt in sprint 24, niet 25",
      "",
    ].join("\n");
    const id = await page.evaluate(
      ([project, projectText, notePath, meetingText]) => {
        const id = `review@${new Date(window.__harness.now + 4 * 60000).toISOString()}`;
        window.__harness.setNote(project, projectText);
        window.__harness.meetingNote(id, notePath, meetingText.replace("EVENT", id));
        return id;
      },
      [project, projectText, notePath, meetingText],
    );
    const recorded = async () => (await s.calls("change_record")).map(c => c.args);
    const text = path => page.evaluate(p => window.__harness.noteText(p), path);
    const day = page
      .locator('section[aria-label="Day"]')
      .getByRole("button", { name: "Sprint review Northwind Portal", exact: true });
    await click(visible(day).first(), 400);
    // the wrap-up: Accept writes the summary into the note, a click adds a decision to the project's note
    await click(page.getByRole("button", { name: "Wrap-up", exact: true }), 300);
    await click(button(page, "Write the summary"), 300);
    await waitText(page, "Built from");
    await click(button(page, "Accept"), 300);
    await waitText(page, "Saved to note ✓");
    await click(page.getByRole("button", { name: "Add to Northwind Portal note" }).first(), 300);
    await waitText(page, "Added ✓");
    const wrapups = (await recorded()).filter(r => r.source === "wrap-up");
    s.check(
      "Accept and the decision are one entry each",
      wrapups.length === 2 && wrapups.every(r => r.files.length === 1),
    );
    const decision = wrapups.find(r => r.files[0].path === project);
    s.check(
      "the decision's before/after is the project note",
      !!decision &&
        decision.files[0].before === projectText &&
        decision.files[0].after.includes("Pricing-simulator in sprint 24") &&
        decision.reason === "Decision from Sprint review Northwind Portal added to Northwind Portal",
    );
    const accept = wrapups.find(r => r.files[0].path === notePath);
    s.check(
      "Accept's after holds the summary",
      !!accept && accept.files[0].after.includes("## Summary") && !accept.files[0].before.includes("## Summary"),
    );
    // the prep: Claude writes the briefing into the note, then its turn ends
    await click(page.getByRole("button", { name: "Briefing", exact: true }), 300);
    await click(button(page, "Prep with Claude"), 400);
    const key = Object.keys(await s.chatChanges())[0];
    const withBriefing = (await text(notePath)) + "\n## Briefing\n### Doel\nDe sprint afronden.\n";
    await page.evaluate(
      ([path, t, key]) => {
        window.__harness.setNote(path, t);
        window.__harness.emitAgent(key, {
          type: "turn_end",
          ok: true,
          error: null,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          duration_ms: 1,
        });
      },
      [notePath, withBriefing, key],
    );
    await settle(page, 400);
    const prep = (await recorded()).find(r => r.source === "prep");
    s.check("the prep is recorded", !!prep && prep.reason === "Briefing for Sprint review Northwind Portal");
    s.check(
      "before: the note without a briefing, after: with it",
      !!prep && !prep.files[0].before.includes("## Briefing") && prep.files[0].after.includes("De sprint afronden."),
    );
    // all three in the feed; Undo on the decision puts the project note back exactly
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Northwind Portal"]'));
    await waitText(page, "Northwind Portal");
    await click(page.getByRole("button", { name: /^Changes, \d+ to review/ }));
    s.check(
      "the feed lists the prep and the wrap-up",
      (await waitText(page, "Briefing for “Sprint review Northwind Portal”")) &&
        (await hasText(page, "Meeting wrap-up “Sprint review Northwind Portal”")),
    );
    await click(page.getByRole("button", { name: /^Meeting wrap-up/ }).first(), 200); // the decision, the newest of the two
    await click(page.locator(`[data-file="${project}"]`).getByRole("button", { name: "Undo", exact: true }));
    await settle(page, 300);
    s.check("Undo restores the project note exactly", (await text(project)) === projectText);
    s.check("and leaves the meeting note's summary", (await text(notePath)).includes("## Summary"));
  },

  // K1, issue 369: a note pinned from its menu stands under Favourites above Recent, and is still there after a
  // restart (the backend keeps it in .relay/config.json); unfolded folders and a folder's sort are remembered too
  async favourites(s) {
    const kb = { fixture: "kb", keep: true }; // the mock keeps what the app saved over a reload, as a restart does
    await s.load(kb);
    const { page } = s;
    const findings = "Contexts/Agency/Projects/Northwind Portal/Documents/Rate limit findings.md";
    const row = path => page.locator(`[data-page="${path}"]`);
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Northwind Portal"]'));
    await click(page.locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]'));
    s.check(
      "no Favourites before anything is pinned",
      (await visible(page.locator('[data-section="pages:favourites"]')).count()) === 0,
    );
    await row(findings).click({ button: "right" });
    await click(button(page, "Add to favourites"));
    const set = await s.calls("set_favourites");
    s.check("pinning is saved by the backend", set.length === 1 && set[0].args.paths.join() === findings);
    const fav = page.locator('[data-section="pages:favourites"]');
    s.check(
      "the note stands under Favourites",
      (await visible(fav.locator(`[data-page="${findings}"]`)).count()) === 1,
    );
    // above Recent
    const order = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("[data-section], nav *")].filter(e =>
        /^(Favourites|Recent)$/.test(e.textContent?.trim() ?? ""),
      );
      return heads.map(e => e.textContent.trim());
    });
    s.fact("section order", order);
    // sort the folder by last changed (its notes' times come from the index)
    await page
      .locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]')
      .click({ button: "right" });
    await click(button(page, "Sort by last changed"));
    s.check("the sort is asked for the times", (await s.calls("note_times")).length >= 1);
    await settle(page, 500); // the app's UI state is written a quarter second after the last change
    // restart: the same workspace read again, the pin, the unfolded folders and the sort come back
    await s.load(kb);
    await click(page.getByRole("tab", { name: /^Pages/ }));
    s.check(
      "after a restart the pin is still there",
      (await visible(page.locator('[data-section="pages:favourites"] [data-page]')).count()) === 1,
    );
    s.check("the folder is still unfolded", (await row(findings).count()) >= 1);
    await page
      .locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]')
      .click({ button: "right" });
    s.check("the folder's sort is kept", await hasText(page, "Sort by name"));
    await page.keyboard.press("Escape");
    await settle(page);
    await row(findings).first().click({ button: "right" });
    await click(button(page, "Remove from favourites"));
    s.check(
      "unpinning leaves Favourites",
      (await visible(page.locator('[data-section="pages:favourites"]')).count()) === 0,
    );
    s.check("and is saved", (await s.calls("set_favourites")).pop()?.args.paths.length === 0);
  },

  // K2, issue 366: a note's right rail. 3 backlinks with their line, one opens the note at that line; Link on an
  // unlinked mention writes the wikilink and moves it to Backlinks; the outline jumps and follows the scroll; the fold
  // survives a restart
  async rail(s) {
    const kb = { fixture: "kb", keep: true };
    await s.load(kb);
    const { page } = s;
    const hosting = "Contexts/Agency/Projects/Northwind Portal/Documents/Hosting plan.md";
    // the text of the line the editor's cursor is on
    const cursorLine = () =>
      page.evaluate(() => {
        const r = document.querySelector(".cm-cursor")?.getBoundingClientRect();
        if (!r) return "";
        const y = r.top + r.height / 2;
        return (
          [...document.querySelectorAll(".cm-line")].find(l => {
            const b = l.getBoundingClientRect();
            return b.top <= y && y <= b.bottom;
          })?.textContent ?? ""
        );
      });
    const openHosting = async () => {
      await click(page.getByRole("tab", { name: /^Pages/ }));
      if ((await page.locator('[data-folder$="Northwind Portal/Documents"]').count()) === 0)
        await click(page.locator('[data-project="Northwind Portal"]'));
      if ((await page.locator(`[data-page="${hosting}"]`).count()) === 0)
        await click(page.locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]'));
      await click(page.locator(`[data-page="${hosting}"]`).first(), 400);
    };
    await openHosting();
    const section = id => page.locator(`[data-rail-section="${id}"]`);
    await section("backlinks").waitFor();
    s.check(
      "a note linked from 3 notes shows 3 backlinks",
      (await section("backlinks").locator("button.font-medium").count()) === 3,
    );
    s.check(
      "each with the line around the link",
      (await section("backlinks").textContent())?.includes("Last sync: [[Hosting plan]], cutover on 15 Oct.") ?? false,
    );
    s.check(
      "the breadcrumb shows the real folder",
      (await page.locator("[data-breadcrumb]").textContent()) === "ContextsAgencyProjectsNorthwind PortalDocuments",
    );
    s.check("and the about: chip", await hasText(page, "about:"));
    // a backlink opens its note at the line
    await click(
      section("backlinks").getByRole("button", { name: "Last sync: [[Hosting plan]], cutover on 15 Oct." }),
      600,
    );
    s.check("a backlink opens the note at its line", (await cursorLine()).includes("Last sync"));
    await openHosting();
    await section("unlinked").waitFor();
    s.check("2 unlinked mentions", (await section("unlinked").getByRole("button", { name: /^Link/ }).count()) === 2);
    // Link: the text becomes a wikilink through a normal write, and the note moves to Backlinks
    await click(page.getByRole("button", { name: "Link “Hosting plan” in 2026-09-29" }), 600);
    const writes = await s.calls("write_note");
    const w = writes.at(-1)?.args;
    s.check(
      "Link writes the wikilink in the other note",
      !!w && w.target.endsWith("2026-09-29.md") && w.text.includes("09:30 [[Hosting plan]] sync with Sofie"),
    );
    s.check("which moves to Backlinks", (await section("backlinks").locator("button.font-medium").count()) === 4);
    s.check(
      "and leaves the mentions",
      (await section("unlinked").getByRole("button", { name: /^Link/ }).count()) === 1,
    );
    // the outline jumps on a click and follows the scroll
    const marked = () => page.locator('[data-rail-section="outline"] [aria-current="true"]').textContent();
    await click(section("outline").getByRole("button", { name: "Cutover" }), 600);
    s.check("the outline jumps to a heading", (await marked()) === "Cutover");
    s.check("the editor's cursor is on it", (await cursorLine()).includes("Cutover"));
    // the reader scrolls (a wheel over the page); a click's own scroll did not move the mark
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, -3000);
    await settle(page, 400);
    s.check("scrolling up moves the mark to the first heading", (await marked()) === "Briefing");
    await page.mouse.wheel(0, 3000);
    await settle(page, 400);
    s.check("and down to the last", (await marked()) === "Next steps");
    // conversations that used it
    s.check(
      "2 conversations used the note",
      (await section("conversations").textContent())?.includes("Wrote") ?? false,
    );
    // the star in the bar pins the note (the same favourites as the sidebar's menu) and unpins it
    const fav = page.locator('[data-section="pages:favourites"]');
    await click(button(page, "Add to favourites"), 400);
    s.check("the star pins the note", (await s.calls("set_favourites")).at(-1)?.args.paths.join() === hosting);
    s.check("it stands under Favourites", (await visible(fav.locator(`[data-page="${hosting}"]`)).count()) === 1);
    s.check(
      "and the star is filled",
      (await button(page, "Remove from favourites").getAttribute("aria-pressed")) === "true",
    );
    await click(button(page, "Remove from favourites"), 400);
    s.check("a second click unpins it", (await s.calls("set_favourites")).at(-1)?.args.paths.length === 0);
    // the fold is kept over a restart
    await click(button(page, "Hide right rail"));
    s.check("Hide right rail folds it", (await page.locator("[data-rail]").count()) === 0);
    await settle(page, 500);
    await s.load(kb);
    await openHosting();
    s.check("after a restart it is still folded", (await page.locator("[data-rail]").count()) === 0);
    await click(button(page, "Show right rail"));
    s.check("Show right rail brings it back", (await page.locator("[data-rail]").count()) === 1);
  },

  // New ▸ from template on a folder and Today's note in the Pages tab: a Meeting in a project is saved in its home
  // with about: set, Today's note is made once
  async newFromTemplate(s) {
    await s.load({ fixture: "kb" });
    const { page } = s;
    await click(page.getByRole("tab", { name: /^Pages/ }));
    await click(page.locator('[data-project="Northwind Portal"]'));
    await page.locator('[data-project="Northwind Portal"]').click({ button: "right" });
    s.check("the project's menu lists the templates", await hasText(page, "New from template"));
    await click(button(page, "Meeting"));
    const made = await s.calls("new_from_template");
    s.check(
      "New Meeting in the project: template, folder, about and context",
      made.length === 1 &&
        made[0].args.template === "Meeting" &&
        made[0].args.about === "Northwind Portal" &&
        made[0].args.context === "Agency" &&
        made[0].args.folder === "Contexts/Agency/Projects/Northwind Portal",
    );
    await settle(page, 400);
    s.check("the note opens", String((await s.local(["sel"])).sel).includes("Calendar/Meetings/2026/"));
    s.fact("new from template", made[0]?.args ?? null);
    // a document goes to the folder asked in
    await page
      .locator('[data-folder="Contexts/Agency/Projects/Northwind Portal/Documents"]')
      .click({ button: "right" });
    await click(button(page, "Document"));
    const second = await s.calls("new_from_template");
    s.check(
      "a Document is made in the folder it was asked in",
      second[1]?.args.folder === "Contexts/Agency/Projects/Northwind Portal/Documents",
    );
    // Today's note
    await click(page.locator("[data-today-note]"));
    await click(page.locator("[data-today-note]"));
    await settle(page, 400);
    s.check("Today's note opens", String((await s.local(["sel"])).sel).includes("Calendar/Daily/2026/2026-10-01.md"));
    s.check(
      "asking twice leaves one note",
      (await s.calls("daily_note")).length === 2 &&
        (await page.evaluate(() => window.__harness.calls.filter(c => c.cmd === "daily_note").length)) === 2,
    );
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
    // a link from outside never sends by itself: it opens Cmd-K with the text typed in, Enter sends it
    await page.evaluate(t => window.__harness.deepLink(`relay://ask?q=${encodeURIComponent(t)}`), text);
    s.check("relay://ask?q= sends nothing by itself", !(await s.waitCall("send", 1, 800)));
    const field = await page.evaluate(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return {
        placeholder: el?.getAttribute("placeholder") ?? "",
        value: el?.value ?? null,
        caretAtEnd: el?.selectionStart === el?.value?.length && el?.selectionEnd === el?.value?.length,
      };
    });
    s.check(
      "it opens Cmd-K with the text, caret at the end",
      /ask a question/i.test(field.placeholder) && field.value === text && field.caretAtEnd,
    );
    await page.keyboard.press("Enter");
    s.check("Enter there sends", await s.waitCall("send"));
    await settle(page, 300);
    const sends = await s.calls("send");
    s.check(
      "as a quick question in a new conversation",
      sends.length === 1 && sends[0].args.project === "new#1" && String(sends[0].args.text).endsWith(text),
    );
    s.fact("chat changes", await s.chatChanges());
  },

  // what a fresh session ran on, when model and effort were left to the CLI (`resolved`): the pickers name it
  async resolvedDefaults(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const shown = () =>
      page.evaluate(() =>
        window.__dom
          .all("select")
          .map(x => x.selectedOptions[0]?.textContent.trim())
          .filter(t => /default/i.test(t ?? "")),
      );
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
    s.check(
      "the project's conversations closed",
      closed.length === 4 && closed.every(([, c]) => c.project === "Northwind Portal"),
    );
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

  // Files attached by their path: + picker, Finder drop (Tauri's drag events), chips, the <relay-files> block, auto-allowed reads
  async attachFiles(s) {
    await s.load();
    await s.load({ sel: s.keys.switchTo });
    const { page } = s;
    const pdf = "/Users/demo/Downloads/Q3 report.pdf";
    const png = "/Users/demo/Pictures/site photo.png";
    const xlsx = "/Users/demo/Downloads/Budget 2027.xlsx";
    const notes = "/Users/demo/Documents/notes draft.txt";
    const gone = "/Users/demo/Downloads/missing file.pdf";
    const chip = name =>
      visible(page.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}`) })).first();
    const pictures = () => visible(page.locator("img")).count();
    const set = (key, value) => page.evaluate(([k, v]) => (window.__harness[k] = v), [key, value]);
    const dropPaths = paths =>
      page.evaluate(paths => window.__harness.dropPaths(paths), paths).then(() => settle(page, 300));
    const pick = async path => {
      await set("pickFiles", [path]);
      await click(button(page, "Attach files"), 300);
    };
    const chips = name => visible(page.getByRole("button", { name: new RegExp(`^${name}`) })).count();
    // the picker (the hidden <input type=file> is gone)
    const picturesBefore = await pictures();
    await pick(pdf);
    s.check("pick_files called", (await s.calls("pick_files")).length === 1);
    s.check("a picked pdf shows as a chip", (await chips("Q3 report.pdf")) === 1);
    // a Finder drop: the picture inline, the other files as chips
    await dropPaths([png, xlsx, notes]);
    s.check(
      "the dropped picture was read",
      (await s.calls("read_image")).some(c => c.args.path === png),
    );
    s.check(
      "a non-picture is never read as an image",
      (await s.calls("read_image")).every(c => c.args.path === png),
    );
    s.check("the picture became a thumbnail", (await pictures()) === picturesBefore + 1);
    s.check("the picture has no chip", (await chips("site photo.png")) === 0);
    s.check(
      "xlsx and txt are chips",
      (await chips("Budget 2027.xlsx")) === 1 && (await chips("notes draft.txt")) === 1,
    );
    s.check(
      "the chip's title holds the full path",
      (await chip("notes draft.txt").getAttribute("title"))?.startsWith(notes),
    );
    // × removes a chip
    await chip("notes draft.txt").hover();
    await click(button(page, "Remove file"), 200);
    s.check(
      "× removes the chip",
      (await chips("notes draft.txt")) === 0 &&
        (await chips("Budget 2027.xlsx")) === 1 &&
        (await chips("Q3 report.pdf")) === 1,
    );
    // a click opens the file, Option-click shows it in Finder, a file that is gone says so
    await chip("Q3 report.pdf").click({ timeout: 4000 });
    await settle(page, 200);
    await chip("Budget 2027.xlsx").click({ modifiers: ["Alt"], timeout: 4000 });
    await settle(page, 200);
    const opens = await s.calls("open_file");
    s.check("a click opens, reveal false", opens[0]?.args.path === pdf && opens[0]?.args.reveal === false);
    s.check("Option-click reveals", opens[1]?.args.path === xlsx && opens[1]?.args.reveal === true);
    await pick(gone);
    await chip("missing file.pdf").click({ timeout: 4000 });
    s.check("a missing file shows the toast", await waitText(page, "missing file.pdf is no longer where it was", 3000));
    await chip("missing file.pdf").hover();
    await click(button(page, "Remove file"), 200);
    s.check("the missing chip is removed", (await chips("missing file.pdf")) === 0);
    // send
    const text = "Compare these with the plan";
    await typeInComposer(page, text);
    await page.keyboard.press("Enter");
    s.check("send called", await s.waitCall("send"));
    const sends = await s.calls("send");
    const block = `\n\n<relay-files>\nAttached files, read them from these paths:\n${pdf}\n${xlsx}\n</relay-files>`;
    s.check(
      "send text ends with the files block listing the remaining paths",
      sends.length === 1 && String(sends[0].args.text).endsWith(`${text}${block}`),
    );
    s.check(
      "the picture goes as one inline image",
      sends[0]?.args.images?.length === 1 && sends[0].args.images[0].media_type === "image/png",
    );
    await settle(page, 300);
    s.check("composer chips cleared", (await chips("Q3 report.pdf")) === 1 && (await chips("Budget 2027.xlsx")) === 1); // only the message's own
    s.check(
      "the message shows the text without the block",
      (await waitText(page, text)) && !(await hasText(page, "<relay-files>")),
    );
    s.fact("send text", sends[0]?.args.text);
    // a Read of an attached path needs no card, a Read of another path does
    const request = (id, file) => ({
      id,
      project: s.keys.switchTo,
      provider: "claude",
      kind: "tool",
      tool_name: "Read",
      input: { file_path: file },
      tool_use_id: `toolu_${id}`,
      relay: false,
      at: Date.now(),
    });
    await page.evaluate(r => window.__harness.addPending(r), request("read-0001", xlsx));
    s.check("answer called for the attached path", await s.waitCall("answer", 1, 6000));
    await settle(page, 600);
    const answers = await s.calls("answer");
    s.check(
      "answered once, allow",
      answers.length === 1 && answers[0].args.id === "read-0001" && answers[0].args.decision?.behavior === "allow",
    );
    s.check(
      "no card shown, an allowed line instead",
      (await visible(button(page, "Allow")).count()) === 0 &&
        (await hasText(page, "Allowed")) &&
        (await hasText(page, xlsx)),
    );
    await page.evaluate(
      r => window.__harness.addPending(r),
      request("read-0002", "/Users/demo/Documents/other secrets.txt"),
    );
    s.check(
      "a Read of another path still shows a card",
      (await waitText(page, "other secrets.txt", 6000)) && (await visible(button(page, "Allow")).count()) === 1,
    );
    s.check("the other card is not answered", (await s.calls("answer")).length === 1);
    // Cmd-K takes the drop while it is open
    await s.load({ sel: s.keys.switchTo });
    await page.keyboard.press("Meta+k");
    await settle(page, 300);
    await dropPaths([pdf]);
    const dialog = page.getByRole("dialog");
    s.check(
      "the chip is in the Cmd-K dialog",
      (await dialog.getByRole("button", { name: /^Q3 report\.pdf/ }).count()) === 1,
    );
    s.check(
      "not in the composer behind it",
      (await visible(page.getByRole("button", { name: /^Q3 report\.pdf/ })).count()) === 1,
    );
    await page.keyboard.press("Enter");
    s.check("Cmd-K sends the path", await s.waitCall("send"));
    const quick = await s.calls("send");
    s.check(
      "the quick question carries the files block",
      String(quick[0]?.args.text).includes(
        `<relay-files>\nAttached files, read them from these paths:\n${pdf}\n</relay-files>`,
      ),
    );
  },
};
// calendar: Codex is the default agent, a meeting conversation still runs on Claude; calendarNoClaude: Claude is off
const OVERRIDES = {
  typingOutside: { outside: "switchTo" },
  calendar: { agents: { default: "codex" } },
  calendarNoClaude: { agents: { default: "codex", off: ["claude"] } },
};
// a scenario that is allowed to fail on a frontend (known bug), shown but not counted
const KNOWN = {
  typingOutside: "Lit loses the text: takeText runs before the outside check (src/domain/chats/actions.ts)",
  mail: "Lit drops a link clicked in a mail: mailLinkClicked checks panel.open, the Mail view keeps the mail in panel.mailOpen (src/domain/mail.ts)",
  mailTriageFilter:
    "Lit keeps mails hidden by the read filter in the selection after marking them read (mailSeen in src/domain/mail.ts does not prune), E then moves mails out of sight",
  // an intended difference, not a Lit bug to port: React fixed it on review (security)
  // Lit bugs from the review of #54, fixed in the React port
  calendar:
    "Lit keys a meeting's banner on Waiting (a second meeting's replaces it), checks only https:// before Join, and starts the meeting conversation on the default agent, which only Claude runs restricted",
  calendarNoClaude: "Lit starts the meeting conversation on the default agent, unrestricted when that is not Claude",
  deepLinks:
    "Lit sends relay://ask?q=<text> at once (quickSend in src/app/deep-links.ts); React opens Cmd-K with the text and waits for Enter",
  agentAccounts:
    "Lit saves a blank account name and names every account's button just Remove; React keeps the old name and labels it Remove <name> (review of #45)",
};

// ---------- compare
function compare(a, b) {
  const A = JSON.parse(readFileSync(`${RESULTS}/behaviour-${a}.json`, "utf8"));
  const B = JSON.parse(readFileSync(`${RESULTS}/behaviour-${b}.json`, "utf8"));
  const line = c => `${c.cmd} ${JSON.stringify(c.args)}`;
  // a plain LCS diff of two lists of lines
  const diff = (x, y) => {
    const m = x.length,
      n = y.length,
      t = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--)
      for (let j = n - 1; j >= 0; j--)
        t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    const out = [];
    let i = 0,
      j = 0;
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
    const x = A.scenarios[name] ?? {},
      y = B.scenarios[name] ?? {};
    const out = [];
    if (x.error || y.error) out.push(`  error: ${a}: ${x.error ?? "-"} | ${b}: ${y.error ?? "-"}`);
    for (const check of new Set([...Object.keys(x.checks ?? {}), ...Object.keys(y.checks ?? {})])) {
      const p = x.checks?.[check],
        q = y.checks?.[check];
      if (p !== q)
        out.push(
          `  check "${check}": ${a} ${p === undefined ? "-" : p ? "pass" : "FAIL"}, ${b} ${q === undefined ? "-" : q ? "pass" : "FAIL"}`,
        );
    }
    const effects = diff((x.effects ?? []).map(line), (y.effects ?? []).map(line));
    if (effects.some(l => !l.startsWith("    "))) out.push("  effects:", ...effects.map(l => `  ${l}`));
    for (const fact of new Set([...Object.keys(x.facts ?? {}), ...Object.keys(y.facts ?? {})])) {
      const p = JSON.stringify(x.facts?.[fact]),
        q = JSON.stringify(y.facts?.[fact]);
      if (p !== q) out.push(`  fact "${fact}":\n    - ${p}\n    + ${q}`);
    }
    const reads = [];
    for (const r of new Set([...Object.keys(x.reads ?? {}), ...Object.keys(y.reads ?? {})]))
      if ((x.reads?.[r] ?? 0) !== (y.reads?.[r] ?? 0)) reads.push(`${r} ${x.reads?.[r] ?? 0}→${y.reads?.[r] ?? 0}`);
    if (reads.length) out.push(`  reads (info): ${reads.join(", ")}`);
    const status = sc =>
      sc.error
        ? "error"
        : `${Object.values(sc.checks ?? {}).filter(Boolean).length}/${Object.keys(sc.checks ?? {}).length}`;
    console.log(
      `${out.filter(l => !l.startsWith("  reads")).length ? "DIFF" : "same"}  ${name}  (${a} ${status(x)}, ${b} ${status(y)})`,
    );
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
    const failed = Object.entries(r.checks)
      .filter(([, ok]) => !ok)
      .map(([c]) => c);
    const tag = error ? "ERROR" : failed.length ? (known ? "KNOWN" : "FAIL ") : "ok   ";
    console.log(
      `${tag} ${name}  ${Object.keys(r.checks).length - failed.length}/${Object.keys(r.checks).length}${error ? `  ${error}` : ""}${failed.length ? `  failed: ${failed.join("; ")}` : ""}`,
    );
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
  const bad = Object.values(results.scenarios).filter(
    r => !r.known && (r.error || Object.values(r.checks).some(ok => !ok)),
  );
  process.exit(bad.length ? 1 : 0);
}
