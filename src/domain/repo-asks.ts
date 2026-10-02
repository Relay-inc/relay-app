import { invoke } from "@tauri-apps/api/core";
import { changed } from "../core/store";
import { loadPrs, projectRepos } from "./prs";
import { projectOf } from "./chats/state";

// A conversation that committed to a repo no project has (the backend's `repo-unlinked`) asks to link it to its
// project. The asks wait per conversation until answered; an ask is only shown in a conversation that has a project.
export const repoAsks = { map: {} as Record<string, string[]> };

export function askRepo(key: string, repo: string) {
  if (Object.values(projectRepos.map).some(repos => repos.includes(repo))) return;
  const list = (repoAsks.map[key] ??= []);
  if (!list.includes(repo)) list.push(repo);
  changed();
}

/** The repo to ask about in this conversation, with the project it would join. */
export function repoAskFor(key: string) {
  const project = projectOf(key);
  const repo = repoAsks.map[key]?.[0];
  return project && repo ? { project, repo } : null;
}

/** Link: the repo joins the project's. Not now: it is unlinked on purpose, no conversation asks again. */
export async function answerRepo(key: string, link: boolean) {
  const ask = repoAskFor(key);
  if (!ask) return;
  for (const k of Object.keys(repoAsks.map)) repoAsks.map[k] = repoAsks.map[k].filter(r => r !== ask.repo);
  changed();
  if (!link) return void invoke("ignore_repo", { repo: ask.repo });
  await invoke("set_project_repos", {
    project: ask.project,
    repos: [...(projectRepos.map[ask.project] ?? []), ask.repo],
  });
  loadPrs();
}
