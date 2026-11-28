import {
  fixPrompt,
  groupsOf,
  isAlarm,
  issuesOf,
  issuesPage,
  mergeGroups,
  newAlarms,
  reposOf,
  type AikidoRepo,
  type Group,
  type Issue,
} from "../../domain/aikido/rules";
import { pickedOf } from "../../domain/pipeline/rules";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { t } from "../../shared/i18n";
import { sendMsg } from "../conversations/actions";
import { startChat } from "../conversations/chats";
import { makeStore } from "../make-store";
import { select } from "../navigation/navigation";
import { settings } from "../settings/settings";

// Aikido in the main window: the open issue groups of a vault project's linked code repos (settings.aikido), for the
// Security panel, and a conversation that fixes them. Read-only: every call is a GET the backend allowlists
// (packages/integration-aikido), with an access token the backend keeps to itself.

type ProjectIssues = { groups: Group[] | null; err: string; at: number };
type AikidoState = {
  projects: Record<string, ProjectIssues>; // per vault project
  repos: { list: AikidoRepo[]; at: number } | null; // every code repo the client sees: names and last scans
  issues: Record<number, Issue[]>; // per group, the open issues (at most 10), once its row unfolded or it is fixed
  seen: Record<string, number[]>; // per vault project, the groups the user saw in the panel
};
const SEEN = "aikidoSeen";
export const useAikidoStore = makeStore<AikidoState>(() => ({
  projects: {},
  repos: null,
  issues: {},
  seen: storage.get<Record<string, number[]>>(SEEN, {}),
}));
const set = useAikidoStore.setState;
const get = (path: string) => backend.integrationCall("aikido", "GET", path, null);

/** The Aikido code repos linked to a vault project, while Aikido is switched on. */
export const aikidoOf = (project: string): number[] => {
  const s = settings();
  return s.integrations?.aikido?.on === true ? (s.aikido?.[project] ?? []) : [];
};
const region = () => String(settings().integrations?.aikido?.region ?? "eu");

// ponytail: Aikido allows 20 calls a minute per workspace. Refreshed when the panel shows, at most every 5 minutes, no
// background polling; a refresh is 1 call for the repos plus 1 per linked repo (more only past 100 groups a repo).
const FRESH = 5 * 60_000;
const PAGES = 3;
/** The project's open issue groups, worst first, unless they arrived less than 5 minutes ago. A failure (the rate
 *  limit among them) keeps what was there and says why. */
export async function loadAikido(project: string, force = false) {
  const ids = aikidoOf(project);
  const had = useAikidoStore.getState().projects[project];
  if (!ids.length || (!force && had && Date.now() - had.at < FRESH)) return;
  set(draft => {
    draft.projects[project] = { groups: had?.groups ?? null, err: "", at: Date.now() };
  });
  try {
    const repos = useAikidoStore.getState().repos;
    if (!repos || Date.now() - repos.at >= FRESH) {
      const list = reposOf(await get("/repositories/code?per_page=200"));
      set(draft => {
        draft.repos = { list, at: Date.now() };
      });
    }
    const lists = await Promise.all(ids.map(repoGroups));
    set(draft => {
      draft.projects[project] = { groups: mergeGroups(lists), err: "", at: Date.now() };
    });
  } catch (error) {
    set(draft => {
      draft.projects[project] = { groups: had?.groups ?? null, err: String(error), at: Date.now() };
    });
  }
}
async function repoGroups(repo: number) {
  const out: Group[] = [];
  for (let page = 0; page < PAGES; page++) {
    const answer = await get(
      `/open-issue-groups?filter_code_repo_id=${repo}&filter_status=open&per_page=100&page=${page}`,
    );
    out.push(...groupsOf(answer, repo));
    if (!Array.isArray(answer) || answer.length < 100) break;
  }
  return out;
}

