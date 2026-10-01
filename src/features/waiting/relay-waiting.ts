import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t, currentLocale } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { chat, projectOf, label, blockedAgents, waitCount } from "../../domain/chats/state";
import type { Pending } from "../../domain/chats/state";
import { bg, answer } from "../../domain/chats/actions";
import { agent, chatAgent } from "../../domain/agents";
import { select } from "../../domain/navigation";
import { icon, glyphSvg } from "../../core/icons";
import "../../components/permission-card";
import type { PermissionCard } from "../../components/permission-card";

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
  private btn(action: "hide" | "stop" | "attach", id: string, text: string, primary = false, extra = "") {
    return html`<button
      class="${primary ? "btn btn-primary" : "btn"} cursor-pointer ${extra}"
      @click=${() => this.act(action, id)}
    >
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

  // glyph, project / title, and (for a conversation) the link into it
  private renderHeader(glyph: unknown, project: string | null, title: string, chatKey?: string) {
    return html`<div class="flex items-center gap-2 text-[13px]">
      <span class="text-secondary flex-none">${glyph}</span>
      ${project ? html`<span class="text-secondary">${project}</span><span class="text-tertiary">/</span>` : nothing}
      <span class="font-semibold truncate">${title}</span>
      <span class="flex-1"></span>
      ${
        chatKey
          ? html`<button
              class="inline-flex items-center gap-1 text-xs text-secondary px-1.5 py-0.5 rounded-md cursor-pointer hover:bg-fill-2 hover:text-label"
              @click=${() => select(chatKey)}
            >
              ${t("wait.open")}${icon("right", "glyph size-3")}
            </button>`
          : nothing
      }
    </div>`;
  }

  private renderGroup(chatKey: string, requests: Pending[]) {
    const glyph = agent(chatAgent(chatKey))?.glyph;
    return html`<section class="flex flex-col gap-2.5">
      ${this.renderHeader(
        glyph ? glyphSvg(glyph, "glyph size-3.5") : icon("chat", "glyph size-3.5"),
        projectOf(chatKey),
        label(chatKey),
        chatKey,
      )}${repeat(
        requests,
        request => request.id,
        request =>
          html`<relay-permission-card
            .request=${request}
            .where=${request.project ? label(request.project) : ""}
            @answer=${(e: CustomEvent) => this.decide(request, e)}
          ></relay-permission-card>`,
      )}
    </section>`;
  }

  private renderBlockedAgent(agent: ReturnType<typeof blockedAgents>[number]) {
    const started = agent.startedAt ? new Date(agent.startedAt).toLocaleDateString(currentLocale()) : "";
    return html`<section class="flex flex-col gap-2.5">
      ${this.renderHeader(icon("term", "glyph size-3.5"), null, agent.name ?? "")}
      <div class="grid grid-cols-1 gap-2.5 rounded-xl border border-separator-strong bg-raised p-3.5">
        <div class="flex items-center gap-2 text-[13px] text-secondary">
          <span class="grid place-items-center size-5.5 flex-none rounded-md bg-fill-2 text-soon"
            >${icon("term", "glyph size-3.5")}</span
          >${t("wait.bg", { date: started })}
        </div>
        <div class="flex justify-end gap-2">
          ${this.btn("hide", agent.id, t("wait.hide"))}${this.btn("stop", agent.id, t("wait.stop"), false, "text-late")}${this.btn("attach", agent.id, t("bar.openTerminal"), true)}
        </div>
      </div>
    </section>`;
  }

  override render() {
    if (!waitCount())
      return html`<div class="flex flex-col items-center gap-2.5 py-24 text-secondary">
        <span class="grid place-items-center size-10 rounded-full bg-add-bg text-add-fg"
          >${icon("check", "glyph size-5")}</span
        >
        <span class="text-base font-semibold text-label">${t("wait.none")}</span>
        <span class="text-[13px]">${t("wait.noneSub")}</span>
      </div>`;
    const requestsByChat: Record<string, Pending[]> = {};
    for (const request of chat.pendingList) (requestsByChat[request.project] ||= []).push(request);
    return html`<div class="mx-auto flex max-w-170 flex-col gap-7 px-8 pt-7 pb-8">
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
