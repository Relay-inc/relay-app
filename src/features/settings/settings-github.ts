import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import { btn, field, FIELD, foot, FOOT_ROW, HINT0, nc, val } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-github": SettingsGithub;
  }
  interface HTMLElementEventMap {
    "owners-input": CustomEvent<string>;
    "gh-recheck": CustomEvent<void>;
    "gh-save": CustomEvent<void>;
    /** An integration leaves the list (GitHub, Mail, a board provider) */
    "int-remove": CustomEvent<void>;
  }
}

/** GitHub's body in the integrations list: the owners to show PRs of. No token of our own, the app uses gh's login. */
@customElement("relay-settings-github")
export class SettingsGithub extends SettingsElement {
  static styles = [tws];

  /** The owners as typed (unsaved edits stay until Save) */
  @property() owners = "";
  @property() msg = "";
  @property({ type: Boolean }) ok = false;

  render() {
    return html`<p class=${HINT0}>${th("gh.help")}</p>
      ${field(nc(t("gh.owners")), html`<input class=${FIELD} id="ghowners" .value=${live(this.owners)} @input=${(e: Event) => emit(this, "owners-input", val(e))} spellcheck="false" placeholder=${t("gh.ownersPh")} />`, { id: "ghowners" })}
      <div class=${FOOT_ROW}>
        <button class=${btn("ghost")} @click=${() => emit(this, "int-remove")}>${t("ag.remove")}</button
        >${foot(this.msg, this.ok, html`<button class=${btn()} @click=${() => emit(this, "gh-recheck")}>${t("gh.recheck")}</button><button class=${btn("primary")} @click=${() => emit(this, "gh-save")}>${t("set.save")}</button>`)}
      </div>`;
  }
}
