import { LitElement, html, css, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, isTerminal } from "../../domain/ui";
import { chat, terminalOf, projectOf, label } from "../../domain/chats/state";
import type { Item, Pending } from "../../domain/chats/state";
import { routeTo, answer } from "../../domain/chats/actions";
import { project } from "../../domain/vault";
import { openDetail } from "../../domain/panel";
import { notePath } from "../../domain/notes";
import { noteKey } from "../../domain/keys";
import "./user-message";
import "./answer";
import "./tool-step";
import "./error-line";
import "./note-line";
import "./done-line";
import "./working";
import "./route-choice";
import "../../components/permission-card";
import type { PermissionCard } from "../../components/permission-card";

/** The open conversation: what was said and done, a question about the project, the cards waiting, and the working indicator. */
@customElement("relay-conversation")
export class RelayConversation extends LitElement {
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

  private async decide(request: Pending, e: CustomEvent) {
    const card = e.target as PermissionCard;
    card.busy = true;
    try {
      await answer(request, e.detail);
    } finally {
      card.busy = false;
    }
  }

  private renderItem(item: Item) {
    switch (item.kind) {
      case "me":
        return html`<relay-user-message .text=${item.text} .imgs=${item.imgs ?? []}></relay-user-message>`;
      case "ai":
        return html`<relay-answer .text=${item.text}></relay-answer>`;
      case "tool": {
        // a Read or Edit on a note that exists opens it in the right panel
        const note = notePath(item.path);
        return html`<relay-tool-step
          class="-my-1.5"
          .tool=${item.tool}
          .text=${item.text}
          .state=${item.state ?? ""}
          ?link=${!!note}
          @open-note=${() => openDetail(noteKey(note))}
        ></relay-tool-step>`;
      }
      case "err":
        return html`<relay-error-line .text=${item.text}></relay-error-line>`;
      case "done":
        return html`<relay-done-line .text=${item.text}></relay-done-line>`;
      default:
        return html`<relay-note-line .text=${item.text}></relay-note-line>`;
    }
  }

  private get terminalSession() {
    return isTerminal(ui.selected) ? terminalOf(ui.selected) : undefined;
  }
  private get projectName() {
    return this.terminalSession ? this.terminalSession.project : projectOf(ui.selected);
  }

  private renderItems() {
    const items = chat.messages[ui.selected] || [];
    if (items.length) return items.map(item => this.renderItem(item));
    const projectName = this.projectName;
    const empty = project(projectName) ? t("chat.emptyProject", { name: projectName ?? "" }) : t("chat.emptyGeneral");
    return html`<relay-note-line .text=${empty}></relay-note-line>`;
  }

  private renderRouteChoice() {
    const choice = chat.routeChoice;
    if (!choice || choice.key !== ui.selected) return nothing;
    return html`<relay-route-choice
      .hits=${choice.hits}
      @route=${(e: CustomEvent<string>) => routeTo(e.detail)}
    ></relay-route-choice>`;
  }

  private renderCards(waiting: Pending[]) {
    return repeat(
      waiting,
      request => request.id,
      request =>
        html`<relay-permission-card
          .request=${request}
          .where=${request.project && request.project !== ui.selected ? label(request.project) : ""}
          @answer=${(e: CustomEvent) => this.decide(request, e)}
        ></relay-permission-card>`,
    );
  }

  // visible while Claude works: only the pulsing dots, the running step has its own line
  private renderWorking(waiting: Pending[]) {
    if (chat.status[ui.selected] !== "busy" || waiting.length) return nothing;
    return html`<relay-working
      .label=${t("work.working")}
      .text=${ui.selected in chat.outside ? t("work.outside") : ""}
    ></relay-working>`;
  }

  private renderTerminalWriting() {
    if (this.terminalSession?.status !== "busy") return nothing;
    return html`<relay-working .text=${t("term.writing")}></relay-working>`;
  }

  override render() {
    const waiting = chat.pendingList.filter(request => request.project === ui.selected);
    return html`${this.renderItems()} ${this.renderRouteChoice()} ${this.renderCards(waiting)}
    ${this.renderWorking(waiting)} ${this.renderTerminalWriting()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-conversation": RelayConversation;
  }
}
