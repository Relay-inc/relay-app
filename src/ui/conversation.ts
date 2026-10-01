import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { icon } from "../icons";
import { md } from "../lib/md";
import { S, isTerm, termOf, projOf, project } from "../app/state";
import type { Item } from "../app/state";
import { routeTo, openPr } from "../app/actions";
import { noteOf, noteKnown, isNotePath, noteKey } from "../app/notes";
import { toolLine, thumbs } from "./parts";
import parts from "./parts.css?inline";
import css from "./conversation.css?inline";
import "./card";

const lines = (text: string) => text.split("\n").map((l, i) => html`${i ? html`<br>` : nothing}${l}`);

function item(it: Item) {
  switch (it.kind) {
    case "me": return html`${it.imgs?.length ? html`<div class="mimgs">${thumbs(it.imgs)}</div>` : nothing}${it.text ? html`<div class="me">${lines(it.text)}</div>` : nothing}`;
    case "ai": return html`<div class="ai">${md(it.text)}</div>`;
    case "tool": {
      // a Read or Edit on a note that exists opens it in the right panel
      const note = it.path && isNotePath(it.path) && noteKnown(noteOf(it.path)) ? it.path : "";
      return html`<div class=${`tool ${it.state === "run" ? "run" : it.state === "err" ? "err" : ""}${note ? " vlink" : ""}`} @click=${note ? () => openPr(noteKey(note)) : nothing}>${it.tool ? toolLine(it.tool.name, it.tool.input) : it.text}</div>`;
    }
    case "err": return html`<div class="err">${it.text}</div>`;
    case "done": return html`<div class="done">${icon("check")}${it.text}</div>`;
    default: return html`<div class="note">${it.text}</div>`;
  }
}
const pulse = html`<span class="pulse"><i></i><i></i><i></i></span>`;

/** The open conversation: what was said and done, a question about the project, the cards waiting, and the working indicator. */
export class RelayConversation extends RelayElement {
  static styles = styles(parts + css);
  render() {
    const sel = S.sel, items = S.convo[sel] || [], T = isTerm(sel) ? termOf(sel) : undefined, pn = T ? T.project : projOf(sel);
    const waiting = S.pendingList.filter(r => r.project === sel), rc = S.routeChoice;
    return html`${items.length ? items.map(item) : html`<div class="note">${project(pn) ? t("chat.emptyProject", { name: pn ?? "" }) : t("chat.emptyGeneral")}</div>`}
      ${rc && rc.key === sel ? html`<div class="perm"><div class="q">${t("route.question")}</div><div class="opts">${rc.hits.map(h =>
        html`<button class="btn" @click=${() => routeTo(h)}>${h}</button>`)}<button class="btn" @click=${() => routeTo("")}>${t("route.keep")}</button></div></div>` : nothing}
      ${repeat(waiting, r => r.id, r => html`<relay-card .r=${r}></relay-card>`)}
      ${S.status[sel] === "busy" && !waiting.length
        // visible while Claude works: only the pulsing dots, the running step has its own line
        ? html`<div class="working" role="status" aria-label=${t("work.working")}>${pulse}${sel in S.outside ? html`<span class="wt">${t("work.outside")}</span>` : nothing}</div>` : nothing}
      ${T && T.status === "busy" ? html`<div class="working">${pulse}<span class="wt">${t("term.writing")}</span></div>` : nothing}`;
  }
}
customElements.define("relay-conversation", RelayConversation);
