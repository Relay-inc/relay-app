// Run by selftest.rs: __STEP__ "settings" picks __MACHINE__ in Settings › Machines › "New conversations run on",
// "main" opens a new general conversation and reads the composer's machine pick. Reports {ok, steps, picked} as
// `selftest-ui`.
(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (what, f, ms = 10000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = f();
      if (v) return v;
      await sleep(200);
    }
    throw new Error("timed out: " + what);
  };
  let picked = "";
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps, picked } });
  try {
    if ("__STEP__" === "settings") {
      const tab = await until("Machines tab", () => [...document.querySelectorAll("nav button")].find(b => b.textContent.includes("Machines")));
      tab.click();
      const select = await until("the run-default select", () => document.getElementById("mcdefault"));
      const option = await until("__MACHINE__ in it", () => [...select.options].find(o => o.textContent === "__MACHINE__"));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      // the page reads the settings again: the select keeps the machine
      await sleep(1000);
      picked = await until("saved", () => document.getElementById("mcdefault")?.selectedOptions[0]?.textContent === "__MACHINE__" && "__MACHINE__");
      steps.push("default set");
    } else {
      (await until("the new conversation button", () => document.querySelector('.relay-sidebar button[aria-label="New conversation"]'))).click();
      const pick = () => document.querySelector('.relay-composer button[aria-label="Runs on"]');
      picked = await until("__MACHINE__ preselected", () => pick()?.textContent === "__MACHINE__" && pick().textContent);
      steps.push("pick preselected");
    }
    report(true);
  } catch (e) {
    steps.push("error: " + e.message);
    report(false);
  }
})();
