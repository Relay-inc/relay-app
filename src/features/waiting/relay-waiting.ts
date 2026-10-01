import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t, currentLocale } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { chat, projOf, label, blockedAgents, waitCount } from "../../domain/chats/state";
import type { Pending } from "../../domain/chats/state";
import { bg, answer } from "../../domain/chats/actions";
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
  @state() private errs = new Map<string, string>();

  private async act(act: "hide" | "stop" | "attach", id: string) {
    try {
      await bg(act, id);
    } catch (e) {
      this.errs = new Map(this.errs).set(`${act}:${id}`, String(e).slice(0, 60));
    }
  }
  private btn(act: "hide" | "stop" | "attach", id: string, text: string, primary = false) {
    return html`<button class=${primary ? "btn btn-primary" : "btn"} @click=${() => this.act(act, id)}>
      ${this.errs.get(`${act}:${id}`) ?? text}
    </button>`;
  }
  private async decide(r: Pending, e: CustomEvent) {
    const card = e.target as PermissionCard;
    card.busy = true;
    try {
      await answer(r, e.detail);
    } finally {
      card.busy = false;
    }
  }

  override render() {
    if (!waitCount()) return html`<div class="text-center text-sm text-secondary">${t("wait.none")}</div>`;
    const byK: Record<string, Pending[]> = {};
    for (const r of chat.pendingList) (byK[r.project] ||= []).push(r);
    const head = (k: string) => `${projOf(k) ? `${projOf(k)} · ` : ""}${label(k)}`;
    const proj = (text: string) => html`<div class="text-sm font-semibold text-secondary -mb-1.5">${text}</div>`;
    return html`<div class="flex flex-col gap-3.5">
      ${Object.entries(byK).map(
        ([k, rs]) =>
          html`${proj(head(k))}${repeat(
            rs,
            r => r.id,
            r =>
              html`<relay-permission-card
                .request=${r}
                .where=${r.project ? label(r.project) : ""}
                @answer=${(e: CustomEvent) => this.decide(r, e)}
              ></relay-permission-card>`,
          )}`,
      )}
      ${blockedAgents().map(
        a =>
          html`${proj(a.name)}
            <div class="grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3">
              <div class="text-sm text-secondary">
                ${t("wait.bg", { date: new Date(a.startedAt).toLocaleDateString(currentLocale()) })}
              </div>
              <div class="flex justify-end gap-2">
                ${this.btn("hide", a.id, t("wait.hide"))}${this.btn("stop", a.id, t("wait.stop"))}${this.btn("attach", a.id, t("bar.openTerminal"), true)}
              </div>
            </div>`,
      )}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-waiting": RelayWaiting;
  }
}
