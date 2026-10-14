// RELAY_SELFTEST=orch, in the main window: open the Orchestrator the way a user does and check that the board shows
// every worker Relay recorded and the coordinator shows Relay's turns (report cards, folded notices) as Relay's, not the user's
(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps } });
  try {
    const titles = __TITLES__;
    // the coordinator's sidebar row, by its key (its title is the agent's); a folded list ("3 more") opens first
    let row = document.querySelector('[data-key="c:orch"]');
    if (!row) {
      [...document.querySelectorAll("[role=button]")].filter(e => /^\d+ more$/.test(e.textContent.trim())).forEach(e => e.click());
      await sleep(500);
      row = document.querySelector('[data-key="c:orch"]');
    }
    steps.push("orchestrator row: " + !!row);
    row.click();
    // the coordinator opens with its workers column; its history loads from the transcript
    for (let i = 0; i < 20 && !document.querySelector("[data-relay-turn]"); i++) await sleep(500);
    const text = document.body.innerText;
    const missing = titles.filter(t => !text.includes(t));
    steps.push("workers on the board: " + (titles.length - missing.length) + "/" + titles.length + (missing.length ? ", missing " + missing.join(", ") : ""));
    const blocks = document.querySelectorAll("[data-relay-turn]").length;
    steps.push("Relay turns: " + blocks + " (" + document.querySelectorAll('[data-relay-turn="report"]').length + " report cards)");
    if (!blocks) steps.push("row: " + row.outerHTML.slice(0, 200), "page: " + (document.querySelector("main") || document.body).innerText.slice(0, 400));
    report(missing.length === 0 && blocks > 0);
  } catch (e) { steps.push("error: " + e.message); report(false); }
})();
