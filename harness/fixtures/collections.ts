// Fixture linked, seen as collections (K8, K9, issue 373): the notes of the linked fixture and the projects as the
// markdown files they would be, so the mock's notes_collection can read their frontmatter the way src-tauri/src/related.rs
// does (that has its own tests), and a cell edit or a dropped card reads and writes real text. Fictional data only.
import { linkedEntries, projectsList, FLAT_NOTE } from "./vault";

const link = (name: string) => `"[[${name}]]"`;
const list = (key: string, names: string[]) =>
  names.length > 1
    ? `${key}:\n${names.map(n => `  - ${link(n)}`).join("\n")}`
    : names.length
      ? `${key}: ${link(names[0])}`
      : "";
const body = (stage: string, title: string) =>
  stage === "wrapped"
    ? `# ${title}\n\n## Summary\nAgreed the next steps.\n`
    : stage === "briefed"
      ? `# ${title}\n\n## Briefing\n**Next action:** bring the numbers.\n`
      : `# ${title}\n`;

/** The fixture's notes as text, by path. */
export const texts: Record<string, string> = {};
for (const n of linkedEntries) {
  const title = n.p.split("/").pop()!.replace(/\.md$/, "");
  const meeting = n.k === "Meeting";
  const front = [
    `type: ${n.k}`,
    list("about", n.about ?? []),
    list("context", meeting ? ["Agency", ...(n.context ?? [])] : (n.context ?? [])),
    list("with", n.with ?? []),
    n.role ? `role: ${n.role}` : "",
    meeting && n.date ? `date: ${n.date}` : "",
    meeting && n.date === "2026-09-24" ? "language: nl" : "",
    meeting && (n.date === "2026-09-24" || n.date === "2026-09-17") ? "followed-up: true" : "",
  ].filter(Boolean);
  texts[n.p] = `---\n${front.join("\n")}\n---\n${body(n.stage ?? "", title)}`;
}
const folder = (p: { name: string; context: string }) => `Contexts/${p.context}/Projects/${p.name}`;
for (const p of projectsList) {
  const note = p.name === "Delmas Bakery" ? FLAT_NOTE : `${folder(p)}/${p.name}.md`;
  texts[note] =
    `---\ntype: Project\ncontext: ${link(p.context)}\nstatus: ${p.state}\n# kept as written\npriority: 2\n---\n# ${p.name}\n\n${p.summary}\n`;
}
