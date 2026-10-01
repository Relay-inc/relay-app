import { invoke } from "@tauri-apps/api/core";
import { changed, ls } from "../core/store";
import { ui } from "./ui";
import { config } from "./config";
import { ctxOf, provider, type BoardProvider, type BoardRef } from "./providers";
import { mail, mailRef, type MailBody } from "./mail";

// The right panel's detail: a PR ("owner/repo#12"), a mail ("mail:…"), a vault note ("note:…") or a board card
// ("card:<provider>:<id>"). While one is open the panel widens; its tabs (open, status, reminders, PRs) are behind it.
export const panel = {
  open: "", // the key of what is shown, "" for the tabs
  detail: {} as Record<string, any>, // the last answer per key: shown at once, a fresh one follows
  err: "",
  cardRefs: {} as Record<string, BoardRef>,
};

export const cardOf = (key: string) => { const m = /^card:([^:]+):(.+)$/.exec(key), p = m ? provider(m[1]) : undefined; return p?.detail ? { p, d: p.detail, id: m![2] } : undefined; };
// a card opens in the right panel when its provider has one, else in the browser
export async function openCard(p: BoardProvider, ref: BoardRef, id: string) {
  if (p.detail) { panel.cardRefs[`card:${p.id}:${id}`] = ref; return openPr(`card:${p.id}:${id}`); }
  try { invoke("plugin:opener|open_url", { url: await p.url(ctxOf(p, config.value.integrations), ref, id) }); } catch (e) { console.error(e); }
}
export async function openPr(key: string) {
  panel.open = key; panel.err = ""; mail.link = "";
  const card = cardOf(key);
  if (card) panel.detail[key] ??= card.d.cached(card.id);
  ui.noinsp = false; ls.set("noinsp", false); changed();
  const i = key.lastIndexOf("#");
  try { panel.detail[key] = card ? await card.d.fetch(ctxOf(card.p, config.value.integrations), panel.cardRefs[key], card.id) : key.startsWith("mail:") ? await invoke<MailBody>("mail_read", mailRef(key))
    : key.startsWith("note:") ? await invoke("read_note", { target: key.slice(5) })
    : await invoke("github_pr", { repo: key.slice(0, i), number: Number(key.slice(i + 1)) }); }
  catch (e) { if (key.startsWith("mail:")) delete panel.detail[key]; if (!panel.detail[key]) panel.err = String(e); }
  changed();
}
export function closePr() { if (!panel.open) return; panel.open = ""; changed(); }
export function setTab(tab: string) { ui.tab = tab; if (panel.open) closePr(); else changed(); }
