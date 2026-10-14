// Lets `node --test` import what Vite imports as `x.md?raw`: the file's text as the default export.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function load(url, context, next) {
  if (!url.endsWith("?raw")) return next(url, context);
  const text = readFileSync(fileURLToPath(url.slice(0, -"?raw".length)), "utf8");
  return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
}
