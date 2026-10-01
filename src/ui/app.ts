import { html, nothing } from "lit";
import { invoke } from "@tauri-apps/api/core";
import { th } from "../i18n";
import { RelayElement, styles, request, inField, changed } from "../lib/store";
import { urlOk } from "../lib/md";
import { S, isView } from "../app/state";
import { closePr, escStop, ctrlC, setInsp } from "../app/actions";
import css from "./app.css?inline";
import "./nav";
import "./chat";
import "./inspector";
import "./quick";

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

/** The main window: sidebar, the open conversation or view, the right panel. The shortcuts that work anywhere live here. */
export class RelayApp extends RelayElement {
  static styles = styles(css);

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("click", this.onLink);
    // no stray drop outside the composer opens the file in the webview
    window.addEventListener("dragover", this.noDrop);
    window.addEventListener("drop", this.noDrop);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("click", this.onLink);
    window.removeEventListener("dragover", this.noDrop);
    window.removeEventListener("drop", this.noDrop);
  }
  private noDrop = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
  // links in a conversation, a PR or a mail open in the default browser or mail app, a webview window cannot open them itself
  private onLink = (e: MouseEvent) => {
    const a = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && !!n.href);
    if (!a || !urlOk(a.href)) return;
    e.preventDefault(); invoke("plugin:opener|open_url", { url: a.href });
  };
  private onKey = (e: KeyboardEvent) => {
    // Cmd-K: a question that starts a general conversation in the background
    if (e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === "KeyK") { e.preventDefault(); S.qk = !S.qk; changed(); return; }
    // Cmd-Alt-I folds the right panel
    if (e.metaKey && e.altKey && e.code === "KeyI") { e.preventDefault(); setInsp(!S.noinsp); return; }
    // Ctrl-C like in the terminal: stops a running turn, otherwise clears what is typed
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyC") { e.preventDefault(); ctrlC(); return; }
    if (e.key === "Escape") {
      if (S.zoom) { e.preventDefault(); S.zoom = ""; changed(); }
      else if (S.prOpen && !S.pop && !inField(e)) { e.preventDefault(); closePr(); }
      else if (S.status[S.sel] === "busy" && !S.pop && !S.qk && !inField(e, ".search, .ctitle, select")) { e.preventDefault(); escStop(); }
      return;
    }
    // typing anywhere in an open conversation goes to the composer, focused or not: the key itself then lands there
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.isComposing || isView(S.sel) || S.pop || S.qk) return;
    if (inField(e)) return;
    request("focus-composer");
  };

  render() {
    this.toggleAttribute("noinsp", S.noinsp);
    this.toggleAttribute("wide", !!S.prOpen);
    return html`
      ${S.snapErr ? html`<div class="snaperr">${th("vault.snapErr", { e: S.snapErr })}</div>` : nothing}
      <relay-nav></relay-nav>
      <relay-chat></relay-chat>
      <relay-inspector></relay-inspector>
      ${S.qk ? html`<relay-quick></relay-quick>` : nothing}
      ${S.zoom ? html`<div class="zoom" @click=${() => { S.zoom = ""; changed(); }}><img alt="" src=${S.zoom}></div>` : nothing}`;
  }
}
customElements.define("relay-app", RelayApp);