/** The panel is shown: every group it lists counts as seen, so only a new critical or high one turns it red again. */
export function markSeen(project: string) {
  const groups = useAikidoStore.getState().projects[project]?.groups;
  if (!groups) return;
  const ids = groups.map(g => g.id);
  const before = useAikidoStore.getState().seen[project] ?? [];
  if (ids.length === before.length && ids.every(id => before.includes(id))) return;
  set(draft => {
    draft.seen[project] = ids;
  });
  storage.set(SEEN, useAikidoStore.getState().seen);
}
/** "fail" while the project has a critical or high group the user has not seen in the panel, else null. Pass the
 *  state to use it in a selector: `useAikidoStore(s => aikidoAttention(project, s))`. */
export function aikidoAttention(project: string, s: AikidoState = useAikidoStore.getState()): "fail" | null {
  const groups = s.projects[project]?.groups;
  return groups && newAlarms(groups, s.seen[project] ?? []).length ? "fail" : null;
}

/** A group's open issues (file and lines, package, CVE), at most 10, fetched once. */
export async function loadIssues(group: number): Promise<Issue[]> {
  const had = useAikidoStore.getState().issues[group];
  if (had) return had;
  const list = issuesOf(
    await get(`/issues/export?format=json&filter_status=open&filter_issue_group_id=${group}&per_page=10&page=0`),
  );
  set(draft => {
    draft.issues[group] = list;
  });
  return list;
}
/** The name of a linked repo, as Aikido calls it. */
export const repoName = (id: number, list = useAikidoStore.getState().repos?.list) =>
  list?.find(r => r.id === id)?.name ?? String(id);

/** The checkouts on this Mac of the repos by Aikido's name ("" when there is none), as the board pipeline finds them. */
async function checkouts(project: string, names: string[]) {
  const found = await backend.pipelineRepos(project, pickedOf(settings().pipelines?.[project])).catch(() => []);
  const path = (name: string) =>
    found.find(r => r.slug.split("/").pop()!.toLowerCase() === name.toLowerCase())?.path ?? "";
  return Object.fromEntries(names.map(name => [name, path(name)]));
}
const home = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");
async function start(
  project: string,
  title: string,
  note: (checkout: string) => string,
  prompt: (c: Record<string, string>) => string,
  names: string[],
) {
  const found = await checkouts(project, names);
  const where = Object.values(found).filter(Boolean).map(home).join(", ") || t("ak.noCheckout");
  const key = startChat(project, { title, note: note(where) });
  await select(key);
  sendMsg(prompt(found));
}

/** "Fix met Claude": a conversation under the project that fixes exactly this group on `fix/aikido-<id>`. */
export async function fixWithClaude(project: string, groupId: number) {
  const group = useAikidoStore.getState().projects[project]?.groups?.find(g => g.id === groupId);
  if (!group) return;
  const issues = await loadIssues(groupId).catch(() => []);
  const names = [...new Set([...issues.map(i => i.repo), ...group.repos.map(id => repoName(id))].filter(Boolean))];
  await start(
    project,
    `Aikido: ${group.title}`,
    checkout => t("ak.startedOne", { repo: names.join(", "), id: group.id, checkout }),
    found => fixPrompt([group], issues, found, `fix/aikido-${group.id}`),
    names,
  );
}
/** "Fix alle kritieke en hoge": one conversation for every critical and high group of one linked repo. */
export async function fixAllWithClaude(project: string, repoId: number) {
  const groups = (useAikidoStore.getState().projects[project]?.groups ?? []).filter(
    g => isAlarm(g) && g.repos.includes(repoId),
  );
  if (!groups.length) return;
  const name = repoName(repoId);
  const issues = issuesOf(
    await get(
      `/issues/export?format=json&filter_status=open&filter_code_repo_id=${repoId}&filter_severities=critical,high&per_page=100&page=0`,
    ).catch(() => []),
  );
  await start(
    project,
    t("ak.titleAll", { repo: name }),
    checkout => t("ak.startedAll", { repo: name, n: groups.length, checkout }),
    found => fixPrompt(groups, issues, found, `fix/aikido-repo-${repoId}`),
    [name],
  );
}
/** The region's issues page in Aikido: its API has no link to one issue, and no other host opens. */
export const openInAikido = () => backend.openUrl(issuesPage(region()));
