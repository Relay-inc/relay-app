import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th } from "../../core/i18n";
import { inField } from "../../core/dom";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { config, mailExperimental } from "../../domain/config";
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
  mailBox,
  mailMove,
  mailSeenSelected,
  toggleMailSelect,
  toggleMailSelectAll,
  clearMailSelection,
  shownMailKeys,
  type Mail,
  type MailBox,
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
  private inList = true; // the last click was in the list, not the mail: Cmd-A ticks mails instead of selecting text

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey, true); // capture: Esc unticks before the app sees it
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey, true);
  }

  // what a key acts on: the ticked mails, else the open one
  private targets() {
    return mail.selected.size ? [...mail.selected] : panel.mailOpen ? [panel.mailOpen] : [];
  }
  // experimental, as in Gmail and Keel: E archives, # or Delete deletes, Cmd-A ticks all, Esc unticks
  private onKey = (e: KeyboardEvent) => {
    if (!mailExperimental() || inField(e) || e.isComposing) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (plain && (e.key === "e" || e.key === "#" || e.key === "Delete" || e.key === "Backspace")) {
      if (e.repeat) return e.preventDefault(); // a held key would walk down the list, one mail per repeat
      const keys = this.targets();
      if (!keys.length) return;
      e.preventDefault();
      mailMove(keys, e.key !== "e", shownMailKeys());
    } else if (e.metaKey && e.key === "a" && this.inList) {
      e.preventDefault();
      toggleMailSelectAll(shownMailKeys());
    } else if (e.key === "Escape" && mail.selected.size) {
      e.stopImmediatePropagation();
      clearMailSelection();
    }
  };

  private renderMailRow(item: Mail, split: boolean) {
    const project = mailProject(item);
    const key = mailKey(item);
    return html`<relay-mail-row
      .mail=${item}
      .sender=${sender(item)}
      .project=${project ? projectLabel(project) : ""}
      .account=${config.value.mail.accounts.length > 1 ? item.account : ""}
      ?selected=${panel.mailOpen === key}
      ?selectable=${split}
      ?checked=${mail.selected.has(key)}
      @open-mail=${() => openMail(key)}
      @flip-mail=${() => mailSeen(key, unread(item))}
      @select-mail=${(e: CustomEvent<{ range: boolean }>) => toggleMailSelect(key, e.detail.range, shownMailKeys())}
      @archive-mail=${() => mailMove([key], false, shownMailKeys())}
      @trash-mail=${() => mailMove([key], true, shownMailKeys())}
    ></relay-mail-row>`;
  }

  private renderHeading(list: Mail[]) {
    const unreadCount = list.filter(unread).length;
    const unreadLabel = unreadCount
      ? html` <span class="tabular-nums">${th("mail.unread", { n: unreadCount })}</span>`
      : nothing;
    return html`<h2
      class="flex items-baseline gap-1.5 px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
    >
      ${th("mail.inbox")}${unreadLabel}
    </h2>`;
  }
  // Inbox and Other as two tabs, each with its unread count
  private renderBoxes(list: Mail[]) {
    const tab = (box: MailBox, label: string) => {
      const unreadCount = list.filter(x => mailBox(x, true) === box && unread(x)).length;
      const active = mail.filter.box === box;
      return html`<button
        class="px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-[0.06em] cursor-pointer
          ${active ? "bg-fill text-primary" : "text-tertiary hover:text-secondary"}"
        aria-pressed=${active}
        @click=${() => setMailFilter({ box })}
      >
        ${label}${unreadCount ? html` <span class="tabular-nums font-medium">${unreadCount}</span>` : nothing}
      </button>`;
    };
    return html`<div class="flex items-center gap-1 px-1 pt-1 pb-2">
      ${tab("inbox", t("mail.inbox"))}${tab("other", t("mail.other"))}
    </div>`;
  }
  // in place of the tabs while mails are ticked: all/none, the count and what to do with them
  private renderBulkBar(shown: string[]) {
    const all = shown.length > 0 && shown.every(k => mail.selected.has(k));
    const button = (name: string, label: string, run: () => void) =>
      html`<button class="btn btn-icon w-7! h-7!" title=${label} aria-label=${label} @click=${run}>
        ${icon(name)}
      </button>`;
    return html`<div class="flex items-center gap-1.5 px-2 pt-1 pb-2">
      <input
        type="checkbox"
        class="cursor-pointer"
        aria-label=${t("mail.selectAll")}
        .checked=${all}
        .indeterminate=${!all}
        @click=${(e: Event) => {
          e.preventDefault();
          toggleMailSelectAll(shown);
        }}
      />
      <span class="text-xs text-secondary tabular-nums flex-1">${th("mail.selected", { n: mail.selected.size })}</span>
      ${button("archive", `${t("mail.archive")} (E)`, () => mailMove([...mail.selected], false, shown))}
      ${button("trash", `${t("mail.trash")} (#)`, () => mailMove([...mail.selected], true, shown))}
      ${button("read", t("mail.markRead"), () => mailSeenSelected(true))}
      ${button("unread", t("mail.markUnread"), () => mailSeenSelected(false))}
      ${button("close", `${t("mail.clearSelection")} (Esc)`, clearMailSelection)}
    </div>`;
  }

  private renderInbox(list: Mail[]) {
    const split = mailExperimental();
    const shown = filtered(list, mail.filter, split);
    const emptyText = list.length ? th("mail.noMatch") : th("mail.none");
    const rows = shown.length
      ? shown.map(item => this.renderMailRow(item, split))
      : html`<div class="text-secondary text-sm px-2.5 py-2">${emptyText}</div>`;
    const heading = !split
      ? this.renderHeading(list)
      : mail.selected.size
        ? this.renderBulkBar(shown.map(mailKey))
        : this.renderBoxes(list);
    return html`<section>
      ${heading}
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
    return html`<div
        class="min-h-0 overflow-y-auto border-r border-separator px-2 pt-3 pb-4"
        @pointerdown=${() => (this.inList = true)}
      >
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
      <div class="min-h-0 overflow-y-auto" @pointerdown=${() => (this.inList = false)}>
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
