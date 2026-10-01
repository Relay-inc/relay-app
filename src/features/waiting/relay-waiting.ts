import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t, currentLocale } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { chat, projectOf, label, blockedAgents, waitCount } from "../../domain/chats/state";
import type { Pending } from "../../domain/chats/state";
import { bg, answer } from "../../domain/chats/actions";
import "../../components/permission-card";
import type { PermissionCard } from "../../components/permission-card";

const renderHeading = (text: string) => html`<div class="text-sm font-semibold text-secondary -mb-1.5">${text}</div>`;

/** The Waiting view: what agents ask, grouped per conversation, and background sessions that are blocked. */
@customElement("relay-waiting")
export class RelayWaiting extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);
  // a failed hide, stop or attach shows its error on the button
  @state() private errors = new Map<string, string>();

  private async act(action: "hide" | "stop" | "attach", id: string) {
    try {
      await bg(action, id);
    } catch (e) {
      this.errors = new Map(this.errors).set(`${action}:${id}`, String(e).slice(0, 60));
    }
  }
  private btn(action: "hide" | "stop" | "attach", id: string, text: string, primary = false) {
    return html`<button class=${primary ? "btn btn-primary" : "btn"} @click=${() => this.act(action, id)}>
      ${this.errors.get(`${action}:${id}`) ?? text}
    </button>`;
  }
  private async decide(request: Pending, e: CustomEvent) {
    const card = e.target as PermissionCard;
    card.busy = true;
    try {
      await answer(request, e.detail);
    } finally {
      card.busy = false;
    }
  }

  private renderGroup(chatKey: string, requests: Pending[]) {
    const projectName = projectOf(chatKey);
    const heading = `${projectName ? `${projectName} · ` : ""}${label(chatKey)}`;
    return html`${renderHeading(heading)}${repeat(
      requests,
      request => request.id,
      request =>
        html`<relay-permission-card
          .request=${request}
          .where=${request.project ? label(request.project) : ""}
          @answer=${(e: CustomEvent) => this.decide(request, e)}
        ></relay-permission-card>`,
    )}`;
  }

  private renderBlockedAgent(agent: ReturnType<typeof blockedAgents>[number]) {
    const started = agent.startedAt ? new Date(agent.startedAt).toLocaleDateString(currentLocale()) : "";
    return html`${renderHeading(agent.name ?? "")}
      <div class="grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3">
        <div class="text-sm text-secondary">${t("wait.bg", { date: started })}</div>
        <div class="flex justify-end gap-2">
          ${this.btn("hide", agent.id, t("wait.hide"))}${this.btn("stop", agent.id, t("wait.stop"))}${this.btn("attach", agent.id, t("bar.openTerminal"), true)}
        </div>
      </div>`;
  }

  override render() {
    if (!waitCount()) return html`<div class="text-center text-sm text-secondary">${t("wait.none")}</div>`;
    const requestsByChat: Record<string, Pending[]> = {};
    for (const request of chat.pendingList) (requestsByChat[request.project] ||= []).push(request);
    return html`<div class="flex flex-col gap-3.5">
      ${Object.entries(requestsByChat).map(([chatKey, requests]) => this.renderGroup(chatKey, requests))}
      ${blockedAgents().map(agent => this.renderBlockedAgent(agent))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-waiting": RelayWaiting;
  }
}
