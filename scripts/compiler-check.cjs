// Fails when the React Compiler skips a component or hook. Lint does not see these bailouts, and a skipped component
// silently loses its memoisation. Same compiler and options as vite.config.ts (the plugin-react preset), same parser
// as @rolldown/plugin-babel (typescript + jsx). Usage: node scripts/compiler-check.cjs [files…] (default: every .ts and .tsx under src/ui).
const babel = require("@babel/core");
const fs = require("node:fs");
const path = require("node:path");

const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [full] : [];
  });

(async () => {
  const { reactCompilerPreset } = await import("@vitejs/plugin-react");
  const [[compiler, options]] = reactCompilerPreset().preset().plugins;
  const files = process.argv.length > 2 ? process.argv.slice(2) : walk("src/ui");
  let failed = 0;
  let compiled = 0;
  for (const file of files) {
    const events = [];
    babel.transformSync(fs.readFileSync(file, "utf8"), {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { sourceType: "module", plugins: ["typescript", "jsx"] },
      plugins: [[compiler, { ...options, logger: { logEvent: (_file, event) => events.push(event) } }]],
    });
    compiled += events.filter(event => event.kind === "CompileSuccess").length;
    const reasons = [
      ...new Set(
        events
          .filter(event => event.kind !== "CompileSuccess" && event.kind !== "CompileSkip")
          .map(event => {
            const detail = event.detail?.options ?? event.detail ?? {};
            const where = detail.loc?.start ? `:${detail.loc.start.line}` : event.fnLoc?.start ? `:${event.fnLoc.start.line}` : "";
            return `${event.kind}${where} ${detail.reason ?? event.data ?? ""}`.trim();
          }),
      ),
    ];
    if (!reasons.length) continue;
    failed++;
    console.log(`${file}\n  ${reasons.join("\n  ")}`);
  }
  console.log(`${files.length} files, ${compiled} functions compiled, ${failed} files with a bailout`);
  process.exitCode = failed ? 1 : 0;
})();
