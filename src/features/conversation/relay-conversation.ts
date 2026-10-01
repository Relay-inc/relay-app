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

  private async decide(r: Pending, e: CustomEvent) {
    const card = e.target as PermissionCard;
    card.busy = true;
    try {
      await answer(r, e.detail);
    } finally {
      card.busy = false;
    }
  }

  private item(it: Item) {
    switch (it.kind) {
      case "me":
        return html`<relay-user-message .text=${it.text} .imgs=${it.imgs ?? []}></relay-user-message>`;
      case "ai":
        return html`<relay-answer .text=${it.text}></relay-answer>`;
      case "tool": {
        // a Read or Edit on a note that exists opens it in the right panel
        const note = notePath(it.path);
        return html`<relay-tool-step
          class="-my-1.5"
          .tool=${it.tool}
          .text=${it.text}
          .state=${it.state ?? ""}
          ?link=${!!note}
          @open-note=${() => openDetail(noteKey(note))}
        ></relay-tool-step>`;
      }
      case "err":
        return html`<relay-error-line .text=${it.text}></relay-error-line>`;
      case "done":
        return html`<relay-done-line .text=${it.text}></relay-done-line>`;
      default:
        return html`<relay-note-line .text=${it.text}></relay-note-line>`;
    }
  }

  override render() {
    const sel = ui.selected,
      items = chat.messages[sel] || [],
      T = isTerminal(sel) ? terminalOf(sel) : undefined,
      pn = T ? T.project : projectOf(sel);
    const waiting = chat.pendingList.filter(r => r.project === sel),
      rc = chat.routeChoice;
    return html`${items.length ? items.map(it => this.item(it)) : html`<relay-note-line .text=${project(pn) ? t("chat.emptyProject", { name: pn ?? "" }) : t("chat.emptyGeneral")}></relay-note-line>`}
    ${rc && rc.key === sel ? html`<relay-route-choice .hits=${rc.hits} @route=${(e: CustomEvent<string>) => routeTo(e.detail)}></relay-route-choice>` : nothing}
    ${repeat(
      waiting,
      r => r.id,
      r =>
        html`<relay-permission-card
          .request=${r}
          .where=${r.project && r.project !== sel ? label(r.project) : ""}
          @answer=${(e: CustomEvent) => this.decide(r, e)}
        ></relay-permission-card>`,
    )}
    ${
      chat.status[sel] === "busy" && !waiting.length
        ? // visible while Claude works: only the pulsing dots, the running step has its own line
          html`<relay-working
            .label=${t("work.working")}
            .text=${sel in chat.outside ? t("work.outside") : ""}
          ></relay-working>`
        : nothing
    }
    ${T && T.status === "busy" ? html`<relay-working .text=${t("term.writing")}></relay-working>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-conversation": RelayConversation;
  }
}
