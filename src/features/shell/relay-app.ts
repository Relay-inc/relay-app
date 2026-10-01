import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { th } from "../../core/i18n";
import { inField } from "../../core/dom";
import { urlOk } from "../../core/markdown";
import { request, StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, isView } from "../../domain/ui";
import { vault } from "../../domain/vault";
import { chat } from "../../domain/chats/state";
import { escStop, ctrlC } from "../../domain/chats/actions";
import { setInsp, toggleQuick, zoom } from "../../domain/navigation";
import { panel, closePr, openPr } from "../../domain/panel";
import { noteKey } from "../../domain/notes";
import "../sidebar/relay-sidebar";
import "../chat/relay-chat";
import "../inspector/relay-inspector";
import "../quick/relay-quick";

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

/** The main window: sidebar, the open conversation or view, the right panel. The shortcuts that work anywhere live here. */
@customElement("relay-app")
export class RelayApp extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: grid;
        height: 100%;
        grid-template-columns: 240px minmax(0, 1fr) 300px;
        min-width: 900px;
        transition: grid-template-columns 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      /* the right panel slides away: the column animates to 0 while the content keeps its width and fades */
      :host([noinsp]) {
        grid-template-columns: 240px minmax(0, 1fr) 0px;
      }
      /* a PR, mail or card open: the right panel grows */
      :host([wide]) {
        grid-template-columns: 240px minmax(0, 1fr) 460px;
      }
      @media (max-width: 1100px) {
        :host,
        :host([noinsp]),
        :host([wide]) {
          grid-template-columns: 220px minmax(0, 1fr);
        }
      }
    `,
  ];

  protected store = new StoreController(this);

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
  private noDrop = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  // links in a conversation, a PR or a mail open in the default browser or mail app, a webview window cannot open them itself
  private onLink = (e: MouseEvent) => {
    // a vault note named in markdown opens in the right panel (src/core/markdown.ts)
    const nl = e.composedPath().find((n): n is HTMLElement => n instanceof HTMLElement && !!n.dataset.note);
    if (nl) {
      e.preventDefault();
      openPr(noteKey(nl.dataset.note!));
      return;
    }
    const a = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && !!n.href);
    if (!a || !urlOk(a.href)) return;
    e.preventDefault();
    invoke("plugin:opener|open_url", { url: a.href });
  };
  private onKey = (e: KeyboardEvent) => {
    // Cmd-K: a question that starts a general conversation in the background
    if (e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === "KeyK") {
      e.preventDefault();
      toggleQuick();
      return;
    }
    // Cmd-Alt-I folds the right panel
    if (e.metaKey && e.altKey && e.code === "KeyI") {
      e.preventDefault();
      setInsp(!ui.noinsp);
      return;
    }
    // Ctrl-C like in the terminal: stops a running turn, otherwise clears what is typed
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyC") {
      e.preventDefault();
      ctrlC();
      return;
    }
    if (e.key === "Escape") {
      if (ui.zoom) {
        e.preventDefault();
        zoom("");
      } else if (panel.open && !ui.pop && !inField(e)) {
        e.preventDefault();
        closePr();
      }
      // the search and the title are inputs: Esc in them is theirs (the composer is a textarea, Esc there stops the turn)
      else if (chat.status[ui.sel] === "busy" && !ui.pop && !ui.qk && !inField(e, "input, select")) {
        e.preventDefault();
        escStop();
      }
      return;
    }
    // typing anywhere in an open conversation goes to the composer, focused or not: the key itself then lands there
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.isComposing || isView(ui.sel) || ui.pop || ui.qk) return;
    if (inField(e)) return;
    request("focus-composer");
  };

  willUpdate() {
    this.toggleAttribute("noinsp", ui.noinsp);
    this.toggleAttribute("wide", !!panel.open);
  }

  render() {
    return html` ${vault.snapErr ? html`<div class="fixed top-0 left-1/2 -translate-x-1/2 z-40 max-w-7/10 px-3 py-1.5 rounded-b-lg bg-bg border border-separator text-late text-xs">${th("vault.snapErr", { e: vault.snapErr })}</div>` : nothing}
      <relay-sidebar class="min-h-0 min-w-0 border-r border-separator"></relay-sidebar>
      <relay-chat class="min-h-0 min-w-0"></relay-chat>
      <relay-inspector
        class="min-h-0 min-w-0 overflow-hidden transition duration-200 ease-out max-lg:hidden ${ui.noinsp ? "opacity-0 border-l-transparent pointer-events-none" : ""}"
      ></relay-inspector>
      ${ui.qk ? html`<relay-quick></relay-quick>` : nothing}
      ${ui.zoom ? html`<div class="fixed inset-0 z-30 grid place-items-center p-10 bg-black/55 cursor-zoom-out" @click=${() => zoom("")}><img class="max-w-full max-h-full rounded-lg shadow-2xl bg-bg" alt="" src=${ui.zoom} /></div>` : nothing}`;
  }
}
