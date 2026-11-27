import { matchBoard } from "../../domain/settings/board-match";
import { vaultProjects } from "../board/board";
import { findProjects } from "../workspace/vault";
import { loadPrs, loadProjectRepos } from "../pull-requests/prs";
import * as backend from "../../infrastructure/backend";
import { loadTodayCards } from "./today";

// Linking a repo to its vault project from Today, where the need shows (a PR without a project). A project's board is
// linked in Settings › Projects only (navigation openProjectSettings).

/** The vault projects to link a repo to, the one its name points at first (acme-plastics-frontend → Acme Plastics). */
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
