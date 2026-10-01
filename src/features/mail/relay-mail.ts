import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { config } from "../../domain/config";
import { projectLabel } from "../../domain/vault";
import { panel, openDetail } from "../../domain/panel";
import {
  mail,
  mailKey,
  mailProject,
  sender,
  unread,
  filtered,
  loadMails,
  moreMails,
  mailSeen,
  setMailFilter,
  openMailSetup,
  type Mail,
} from "../../domain/mail";
import "./mail-bar";
import "./mail-row";
import "./mail-setup";

/** The inbox: search, read state and project on top, the mails that pass the filters under one heading with the unread count. */
@customElement("relay-mail")
export class RelayMail extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
    `,
  ];
  protected store = new StoreController(this);

  private renderMailRow(item: Mail) {
    const project = mailProject(item);
    const key = mailKey(item);
    return html`<relay-mail-row
      .mail=${item}
      .sender=${sender(item)}
      .project=${project ? projectLabel(project) : ""}
      ?selected=${panel.open === key}
      @open-mail=${() => openDetail(key)}
      @flip-mail=${() => mailSeen(key, unread(item))}
    ></relay-mail-row>`;
  }

  private renderInbox(list: Mail[]) {
    const shown = filtered(list, mail.filter);
    const unreadCount = list.filter(unread).length;
    const unreadLabel = unreadCount
      ? html` <span class="font-mono tabular-nums">${th("mail.unread", { n: unreadCount })}</span>`
      : nothing;
    const emptyText = list.length ? th("mail.noMatch") : th("mail.none");
    const rows = shown.length
      ? shown.map(item => this.renderMailRow(item))
      : html`<div class="text-secondary text-sm py-2">${emptyText}</div>`;
    return html`<section class="mb-6">
      <h2 class="list-head">${th("mail.inbox")}${unreadLabel}</h2>
      ${rows}
    </section>`;
  }

  private renderList(list: Mail[] | null) {
    const error = mail.err ? html`<div class="err-box">${mail.err}</div>` : nothing;
    if (list) return html`${error}${this.renderInbox(list)}`;
    const notLoaded = mail.busy
      ? nothing
      : html`<div class="text-secondary text-sm text-center">${th("pr.notLoaded")}</div>`;
    return html`${error}${notLoaded}`;
  }

  private renderMore() {
    return html`<div class="flex justify-center py-3.5">
      <button class="btn inline-flex items-center gap-2" ?disabled=${mail.more} @click=${moreMails}>
        ${mail.more ? html`<span class="spinner"></span>` : nothing}${th("mail.more")}
      </button>
    </div>`;
  }

  // the projects the mails belong to, plus the one filtered on (also when no mail has it any more)
  private projectOptions(list: Mail[] | null): [string, string][] {
    const projects = [...new Set((list || []).map(mailProject).filter((name): name is string => !!name))].sort();
    const selected = mail.filter.project;
    const names = new Set(projects);
    if (selected && selected !== "-") names.add(selected);
    return [...names].map((name): [string, string] => [name, projectLabel(name)]);
  }

  override render() {
    if (!config.value.mail.accounts?.length) return html`<relay-mail-setup @setup=${openMailSetup}></relay-mail-setup>`;
    const list = mail.list;
    return html`<relay-mail-bar
        .filter=${mail.filter}
        .projects=${this.projectOptions(list)}
        ?busy=${mail.busy}
        @filter=${(e: CustomEvent) => setMailFilter(e.detail)}
        @reload=${loadMails}
      ></relay-mail-bar>
      <div>${this.renderList(list)}${list && !mail.end ? this.renderMore() : nothing}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail": RelayMail;
  }
}
