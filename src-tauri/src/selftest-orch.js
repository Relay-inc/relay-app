// RELAY_SELFTEST=orch, in the main window: open the Orchestrator the way a user does and check that the board shows
// every worker Relay recorded and the coordinator shows the reports as Relay's blocks
(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps } });
  try {
    const titles = __TITLES__;
    const row = [...document.querySelectorAll("button, a, [role=button]")].find(e => e.textContent.trim().startsWith("Orchestrator"));
    steps.push("orchestrator row: " + !!row);
    row.click();
    await sleep(2500);
    const text = document.body.innerText;
    const missing = titles.filter(t => !text.includes(t));
    steps.push("workers on the board: " + (titles.length - missing.length) + "/" + titles.length + (missing.length ? ", missing " + missing.join(", ") : ""));
    const blocks = (text.match(/From Relay/g) || []).length;
    steps.push("From Relay blocks: " + blocks);
    report(missing.length === 0 && blocks > 0);
  } catch (e) { steps.push("error: " + e.message); report(false); }
})();
