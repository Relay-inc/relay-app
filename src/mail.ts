// The inbox, fetched by the backend through himalaya: the newest mails. A row opens the mail in the right panel,
// and from there a button starts a conversation about it. Opening leaves a mail unread, read/unread only changes
// on the user's click. Nothing here sends or moves a mail: a reply only becomes a draft, from a conversation (decided 29/9).
import { t, currentLocale } from "./i18n";

export type Mail = { id: string; subject: string; date: string; flags: { iana?: string }[];
  from: { name: string | null; email: string }[]; to: { name: string | null; email: string }[]; "has-attachment": boolean | null };
export type MailFilter = { q: string; state: "all" | "unread" | "read"; project: string };
type H = { esc: (s: unknown) => string; projectOf: (m: Mail) => string | null; projectLabel: (p: string | null) => string; open: string };
export const mailKey = (id: string) => `mail:${id}`;
export const unread = (m: Mail) => !m.flags.some(f => f.iana === "seen");
export const sender = (m: Mail) => m.from[0]?.name || m.from[0]?.email || "";
/** Flip the seen flag in the local copy, so the list follows before himalaya answers. */
export const setSeen = (m: Mail, seen: boolean) => { m.flags = seen ? [...m.flags.filter(f => f.iana !== "seen"), { iana: "seen" }] : m.flags.filter(f => f.iana !== "seen"); };

