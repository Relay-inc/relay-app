import { html, nothing } from "lit";
import { invoke } from "@tauri-apps/api/core";
import { t, tn } from "../i18n";
import { RelayElement, styles, changed } from "../lib/store";
import { md } from "../lib/md";
import { S, dur, type Sub } from "../app/state";
import { toolLine } from "./parts";
import css from "./subs.css?inline";

const row = (a: Sub) => html`<div class=${a.running ? "sa on" : "sa"} title=${t("subs.show")} @click=${() => toggleLog(a.id)}><span class="sdot"></span><span class="sd">${a.description}</span>
  <span class="sm">${[a.agentType, a.model].filter(Boolean).join(" · ")}</span><span class="sl">${a.running ? (a.tool ? toolLine(a.tool, a.input) : a.text || "") : ""}</span>
  ${a.running ? html`<span class="ws">${dur((Date.now() - Date.parse(a.started_at)) / 1000)}</span>` : html`<span class="sm">${dur((Date.parse(a.last_at) - Date.parse(a.started_at)) / 1000)}</span>`}</div>
  ${S.subLog[a.id] ? html`<div class="slog">${S.subLog[a.id].length ? S.subLog[a.id].map(m => html`<div class="ai">${md(m)}</div>`) : html`<div class="sm">${t("subs.nothing")}</div>`}</div>` : nothing}`;

// a click on an agent unfolds its last messages
async function toggleLog(id: string) {
  if (S.subLog[id]) delete S.subLog[id]; else S.subLog[id] = await invoke<string[]>("agent_log", { key: S.sel, id });
  changed();
}

/** The agents of the open conversation above the composer: the running ones, and the finished ones folded away. */
export class RelaySubs extends RelayElement {
  static styles = styles(css);
  private tick = 0;
  // the running time of a working agent counts up every second
  connectedCallback() { super.connectedCallback(); this.tick = window.setInterval(() => this.requestUpdate(), 1000); }
  disconnectedCallback() { super.disconnectedCallback(); clearInterval(this.tick); }
  render() {
    const list = S.subs[S.sel] || [], run = list.filter(a => a.running), done = list.filter(a => !a.running);
    return html`${run.map(row)}${done.length ? html`<button class="sdone" @click=${() => { if (S.subsOpen.has(S.sel)) S.subsOpen.delete(S.sel); else S.subsOpen.add(S.sel); changed(); }}>${tn("subs.done", done.length)}</button>${S.subsOpen.has(S.sel) ? done.map(row) : nothing}` : nothing}`;
  }
}
customElements.define("relay-subs", RelaySubs);
