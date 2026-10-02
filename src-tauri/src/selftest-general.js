// Run in the main window by selftest.rs after selftest-main.js: a new general conversation, the composer's machine
// pick set to __MACHINE__, a message, the machine's answer and the "on __MACHINE__" label. Reports {ok, steps, label}
// as `selftest-ui`.
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
  const set = (el, value, event) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  };
  let label = "";
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps, label } });
  const composer = () => document.querySelector(".relay-composer");
  try {
    (await until("the new conversation button", () => document.querySelector('.relay-sidebar button[aria-label="New conversation"]'))).click();
    await until("an empty composer", () => composer()?.querySelector("textarea")?.value === "");
    steps.push("general conversation");
    const pick = await until("the machine pick", () => composer()?.querySelector('select[aria-label="Runs on"]'));
    steps.push("pick shows " + pick.selectedOptions[0]?.textContent);
    const option = await until("__MACHINE__ available", () => [...pick.options].find(o => o.textContent.startsWith("__MACHINE__ ") && !o.disabled));
    set(pick, option.value, "change");
    await until("__MACHINE__ picked", () => composer().querySelector('select[aria-label="Runs on"]')?.value === option.value);
    steps.push("picked " + option.textContent);
    const field = composer().querySelector("textarea");
    set(field, "hi general", "input");
    await sleep(100);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    steps.push("sent");
    // the stand-in claude echoes the prompt, possibly with a line in front
    await until("the machine's answer", () => /echo from relay-docker:[\s\S]*hi general/.test(text()), 20000);
    steps.push("answered by the machine");
    label = await until("the composer label", () => !composer().querySelector("select[aria-label='Runs on']") && (composer().textContent.match(/on __MACHINE__/) || [])[0], 15000);
    steps.push("label shown, pick gone");
    report(true);
  } catch (e) {
    steps.push("error: " + e.message);
    label = text().replace(/\s+/g, " ").slice(0, 1000);
    report(false);
  }
})();
