// Commonwealth, the team brain: detected, never configured. On when its Claude Code plugin is installed. The view
// lists the notes staged for review in the brains the vault's projects resolve to; Promote and Reject go through the CLI.
export type BrainNote = {
  brain: string;
  id: string;
  kind: string;
  title: string;
  created: string;
  author: string;
  source: string;
  body: string;
};
export type BrainStatus = {
  plugin: boolean;
  cli: string | null;
  hint: string;
  projects: { project: string; brain: string | null; name: string | null }[];
};
