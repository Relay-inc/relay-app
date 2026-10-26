import type { GitRepo } from "../git/git";

// The Files drawer (src-tauri/src/explorer.rs): a project's code folders and its folder in the vault as a tree, the
// files git sees changed in their colour, as PhpStorm shows a project.

export type FileRoot = { label: string; path: string; vault: boolean };
export type FileEntry = { name: string; path: string; dir: boolean; ignored: boolean };

/** Per absolute path git's letter for it (M, A, D, ?), from the Git drawer's repos. */
export function gitLetters(repos: GitRepo[]): Record<string, string> {
  return Object.fromEntries(repos.flatMap(r => r.files.map(f => [`${r.repo}/${f.path}`, f.status])));
}

// what is never text: these open in their own app without a try
const OUTSIDE =
  /\.(pdf|docx?|xlsx?|pptx?|key|numbers|pages|png|jpe?g|gif|webp|heic|ico|icns|svgz|mp[34]|mov|m4a|wav|zip|gz|tgz|dmg|pkg|app|sqlite|db)$/i;
/** A file to open in its default app (a document, a picture, an archive), not as text in the window. */
export const opensOutside = (name: string) => OUTSIDE.test(name);

/** A markdown file inside the vault as the note path the right drawer opens, else "". */
export function vaultNote(path: string, vault: string) {
  if (!vault || !path.startsWith(`${vault}/`) || !/\.md$/i.test(path)) return "";
  return path.slice(vault.length + 1);
}
