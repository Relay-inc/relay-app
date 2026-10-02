import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { config } from "../../domain/config";
import { projectLabel } from "../../domain/vault";
import { panel, openMail } from "../../domain/panel";
import {
  mail,
  mailKey,
  mailProject,
  sender,
  unread,
  filtered,
  loadMails,
  moreMails,
  mailEnded,
  visibleMails,
  mailSeen,
  setMailFilter,
  openMailSetup,
  type Mail,
} from "../../domain/mail";
import "./mail-bar";
import "./mail-row";
import "./mail-setup";
import "./relay-mail-detail";

/** The inbox, as Mail does it: on the left search, read state and project on top and the mails that pass the filters under
 * one heading with the unread count; on the right the mail you picked. */
@customElement("relay-mail")
export class RelayMail extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: grid;
        grid-template-columns: 380px minmax(0, 1fr);
        min-height: 0;
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
      .account=${config.value.mail.accounts.length > 1 ? item.account : ""}
      ?selected=${panel.mailOpen === key}
      @open-mail=${() => openMail(key)}
      @flip-mail=${() => mailSeen(key, unread(item))}
    ></relay-mail-row>`;
  }

  private renderInbox(list: Mail[]) {
    const shown = filtered(list, mail.filter);
    const unreadCount = list.filter(unread).length;
    const unreadLabel = unreadCount
      ? html` <span class="tabular-nums">${th("mail.unread", { n: unreadCount })}</span>`
      : nothing;
    const emptyText = list.length ? th("mail.noMatch") : th("mail.none");
    const rows = shown.length
      ? shown.map(item => this.renderMailRow(item))
      : html`<div class="text-secondary text-sm px-2.5 py-2">${emptyText}</div>`;
    return html`<section>
      <h2
        class="flex items-baseline gap-1.5 px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
      >
        ${th("mail.inbox")}${unreadLabel}
      </h2>
      <div class="flex flex-col gap-0.5">${rows}</div>
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
    if (!config.value.mail.accounts?.length)
      return html`<div class="col-span-2 max-w-170 w-full mx-auto px-8 pt-7">
        <relay-mail-setup @setup=${openMailSetup}></relay-mail-setup>
      </div>`;
    const list = mail.list && visibleMails();
    return html`<div class="min-h-0 overflow-y-auto border-r border-separator px-2 pt-3 pb-4">
        <relay-mail-bar
          class="block px-2"
          .filter=${mail.filter}
          .projects=${this.projectOptions(list)}
          ?busy=${mail.busy}
          @filter=${(e: CustomEvent) => setMailFilter(e.detail)}
          @reload=${loadMails}
        ></relay-mail-bar>
        ${this.renderList(list)}${list && !mailEnded() ? this.renderMore() : nothing}
      </div>
      <div class="min-h-0 overflow-y-auto">
        ${
          panel.mailOpen
            ? html`<relay-mail-detail class="max-w-200 px-8 pt-5.5 pb-10 select-text cursor-auto"></relay-mail-detail>`
            : html`<div class="h-full grid place-items-center text-[13px] text-tertiary">${th("mail.pick")}</div>`
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail": RelayMail;
  }
}
