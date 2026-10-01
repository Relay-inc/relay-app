import { html } from "lit";
import { t, th } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { md } from "../lib/md";
import { urgency } from "../reminders";
import { S, ghOn, selProject, project } from "../app/state";
import { setTab, cardOf, closePr } from "../app/actions";
import { prRow } from "../github";
import css from "./inspector.css?inline";
import "./prs";
import "./mail-view";
import "./pr-detail";
import "./mail-detail";

const TABS = [["open", "tab.open"], ["stand", "tab.stand"], ["rem", "nav.reminders"], ["prs", "tab.prs"]] as const;

/** The right panel: the tabs, the "today" list, a project's tabs, and the open PR, mail or card. */
export class RelayInspector extends RelayElement {
  static styles = styles(css);

  private detail() {
    const key = S.prOpen, cd = cardOf(key);
    if (cd) return html`<div @detail-close=${closePr}>${cd.d.render(S.prDetail[key] ?? null, S.prDetailErr)}</div>`;
    return key.startsWith("mail:") ? html`<relay-mail-detail></relay-mail-detail>` : html`<relay-pr-detail></relay-pr-detail>`;
  }

  private body() {
    if (S.prOpen) return this.detail();
    const P = project(selProject());
    if (!P) {
      const due = S.snap.reminders.filter((r: any) => r.days <= 0);
      return html`<h2>${th("insp.today")} <span class="count">${due.length}</span></h2>${due.length ? html`<ul class="todo">${due.map((r: any) =>
        html`<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count">${r.project || ""} · <span class=${urgency(r.days)}>${r.days < 0 ? th("due.overdue", { n: -r.days }) : th("due.today")}</span></span></span></li>`)}</ul>`
        : html`<div class="meta">${th("insp.nothingDue")}</div>`}`;
    }
    const rem = S.snap.reminders.filter((r: any) => r.project === P.name);
    const when = (r: any) => r.days < 0 ? th("due.overdue", { n: -r.days }) : r.days === 0 ? th("due.today") : th("due.in", { n: r.days });
    const items: string[] = P.open_items || [];
    if (S.tab === "prs") {
      if (!S.prs) return html`<div class="meta">${th("pr.loading")}</div>`;
      const review = S.prs.review.filter(p => p.project === P.name), mine = S.prs.mine.filter(p => p.project === P.name);
      return html`<h2>${th("nav.prs")} <span class="count">${review.length + mine.length}</span></h2>${review.length + mine.length
        ? html`<div class="pr-side">${review.map(p => prRow(p, false))}${mine.map(p => prRow(p, true))}</div>` : html`<div class="meta">${th("pr.noneProject")}</div>`}`;
    }
    if (S.tab === "stand") return html`<h2>${th("insp.stand")}</h2><div class="meta">${th("insp.updated", { date: P.last })}</div><div class="stand">${md(P.stand || t("insp.noStand"))}</div>`;
    if (S.tab === "rem") return rem.length ? html`<h2>${th("nav.reminders")}</h2><ul class="todo">${rem.map((r: any) =>
      html`<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class=${"count " + urgency(r.days)}>${when(r)}</span></span></li>`)}</ul>` : html`<div class="meta">${th("insp.noRem")}</div>`;
    return html`<h2>${th("tab.open")} <span class="count">${items.length}</span></h2>${items.length
      ? html`<ul class="todo">${items.map(x => html`<li><input type="checkbox" disabled><span class="tx">${md(x)}</span></li>`)}</ul>`
      : html`<div class="meta">${th("insp.noOpen")}</div>`}`;
  }

  render() {
    this.toggleAttribute("wide", !!S.prOpen);
    if (S.tab === "prs" && !ghOn()) S.tab = "open";
    return html`<div class="bar" data-tauri-drag-region><div class="seg">${TABS.map(([id, key]) =>
      html`<button class=${S.tab === id ? "on" : ""} ?hidden=${id === "prs" && !ghOn()} @click=${() => setTab(id)}>${th(key)}</button>`)}</div></div>
      <div class="ibody">${this.body()}</div>`;
  }
}
customElements.define("relay-inspector", RelayInspector);
