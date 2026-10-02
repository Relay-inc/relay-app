import type { BoardOpt } from "../board/types";

// a name as it compares: lower case, no accents, only letters and digits
const plain = (name: string) =>
  name
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** The board whose name matches the vault project's, for a suggestion: the same name, else one name holding the other
 *  (both at least 4 characters, so "UI" does not match "Build"). One board, the closest, or undefined. */
export function matchBoard(vaultProject: string, boards: BoardOpt[]): BoardOpt | undefined {
  const project = plain(vaultProject);
  if (!project) return undefined;
  const same = boards.find(board => plain(board.name) === project);
  if (same) return same;
  const near = boards
    .filter(board => {
      const name = plain(board.name);
      return name.length >= 4 && project.length >= 4 && (name.includes(project) || project.includes(name));
    })
    .sort((a, b) => Math.abs(plain(a.name).length - project.length) - Math.abs(plain(b.name).length - project.length));
  return near[0];
}
