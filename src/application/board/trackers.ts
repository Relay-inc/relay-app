import type { BoardOpt, Opt } from "../../domain/board/types";
import { matchBoard } from "../../domain/settings/board-match";
import { provider } from "../../shared/plugins";
import { ctxOf } from "./ctx";

// Picking a board for a vault project, level by level, in any tracker: Today's board link and Settings › Projects.
// A tracker that lists all its boards in one call still goes through its projects here, so every tracker works alike.

/** The tracker's projects (Productive: projects, Trello: workspaces, Linear: teams), the one named like the vault
 *  project first. */
export async function trackerProjects(providerId: string, vaultProject: string): Promise<Opt[]> {
  const tracker = provider(providerId);
  if (!tracker) return [];
  const list = await tracker.projects(ctxOf(tracker));
  const best = matchBoard(
    vaultProject,
    list.map(p => ({ ...p, project: p.id, group: "" })),
  );
  return best ? [list.find(p => p.id === best.id)!, ...list.filter(p => p.id !== best.id)] : list;
}
/** The boards of one of its projects, the one named like the vault project first. */
export async function trackerBoards(providerId: string, project: string, vaultProject: string): Promise<BoardOpt[]> {
  const tracker = provider(providerId);
  if (!tracker) return [];
  const list = (await tracker.boards(ctxOf(tracker), project)).map(b => ({ ...b, project, group: "" }));
  const best = matchBoard(vaultProject, list);
  return best ? [best, ...list.filter(b => b.id !== best.id)] : list;
}
