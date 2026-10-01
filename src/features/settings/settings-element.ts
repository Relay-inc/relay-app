import { LitElement } from "lit";

/** Redraws when the container switched the language: the `t()` strings are read while rendering, and a component whose
 *  properties did not change would keep the old ones. */
export class SettingsElement extends LitElement {
  private relang = () => this.requestUpdate();
  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("settings-lang", this.relang);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("settings-lang", this.relang);
  }
}
