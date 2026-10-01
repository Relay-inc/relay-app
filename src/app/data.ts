import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { changed } from "../lib/store";
import { PROVIDERS, ready as providerReady } from "../providers";
import { agentsStatus } from "../agents";
import type { PRs } from "../github";
import type { Mail } from "../mail";
import { loadIcons, setIcon, iconFrom, isSite } from "../project-icons";
import { reloadUsage } from "../usage";
import { S, WAIT, USAGE, terms, ghOn, mailOn, type Settings, type Sub } from "./state";
import { notify, syncBusy } from "./events";

// Everything the main window loads from the backend, and the polls that keep it current.

// ---------- the vault: an error shows once, in a bar at the top, and goes when a later snapshot works again
export async function loadSnapshot() {
  try { S.snap = await invoke("snapshot"); S.snapErr = ""; }
  catch (e) { const err = String(e); if (err !== S.snapErr) console.error(err); S.snapErr = err; }
  changed();
}
export async function checkBoards() {
  S.boardsReady = (await Promise.all(PROVIDERS.map(async p => await providerReady(p) ? p.id : ""))).filter(Boolean);
}

export async function saveSettings(next: Settings) {
  try { S.settings = await invoke<Settings>("set_settings", { settings: next }); S.settingsMsg = ""; return true; }
  catch (e) { S.settingsMsg = String(e); return false; }
}

// ---------- pull requests via gh in the backend, once GitHub is switched on. Refreshed every 5 minutes and on opening the view
export async function loadPrs() {
  if (!ghOn() || S.prBusy) return;
  S.prBusy = true; changed();
  try { S.prs = await invoke<PRs>("github_prs"); S.prErr = ""; } catch (e) { S.prErr = String(e); }
  S.prBusy = false; changed();
}

// ---------- the inbox over IMAP in the backend, once Mail is switched on. Refreshed every 5 minutes and on opening the view
export async function loadMails() {
  if (!mailOn() || S.mailBusy || !S.settings.mail.accounts?.length) return;
  S.mailBusy = true; changed();
  const g = S.mailGen;
  try {
    // the newest page replaces what it covers, older pages loaded with "more" stay below it
    const fresh = await invoke<Mail[]>("mail_list", { page: 1 }), edge = Math.min(...fresh.map(m => Date.parse(m.date)));
    if (g !== S.mailGen) { S.mailBusy = false; loadMails(); return; }
    // an empty page means an empty inbox: edge would be Infinity and keep every stale row
    S.mails = fresh.length ? [...fresh, ...(S.mails || []).filter(m => Date.parse(m.date) < edge && !fresh.some(f => f.id === m.id))] : [];
    if (!S.mailPages) { S.mailPages = 1; S.mailEnd = fresh.length < 50; }
    S.mailErr = "";
  } catch (e) { if (g === S.mailGen) S.mailErr = String(e); }
  S.mailBusy = false;
  if (g !== S.mailGen) { loadMails(); return; }
  changed();
}
// the next 50, appended under the list. ponytail: a mail archived meanwhile shifts the pages, so one at the border can be skipped until a reload
export async function moreMails() {
  if (S.mailMore || S.mailEnd || !S.mails) return;
  S.mailMore = true; changed();
  const g = S.mailGen;
  try {
    const next = await invoke<Mail[]>("mail_list", { page: S.mailPages + 1 });
    if (g !== S.mailGen || !S.mails) { S.mailMore = false; changed(); return; }
    S.mails = [...S.mails, ...next.filter(n => !S.mails!.some(m => m.id === n.id))];
    S.mailPages++; S.mailEnd = next.length < 50; S.mailErr = "";
  } catch (e) { if (g === S.mailGen) S.mailErr = String(e); }
  S.mailMore = false; changed();
}
/** The mail state from before a settings change is dropped: answers still on their way are ignored. */
export function resetMail() {
  S.mailGen++;
  for (const k of Object.keys(S.prDetail)) if (k.startsWith("mail:")) delete S.prDetail[k];
  S.mailText.clear(); S.mailLink = "";
  S.mails = null; S.mailErr = ""; S.mailPages = 0; S.mailEnd = false;
}

