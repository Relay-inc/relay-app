import type { BoardOpt, Opt } from "../../domain/board/types";
import { link } from "../../domain/board/rules";
import { matchBoard } from "../../domain/settings/board-match";
import { provider } from "../../shared/plugins";
import { ctxOf } from "../board/ctx";
import { readyBoards, vaultProjects } from "../board/board";
import { findProjects } from "../workspace/vault";
import { loadPrs, loadProjectRepos } from "../pull-requests/prs";
import * as backend from "../../infrastructure/backend";
import { saveMainSettings, settings } from "../settings/settings";
import { loadTodayCards } from "./today";

// Linking a vault project to its board from Today, where the need shows (a PR without a ticket because its project
// has no board). Every tracker works: one that lists all its boards in one call (Trello, Linear) as one list, Productive
// project by project. A board whose name is the project's comes first.

/** The trackers that are set up, to link a board of. */
export const linkableTrackers = () => readyBoards().map(tracker => ({ id: tracker.id, name: tracker.name }));

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

/** Link the vault project to the board (it takes the board from any other project), then read the boards again, so
 *  the PRs find their tickets. Throws what saving said. */
export async function linkVaultBoard(vaultProject: string, providerId: string, project: string, board: string) {
  const next = link(settings().boards || {}, vaultProject, { provider: providerId, project, board });
  const failed = await saveMainSettings({ ...settings(), boards: next });
  if (failed) throw new Error(failed);
  await loadTodayCards();
}

/** The vault projects to link a repo to, the one its name points at first (be-plastics-frontend → BE Plastics). */
export function repoProjects(repo: string): [string, string][] {
  const all = vaultProjects();
  const name = repo.split("/").pop() ?? repo;
  const hits = findProjects(name.replace(/[-_](frontend|backend|app|api|web|site|portal)$/i, "").replace(/[-_]/g, " "));
  const best =
    hits.length === 1 ? hits[0] : all.find(([n]) => matchBoard(n, [{ id: name, name, project: "", group: "" }]))?.[0];
  return best ? [all.find(([n]) => n === best)!, ...all.filter(([n]) => n !== best)] : all;
}
/** The repo joins the project's repos, then the PRs are read again (they carry their project) and matched. */
export async function linkRepo(repo: string, project: string) {
  const current = (await backend.projectRepos())[project] ?? [];
  await backend.setProjectRepos(project, [...new Set([...current, repo])]);
  await loadProjectRepos();
  await loadPrs();
  await loadTodayCards();
}
