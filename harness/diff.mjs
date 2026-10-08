// Pixel diff of two screenshot sets: node harness/diff.mjs <labelA> <labelB>
// Diff PNGs to harness/screens/diff-<a>-<b>/, a markdown table to stdout and to that folder's report.md.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { HERE } from "./lib.mjs";

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node harness/diff.mjs <labelA> <labelB>");
  process.exit(2);
}
const dirA = `${HERE}screens/${a}`,
  dirB = `${HERE}screens/${b}`,
  out = `${HERE}screens/diff-${a}-${b}`;
mkdirSync(out, { recursive: true });

const views = [...new Set([...readdirSync(dirA), ...readdirSync(dirB)])].filter(f => f.endsWith(".png")).sort();
const rows = [];
for (const file of views) {
  const view = file.replace(/\.png$/, "");
  if (!existsSync(`${dirA}/${file}`) || !existsSync(`${dirB}/${file}`)) {
    rows.push([view, existsSync(`${dirA}/${file}`) ? `missing in ${b}` : `missing in ${a}`]);
    continue;
  }
  const imgA = PNG.sync.read(readFileSync(`${dirA}/${file}`));
  const imgB = PNG.sync.read(readFileSync(`${dirB}/${file}`));
  // different sizes: compare the shared top-left area, count the rest as differing
  const width = Math.min(imgA.width, imgB.width),
    height = Math.min(imgA.height, imgB.height);
  const crop = img => {
    if (img.width === width && img.height === height) return img.data;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      img.data.copy(data, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4);
    return data;
  };
  const diff = new PNG({ width, height });
  const changed = pixelmatch(crop(imgA), crop(imgB), diff.data, width, height, { threshold: 0.1 });
  const total = Math.max(imgA.width * imgA.height, imgB.width * imgB.height);
  const percent = ((changed + (total - width * height)) / total) * 100;
  writeFileSync(`${out}/${file}`, PNG.sync.write(diff));
  rows.push([
    view,
    `${percent.toFixed(2)} %`,
    imgA.width !== imgB.width || imgA.height !== imgB.height ? "size differs" : "",
  ]);
}
const table = [
  `| View | Pixels differing | Note |`,
  `|---|---:|---|`,
  ...rows.map(([v, p, n = ""]) => `| ${v} | ${p} | ${n} |`),
].join("\n");
writeFileSync(`${out}/report.md`, `# ${a} vs ${b}\n\n${table}\n`);
console.log(table);
