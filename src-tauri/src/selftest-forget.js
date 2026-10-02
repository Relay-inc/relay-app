(async () => {
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const page = () => document.getElementById("mcline")?.closest(".contents");
  const report = ok => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "selftest-ui", payload: { ok, steps, text: (page()?.textContent ?? "").replace(/\s+/g, " ").slice(0, 500) } });
  const buttons = label => [...(page()?.querySelectorAll("button") ?? [])].filter(b => b.textContent.trim() === label);
  try {
    steps.push("forget buttons before: " + buttons("Forget").length);
    buttons("Forget")[0].click();
    await sleep(500);
    steps.push("after first click, forget buttons: " + buttons("Forget").length + ", confirm shown: " + page().textContent.includes("Forget this machine?"));
    const b = buttons("Forget");
    b[b.length - 1].click();
    await sleep(2000);
    steps.push("after confirm: still listed: " + page().textContent.includes("docker") + ", empty text: " + page().textContent.includes("No machines yet"));
    report(!page().textContent.includes("127.0.0.1:47811"));
  } catch (e) { steps.push("error: " + e.message); report(false); }
})();
