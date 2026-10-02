// Run in the settings window by selftest.rs: Settings › Machines the way a user does it (the app is in English for
// the test). Reports {ok, steps, text} back as the event `selftest-ui`.
(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // the Machines page: the page container around its pairing field (every page stays mounted, only one shows)
  const page = () => document.getElementById("mcline")?.closest(".contents");
  const report = ok =>
    window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "selftest-ui",
      payload: { ok, steps, text: (page()?.textContent ?? "").replace(/\s+/g, " ").slice(0, 600) },
    });
  const until = async (what, f, ms = 8000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = f();
      if (v) return v;
      await sleep(200);
    }
    throw new Error("timed out: " + what);
  };
  const button = (label, scope = page()) =>
    [...(scope?.querySelectorAll("button") ?? [])].find(b => b.textContent.trim() === label && !b.disabled);
  // React tracks a field's value itself: set it through the element's own setter, then tell React it changed
  const set = async (el, value, event) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
    await sleep(50);
  };
  try {
    const tab = await until("Machines tab", () => [...document.querySelectorAll("nav button")].find(b => b.textContent.includes("Machines")));
    tab.click();
    await until("Machines page", () => page());
    steps.push("tab");
    await set(document.getElementById("mcline"), "__LINE__", "input");
    await set(document.getElementById("mcname"), "docker", "input");
    (await until("Pair button", () => button("Pair"))).click();
    await until("the paired machine", () => page().textContent.includes("docker") && button("Add folder"), 15000);
    steps.push("paired");
    await until("online", () => page().textContent.includes("Online"), 10000);
    steps.push("online");
    button("Add folder").click();
    const select = await until("project select", () => page().querySelector("select"));
    await until("the project in the list", () => [...select.options].some(o => o.value === "__PROJECT__"));
    await set(select, "__PROJECT__", "change");
    const path = await until("path field", () => [...page().querySelectorAll("input")].find(i => i.placeholder.startsWith("/home/")));
    await set(path, "__PATH__", "input");
    button("Save").click();
    await until("saved", () => page().textContent.includes("Saved"), 8000);
    steps.push("folder saved");
    await sleep(500);
    report(true);
  } catch (e) {
    steps.push("error: " + e.message);
    report(false);
  }
})();
