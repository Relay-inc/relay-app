// Fixture linked-views (issue 421): the linked collections' notes, with the Northwind Portal page holding views inside
// it as Obsidian bases: a fenced `base` block of its meetings (`this` is the page), an embedded `.base` file of the
// active projects, and a block Relay can't draw (a formula), which shows "Open in Obsidian". Fictional data only.
import { texts as collTexts } from "./collections";
import { VAULT } from "./vault";

export const PROJECT_NOTE = "Contexts/Agency/Projects/Northwind Portal/Northwind Portal.md";
export const BASE_FILE = "Active projects.base";
const BASE_PATH = `Contexts/Agency/${BASE_FILE}`;
const fence = "```";
const meetings = `${fence}base
filters:
  and:
    - type == "Meeting"
    - about.contains(this)
views:
  - type: table
    name: Meetings
    order:
      - file.name
      - date
      - with
    sort:
      - property: date
        direction: DESC
${fence}`;
const formula = `${fence}base
formulas:
  days: (today() - date).days
views:
  - type: table
    name: Age
${fence}`;
export const baseText = `filters: type == "Project"
properties:
  context:
    displayName: Client
views:
  - type: table
    name: Projects
    order:
      - file.name
      - context
      - status
    limit: 6
    groupBy:
      property: status
      direction: ASC
`;
const head = collTexts[PROJECT_NOTE].split("\n---\n")[0];
export const texts: Record<string, string> = {
  ...collTexts,
  [PROJECT_NOTE]: `${head}\n---\n# Northwind Portal\n\nEvery meeting about this project, newest first:\n\n${meetings}\n\nThe projects, by status:\n\n![[${BASE_FILE}]]\n\nHow old each meeting is:\n\n${formula}\n\nNext: confirm the migration window with the client.\n`,
};
/** embed_info for the `.base` file (attach.rs reads it whole, like a note). */
export const baseInfo = (target: string) =>
  target === BASE_FILE
    ? { target, path: `${VAULT}/${BASE_PATH}`, rel: BASE_PATH, kind: "base", size: baseText.length, text: baseText }
    : null;
