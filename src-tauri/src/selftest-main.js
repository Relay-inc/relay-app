// Run in the main window by selftest.rs: open the project in the sidebar, type a message, press Enter, and wait for
// the machine's answer and the composer's "on <machine>" label. Reports {ok, steps, label} as `selftest-ui`.
(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // through every shadow root: the app is web components all the way down
  const all = (root = document) => [...root.querySelectorAll("*")].flatMap(el => [el, ...(el.shadowRoot ? all(el.shadowRoot) : [])]);
  const text = () => all().filter(el => el.shadowRoot).map(el => el.shadowRoot.textContent).join(" ");
  const until = async (what, f, ms = 10000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = f();
      if (v) return v;
      await sleep(200);
    }
    throw new Error("timed out: " + what);
  };
  let label = "";
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps, label } });
  try {
    // a project without open work only shows up when searched for, as a user would
    const sidebar = await until("the sidebar", () => all().find(el => el.tagName === "RELAY-SIDEBAR"));
    const search = await until("the sidebar search", () => all(sidebar.shadowRoot).find(el => el.tagName === "INPUT"));
    search.value = "__PROJECT__";
    search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    const row = await until("__PROJECT__ in the sidebar", () => all().find(el => el.getAttribute?.("data-project") === "__PROJECT__"));
    row.click();
    steps.push("project opened");
    const field = await until("the composer", () => all().find(el => el.tagName === "TEXTAREA"));
    field.value = "hi from the UI";
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await sleep(100);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, composed: true }));
    steps.push("sent");
    await until("the machine's answer", () => text().includes("echo from relay-docker: hi from the UI"), 20000);
    steps.push("answered by the machine");
    const composer = all().find(el => el.tagName === "RELAY-COMPOSER");
    label = await until("the composer label", () => (composer.shadowRoot.textContent.match(/on docker/) || [])[0], 15000);
    steps.push("label shown");
    report(true);
  } catch (e) {
    steps.push("error: " + e.message);
    label = document.body.innerHTML.slice(0, 300) + " | " + text().replace(/\s+/g, " ").slice(0, 700);
    report(false);
  }
})();
