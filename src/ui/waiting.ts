import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t, currentLocale } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { S, projOf, label, blockedAgents, waitCount } from "../app/state";
import { bg } from "../app/actions";
import parts from "./parts.css?inline";
import css from "./waiting.css?inline";
import "./card";

/** The Waiting view: what agents ask, grouped per conversation, and background sessions that are blocked. */
export class RelayWaiting extends RelayElement {
  static styles = styles(parts + css);
  // a failed hide, stop or attach shows its error on the button
  private errs = new Map<string, string>();

  private async act(act: "hide" | "stop" | "attach", id: string) {
    try { await bg(act, id); }
    catch (e) { this.errs.set(`${act}:${id}`, String(e).slice(0, 60)); this.requestUpdate(); }
  }
  private btn(act: "hide" | "stop" | "attach", id: string, text: string, primary = false) {
    return html`<button class=${primary ? "btn primary" : "btn"} @click=${() => this.act(act, id)}>${this.errs.get(`${act}:${id}`) ?? text}</button>`;
  }

  render() {
    if (!waitCount()) return html`<div class="note">${t("wait.none")}</div>`;
    const byK: Record<string, any[]> = {};
    for (const r of S.pendingList) (byK[r.project] ||= []).push(r);
    const head = (k: string) => `${projOf(k) ? `${projOf(k)} · ` : ""}${label(k)}`;
    return html`<div class="waitlist">${Object.entries(byK).map(([k, rs]) => html`<div class="proj">${head(k)}</div>${repeat(rs, r => r.id, r => html`<relay-card .r=${r}></relay-card>`)}`)}
      ${blockedAgents().map(a => html`<div class="proj">${a.name}</div><div class="perm"><div class="q">${t("wait.bg", { date: new Date(a.startedAt).toLocaleDateString(currentLocale()) })}</div>
        <div class="acts">${this.btn("hide", a.id, t("wait.hide"))}${this.btn("stop", a.id, t("wait.stop"))}${this.btn("attach", a.id, t("bar.openTerminal"), true)}</div></div>`)}</div>`;
  }
}
customElements.define("relay-waiting", RelayWaiting);