// today a time, this year a day and month, before that with the year
function when(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(currentLocale(), { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
const seenBtn = (m: Mail, cls = "btn") => `<button class="${cls}" data-mail-seen="${unread(m) ? 1 : 0}" data-id="${m.id}" title="${unread(m) ? t("mail.markRead") : t("mail.markUnread")}">${unread(m) ? t("mail.markRead") : t("mail.markUnread")}</button>`;

function row(m: Mail, h: H) {
  const e = h.esc, p = h.projectOf(m);
  return `<div class="pr-row mail-row${unread(m) ? " unread" : ""}${h.open === mailKey(m.id) ? " sel" : ""}" data-mail-open="${e(m.id)}">
    <div class="pr-main"><div class="pr-t">${e(m.subject || t("mail.noSubject"))}</div>
      <div class="pr-meta"><span>${e(sender(m))}</span>${p ? `<span>${e(h.projectLabel(p))}</span>` : ""}</div></div>
    <div class="mail-side"><span class="pr-meta">${when(m.date)}</span>${seenBtn(m, "btn mail-flip")}</div></div>`;
}

/** Search, read state and project, mounted once so typing in the search field keeps its focus. */
export const renderMailBar = (f: MailFilter, esc: (s: unknown) => string) =>
  `<div class="kbhead mail-bar"><input class="field" id="mailq" type="search" placeholder="${t("mail.search")}" value="${esc(f.q)}" spellcheck="false"><span id="mailtools"></span></div>`;

/** What next to the search field changes with the list: the state buttons, the projects in the list, reload. */
export function renderMailTools(list: Mail[] | null, f: MailFilter, busy: boolean, h: H): string {
  const ps = [...new Set((list || []).map(h.projectOf).filter((p): p is string => !!p))].sort();
  const seg = (["all", "unread", "read"] as const).map(s => `<button class="${f.state === s ? "on" : ""}" data-mail-state="${s}">${t(s === "all" ? "mail.fAll" : s === "unread" ? "mail.fUnread" : "mail.fRead")}</button>`).join("");
  return `<span class="seg mail-seg">${seg}</span>
    <select class="field" id="mailproj"><option value="">${t("mail.allProjects")}</option><option value="-" ${f.project === "-" ? "selected" : ""}>${t("mail.noProject")}</option>${[...new Set([...ps, ...(f.project && f.project !== "-" ? [f.project] : [])])].map(p =>
      `<option value="${h.esc(p)}" ${f.project === p ? "selected" : ""}>${h.esc(h.projectLabel(p))}</option>`).join("")}</select>
    <span class="sp"></span>${busy ? '<span class="spin"></span>' : ""}<button class="btn" data-mail="reload">${t("pr.reload")}</button>`;
}

/** The mails that pass the filters, under one heading with the unread count. */
export function renderMailList(list: Mail[] | null, f: MailFilter, err: string, busy: boolean, h: H): string {
  if (!list) return (err ? `<div class="err">${h.esc(err)}</div>` : "") + (busy ? "" : `<div class="note">${t("pr.notLoaded")}</div>`);
  const q = f.q.trim().toLowerCase();
  const shown = list.filter(m => (f.state === "all" || unread(m) === (f.state === "unread"))
    && (!f.project || (f.project === "-" ? !h.projectOf(m) : h.projectOf(m) === f.project))
    && (!q || `${m.subject} ${sender(m)} ${m.from[0]?.email ?? ""}`.toLowerCase().includes(q)));
  const n = list.filter(unread).length;
  return (err ? `<div class="err">${h.esc(err)}</div>` : "")
    + `<section class="rem-grp"><h2 class="rem-h">${t("mail.inbox")}${n ? ` <span class="rem-n">${t("mail.unread", { n })}</span>` : ""}</h2>`
    + (shown.length ? shown.map(m => row(m, h)).join("") : `<div class="pr-none">${list.length ? t("mail.noMatch") : t("mail.none")}</div>`) + `</section>`;
}

// ---------- the text of a plain-text mail: what is new on top, the earlier mails of the thread folded away below it
const QUOTED = /^ ?>/;
// the line Gmail, Outlook and Apple Mail put above a quote ("On … wrote:", "Op … schreef:", "Le … a écrit :", "Am … schrieb:")
const ATTRIB = /(wrote|schreef|a écrit|schrieb)\s*:\s*$/i;
// Outlook without ">": a header block that starts the earlier mail
const OUTLOOK = /^(-{2,}\s*(Original Message|Oorspronkelijk bericht|Forwarded message|Doorgestuurd bericht)|(From|Van|De|Von)\s*:\s*\S)/i;
const tidy = (l: string[]) => l.join("\n").replace(/\n{3,}/g, "\n\n").trim();
function prose(text: string, esc: (s: unknown) => string) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<>"']+?)(?=&gt;|[\s),.]*(?:\s|$))/g, '<a href="$1">$1</a>')
    .replace(/\[image: ([^\]]*)\]/g, '<span class="mail-dim">[$1]</span>');
}
/** A mail text as html: the new part, then the quoted mail as a fold whose label is its "On … wrote:" line, recursively per level. */
export function renderBody(body: string, esc: (s: unknown) => string, depth = 0): string {
  const lines = body.replace(/\r/g, "").split("\n");
  let q = lines.findIndex(l => QUOTED.test(l));
  // Outlook: the earlier mail starts at its From/Van header, it is not quoted line by line
  const o = lines.findIndex((l, i) => OUTLOOK.test(l) && lines.slice(i + 1, i + 5).some(n => /^(Sent|Verzonden|Date|Datum|Envoyé|Gesendet)\s*:/i.test(n)));
  if (q < 0 && o < 0) return `<div class="mail-body">${prose(tidy(lines), esc)}</div>`;
  if (q < 0 || (o >= 0 && o < q)) {
    return `<div class="mail-body">${prose(tidy(lines.slice(0, o)), esc)}</div>`
      + `<details class="mail-quote"><summary>${t("mail.earlier")}</summary><blockquote><div class="mail-body">${prose(tidy(lines.slice(o)), esc)}</div></blockquote></details>`;
  }
  // the attribution: the few non-empty lines above the first quote (a blank line may sit between), when they end in "wrote:"
  let b = q; while (b > 0 && !lines[b - 1].trim()) b--;
  let a = b; for (let i = b - 1; i >= Math.max(0, b - 4) && lines[i].trim(); i--) a = i;
  const label = lines.slice(a, b).join(" ").replace(/\s+/g, " ").trim(), hasLabel = ATTRIB.test(label);
  const end = lines.length - [...lines].reverse().findIndex(l => QUOTED.test(l)); // just past the last quoted line
  const inner = lines.slice(q, end).map(l => l.replace(QUOTED, "").replace(/^ /, ""));
  const head = tidy(lines.slice(0, hasLabel ? a : q)), after = tidy(lines.slice(end));
  // ponytail: nesting stops at 6 levels, deeper threads show flat inside the last fold
  const quoted = depth < 6 ? renderBody(inner.join("\n"), esc, depth + 1) : `<div class="mail-body">${prose(tidy(inner), esc)}</div>`;
  return (head ? `<div class="mail-body">${prose(head, esc)}</div>` : "")
    + `<details class="mail-quote"${head ? "" : " open"}><summary>${hasLabel ? esc(label) : t("mail.earlier")}</summary><blockquote>${quoted}</blockquote></details>`
    + (after ? `<div class="mail-body">${prose(after, esc)}</div>` : "");
}

/** One mail in the right panel: who, when, the text, and the ways into a conversation. Headers show at once, the text loads. */
export function renderMailDetail(m: Mail | undefined, body: string | undefined, err: string, esc: (s: unknown) => string): string {
  const bar = `<div class="prd-bar"><button class="btn" data-pr-close title="${t("pr.close")}">×</button>${m ? seenBtn(m) : ""}<span class="sp"></span>`
    + (m ? `<button class="btn" data-mail-chat="draft" title="${t("mail.draftTitle")}">${t("mail.draft")}</button><button class="btn primary" data-mail-chat="talk" title="${t("mail.talkTitle")}">${t("mail.talk")}</button>` : "") + `</div>`;
  if (!m) return bar + `<div class="meta">${t("mail.gone")}</div>`;
  const who = (l: Mail["from"]) => l.map(a => a.name ? `${esc(a.name)} <span class="count">${esc(a.email)}</span>` : esc(a.email)).join(", ");
  const loading = `<div class="mail-load"><span class="spin"></span>${t("mail.loadingBody")}</div><div class="skel">${[92, 100, 84, 96, 60, 0, 88, 72].map(w => `<i style="width:${w}%"></i>`).join("")}</div>`;
  return bar + `<div class="prd">
    <h2 class="prd-t">${esc(m.subject || t("mail.noSubject"))}</h2>
    <div class="mail-hd"><div>${who(m.from)}</div><div class="count">${t("mail.to")} ${who(m.to)}</div><div class="count">${esc(new Date(m.date).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" }))}</div></div>`
    + (err ? `<div class="err">${esc(err)}</div>` : body === undefined ? loading : renderBody(body, esc))
    + `</div>`;
}
