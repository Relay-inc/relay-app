import { invoke } from "@tauri-apps/api/core";
import { t } from "../core/i18n";
import { changed } from "../core/store";
import { ghOn } from "./config";
import { project } from "./vault";
import { chat, newChat } from "./chats/state";
import { panel } from "./panel";
import { select } from "./navigation";
import { sendMsg } from "./chats/actions";

// Pull requests from GitHub, fetched by the backend through gh: what waits on the user's review and what
// he opened. Read-only: a row opens the PR in the right panel (description, checks, conversation), a link
// there opens it on GitHub. Anything others see (a review, a merge) does not happen from the app without approval (decided 29/9).
export type PR = { number: number; title: string; url: string; repo: string; draft: boolean; created: string; updated: string;
  author: string | null; review: string | null; ci: string | null; project: string | null };
export type PRs = { mine: PR[]; review: PR[] };
export const prKey = (repo: string, number: number | string) => `${repo}#${number}`;

export const prs = { list: null as PRs | null, err: "", busy: false };

// once GitHub is switched on in the settings. Refreshed every 5 minutes and on opening the view
export async function loadPrs() {
  if (!ghOn() || prs.busy) return;
  prs.busy = true; changed();
  try { prs.list = await invoke<PRs>("github_prs"); prs.err = ""; } catch (e) { prs.err = String(e); }
  prs.busy = false; changed();
}
export const resetPrs = () => { prs.list = null; prs.err = ""; };
// "Laat Claude reviewen": a new app conversation under the PR's project. Claude reads and reports here,
// posting on GitHub is something others see, so it waits for the user (decided 29/9)
export async function reviewPr(key: string) {
  const pr = panel.detail[key]; if (!pr) return;
  const repo = key.slice(0, key.lastIndexOf("#")), row = [...(prs.list?.review || []), ...(prs.list?.mine || [])].find(p => p.repo === repo && p.number === pr.number);
  const k = newChat(row?.project && project(row.project) ? row.project : null);
  chat.chats[k].title = `Review ${repo.split("/")[1]} #${pr.number}`;
  chat.convo[k] = [{ kind: "note", text: t("note.reviewStarted", { repo, n: pr.number }) }]; // also keeps the typed title, no generated one
  await select(k);
  sendMsg(`Review PR ${pr.url} (${repo} #${pr.number}: ${pr.title}). Haal de diff en context op met gh, en lees de projectnote als die er is. `
    + "Plaats niets op GitHub: geen review, comment of approve. Geef je bevindingen hier, meest ernstige eerst, met bestand en regel. "
    + "Wil ik iets posten, dan vraag ik het je daarna.");
}
