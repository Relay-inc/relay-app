// Run in the settings window by selftest.rs: Settings › Machines the way a user does it (the app is in English for
// the test). Reports {ok, steps, text} back as the event `selftest-ui`.
(async () => {
  const steps = [];
  const report = ok =>
    window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "selftest-ui",
      payload: { ok, steps, text: (machines()?.shadowRoot?.textContent ?? "").replace(/\s+/g, " ").slice(0, 600) },
    });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const root = () => document.querySelector("relay-settings")?.shadowRoot;
  const machines = () => root()?.querySelector("relay-settings-machines");
  const until = async (what, f, ms = 8000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = f();
      if (v) return v;
      await sleep(200);
    }
    throw new Error("timed out: " + what);
  };
  const button = (label, scope = machines().shadowRoot) =>
    [...scope.querySelectorAll("button")].find(b => b.textContent.trim() === label && !b.disabled);
  const type = async (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await machines().updateComplete;
  };
  try {
    const tab = await until("Machines tab", () => [...root().querySelectorAll("nav button")].find(b => b.textContent.includes("Machines")));
    tab.click();
    await until("Machines page", () => machines()?.hasAttribute("active"));
    steps.push("tab");
    const [line, name] = machines().shadowRoot.querySelectorAll("input");
    await type(line, "__LINE__");
    await type(name, "docker");
    (await until("Pair button", () => button("Pair"))).click();
    await until("the paired machine", () => machines().shadowRoot.textContent.includes("docker") && button("Add folder"), 15000);
    steps.push("paired");
    await until("online", () => machines().shadowRoot.textContent.includes("Online"), 10000);
    steps.push("online");
    button("Add folder").click();
    await machines().updateComplete;
    const select = await until("project select", () => machines().shadowRoot.querySelector("select"));
    await until("the project in the list", () => [...select.options].some(o => o.value === "__PROJECT__"));
    select.value = "__PROJECT__";
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await machines().updateComplete;
    const path = [...machines().shadowRoot.querySelectorAll("input")].find(i => i.placeholder.startsWith("/home/"));
    await type(path, "__PATH__");
    button("Save").click();
    await until("saved", () => machines().shadowRoot.textContent.includes("Saved"), 8000);
    steps.push("folder saved");
    await sleep(500);
    report(true);
  } catch (e) {
    steps.push("error: " + e.message);
    report(false);
  }
})();
