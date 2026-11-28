// The README's screenshots: node harness/readme-shots.mjs [--browser webkit] [--port 1470]
// Runs the views of screens.mjs listed below against the mock backend (1440x900 at 2x, WebKit as in the app) and writes
// them to docs/images/ as 1600 px wide JPEGs (sips, macOS). Look at every image before committing: fictional data only.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { HERE, arg } from "./lib.mjs";

const OUT = `${HERE}../docs/images`;
const TMP = `${HERE}screens/readme`;
// docs/images name -> view in screens.mjs
const SHOTS = {
  "hero-dark": "drawer-security-dark",
  waiting: "waiting",
  "project-home": "project-home",
  "project-panel-builds": "drawer-builds",
  "project-panel-security": "drawer-security",
  "orchestrator-live": "orchestrator-live",
  board: "board",
  "pr-detail": "pr-detail",
  "brain-graph": "pages-graph",
};

const port = arg("port", "1470");
const vite = spawnSync(
  "node",
  [
    `${HERE}screens.mjs`,
    "--label",
    "readme",
    "--browser",
    arg("browser", "webkit"),
    "--url",
    `http://127.0.0.1:${port}`,
    "--only",
    Object.values(SHOTS).join(","),
  ],
  { stdio: "inherit" },
);
if (vite.status) process.exit(vite.status);

mkdirSync(OUT, { recursive: true });
for (const [name, view] of Object.entries(SHOTS)) {
  const png = `${TMP}/${view}.png`;
  const jpg = `${OUT}/${name}.jpg`;
  rmSync(jpg, { force: true });
  const r = spawnSync("sips", ["-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "80", png, "--out", jpg]);
  if (r.status) throw new Error(`sips failed for ${view}`);
}