// ---------- the agent providers: switched on, detected, their capabilities and picks. Not awaited: detection runs each CLI once
export const loadAgents = () => agentsStatus().then(a => { S.agentsSt = a; S.agentsLoaded = true; changed(); }).catch(e => console.error(e));
export const usageAgents = () => S.agentsLoaded ? S.agentsSt.providers.filter(p => p.on).map(p => ({ id: p.id, limits: p.caps.limits })) : [{ id: "claude", limits: true }];
export const reloadAgentsUsage = () => loadAgents().then(() => reloadUsage(changed, S.sel === USAGE));

// ---------- polling: pending questions often, sessions and the vault now and then
export async function pollPending() {
  const next: any[] = await invoke("pending");
  if (JSON.stringify(next.map(x => x.id)) === JSON.stringify(S.pendingList.map(x => x.id))) return;
  const known = new Set(S.pendingList.map(x => x.id));
  if (S.pendingPolled) for (const r of next) if (!known.has(r.id)) notify(S.chats[r.project] ? r.project : WAIT, r.input?.questions?.[0]?.question || t("notify.waits", { tool: r.tool_name }));
  S.pendingList = next; S.pendingPolled = true; changed();
}
export async function pollSubs() {
  const keys = [...Object.values(S.chats).filter(c => !c.draft && !c.closed).map(c => c.key), ...terms().map(tm => tm.key)];
  const next = await invoke<Record<string, Sub[]>>("subagents", { keys }).catch(() => S.subs);
  if (JSON.stringify(next) === JSON.stringify(S.subs)) return;
  S.subs = next; changed();
}
let agentsAt = 0;
export async function pollAgents() {
  agentsAt = Date.now();
  [S.agentsList, S.appSids, S.sidOf] = await Promise.all([invoke<any[]>("agents"), invoke<string[]>("app_sids"), invoke<typeof S.sidOf>("app_sessions").catch(() => S.sidOf)]);
  await syncBusy();
  changed();
}
export const agentsStale = () => Date.now() - agentsAt > 4000;

// ---------- favicons: projects without an icon entry in the vault get one. favicon.py guesses the site from the
// notes (a website set as the icon wins) and fetches its icon; the icon goes into the vault as a file, a project
// without a site gets "" (none, not guessed again). `tried` (this Mac) keeps a site that had no favicon from being
// fetched again and again.
let favBusy = false, favAgain = false;
export async function checkFavicons() {
  const f = S.settings.favicons;
  // a change while a run is busy (Find icons during the first run) is not lost: one more run right after
  if (favBusy) { favAgain = true; return; }
  if (!f?.on || !S.snap?.projects) return;
  const todo = S.snap.projects.filter((p: any) => !(p.name in S.icons) || (isSite(S.icons[p.name].value) && f.tried?.[p.name] !== S.icons[p.name].value));
  if (!todo.length) return;
  favBusy = true;
  try {
    const found: Record<string, { site: string; data: string | null }> = await invoke("favicons", { projects: todo.map((p: any) => ({ name: p.name, aliases: p.aliases || [] })) });
    const tried = { ...f.tried };
    for (const [n, r] of Object.entries(found)) {
      tried[n] = r.site;
      const img = r.data ? await iconFrom(await (await fetch(r.data)).blob()) : null;
      if (img) await setIcon(n, "img", img);
      else if (!(n in S.icons)) await setIcon(n, "none");
    }
    await saveSettings({ ...S.settings, favicons: { ...f, tried } });
  } catch (e) { console.error(e); }
  favBusy = false;
  if (favAgain) { favAgain = false; checkFavicons(); }
}
export async function refreshIcons() {
  S.icons = await loadIcons();
  // the first load moves icons out of settings.json into the vault: take the settings as they are now
  try { S.settings = { ...S.settings, ...(await invoke<Settings>("get_settings")) }; } catch { /* keep */ }
  changed();
  checkFavicons();
}
export async function reloadIcons() { S.icons = await loadIcons(); changed(); checkFavicons(); }

