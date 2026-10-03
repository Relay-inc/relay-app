// Run in the main window by selftest.rs: open the project in the sidebar, type a message, press Enter, and wait for
// the machine's answer and the composer's "on <machine>" label. Reports {ok, steps, label} as `selftest-ui`.
(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = () => document.body.textContent;
  const until = async (what, f, ms = 10000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = f();
      if (v) return v;
      await sleep(200);
    }
    throw new Error("timed out: " + what);
  };
  // React tracks a field's value itself: set it through the element's own setter, then tell React it changed
  const type = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  let label = "";
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps, label } });
  try {
    // a project without open work only shows up when searched for, as a user would
    const search = await until("the sidebar search", () => document.querySelector(".relay-sidebar input"));
    type(search, "__PROJECT__");
    const row = await until("__PROJECT__ in the sidebar", () => document.querySelector('[data-project="__PROJECT__"]'));
    row.click();
    steps.push("project opened");
    const field = await until("the composer", () => document.querySelector(".relay-composer textarea"));
    type(field, "hi from the UI");
    await sleep(100);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    steps.push("sent");
    // the stand-in claude echoes the whole prompt, the project line in front included
    await until("the machine's answer", () => /echo from relay-docker:[\s\S]*hi from the UI/.test(text()), 20000);
    steps.push("answered by the machine");
    // after the first message the pick says where it runs (and moves it when changed)
    label = await until("the composer pick on the machine", () => {
      const shown = document.querySelector(".relay-composer select[aria-label='Runs on']")?.selectedOptions[0]?.textContent || "";
      return shown.startsWith("docker") && shown;
    }, 15000);
    steps.push("pick shows the machine");
    report(true);
  } catch (e) {
    steps.push("error: " + e.message);
    label = text().replace(/\s+/g, " ").slice(0, 1000);
    report(false);
  }
})();
