import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { th } from "../../core/i18n";
import { inField, copyText } from "../../core/dom";
import { urlOk } from "../../core/markdown";
import { request, StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, isView } from "../../domain/ui";
import { vault } from "../../domain/vault";
import { chat } from "../../domain/chats/state";
import { escStop, ctrlC } from "../../domain/chats/actions";
import { toggleQuickAsk, zoom } from "../../domain/navigation";
import { panel, closeDrawer, closeTicket, openDetail } from "../../domain/panel";
import { noteKey } from "../../domain/keys";
import "../sidebar/relay-sidebar";
import "../chat/relay-chat";
import "../drawer/relay-drawer";
import "../quick/relay-quick";

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
const isQuickAskKey = (e: KeyboardEvent) => e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === "KeyK";
const isCtrlCKey = (e: KeyboardEvent) => e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyC";

/** The main window: sidebar, the open conversation or view, the right drawer. The shortcuts that work anywhere live here. */
@customElement("relay-app")
export class RelayApp extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: grid;
        height: 100%;
        grid-template-columns: 240px minmax(0, 1fr) 0px;
        min-width: 900px;
        transition: grid-template-columns 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      /* the drawer exists while open: the column grows from 0 */
      :host([drawer]) {
        grid-template-columns: 240px minmax(0, 1fr) 460px;
      }
      @media (max-width: 1100px) {
        :host,
        :host([drawer]) {
          grid-template-columns: 220px minmax(0, 1fr);
        }
      }
    `,
  ];

  protected store = new StoreController(this);

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("click", this.onLink);
    // no stray drop outside the composer opens the file in the webview
    window.addEventListener("dragover", this.noDrop);
    window.addEventListener("drop", this.noDrop);
  }
  override disconnectedCallback() {
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
    const path = e.composedPath();
    // a vault note named in markdown opens in the right drawer (src/core/markdown.ts)
    const noteLink = path.find(
      (target): target is HTMLElement => target instanceof HTMLElement && !!target.dataset.note,
    );
    if (noteLink) {
      e.preventDefault();
      openDetail(noteKey(noteLink.dataset.note!));
      return;
    }
    // a code block's copy button (src/core/markdown.ts)
    const copyButton = path.find(
      (target): target is HTMLElement => target instanceof HTMLElement && target.hasAttribute("data-copy"),
    );
    if (copyButton) {
      copyText(copyButton.closest(".codeblock")?.querySelector("pre")?.innerText ?? "", copyButton);
      return;
    }
    const anchor = path.find(
      (target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement && !!target.href,
    );
    if (!anchor || !urlOk(anchor.href)) return;
    e.preventDefault();
    invoke("plugin:opener|open_url", { url: anchor.href });
  };

  private onKey = (e: KeyboardEvent) => {
    if (isQuickAskKey(e)) {
      // Cmd-K: a question that starts a general conversation in the background
      e.preventDefault();
      toggleQuickAsk();
    } else if (isCtrlCKey(e)) {
      // Ctrl-C like in the terminal: stops a running turn, otherwise clears what is typed
      e.preventDefault();
      ctrlC();
    } else if (e.key === "Escape") {
      this.onEscape(e);
    } else if (this.typesIntoComposer(e)) {
      request("focus-composer");
    }
  };
  // Esc closes the image, then the right drawer, then stops the running turn
  private onEscape(e: KeyboardEvent) {
    if (ui.zoom) {
      e.preventDefault();
      zoom("");
      return;
    }
    if (panel.modal) {
      e.preventDefault();
      closeTicket();
      return;
    }
    if (ui.drawer && !ui.projectPanel && !inField(e)) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    // the search and the title are inputs: Esc in them is theirs (the composer is a textarea, Esc there stops the turn)
    const turnRunning = chat.status[ui.selected] === "busy" && !ui.projectPanel && !ui.quickAsk;
    if (turnRunning && !inField(e, "input, select")) {
      e.preventDefault();
      escStop();
    }
  }
  // typing anywhere in an open conversation goes to the composer, focused or not: the key itself then lands there
  private typesIntoComposer(e: KeyboardEvent) {
    const isCharacter = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.isComposing;
    const composerAvailable = !isView(ui.selected) && !ui.projectPanel && !ui.quickAsk;
    return isCharacter && composerAvailable && !inField(e);
  }

  override willUpdate() {
    this.toggleAttribute("drawer", !!ui.drawer);
  }

  private renderSnapshotError() {
    if (!vault.snapErr) return nothing;
    return html`<div
      class="fixed top-0 left-1/2 -translate-x-1/2 z-40 max-w-7/10 px-3 py-1.5 rounded-b-lg bg-bg border border-separator text-late text-xs"
    >
      ${th("vault.snapErr", { e: vault.snapErr })}
    </div>`;
  }

  private renderZoom() {
    if (!ui.zoom) return nothing;
    return html`<div
      class="fixed inset-0 z-30 grid place-items-center p-10 bg-black/55 cursor-zoom-out"
      @click=${() => zoom("")}
    >
      <img class="max-w-full max-h-full rounded-lg shadow-2xl bg-bg" alt="" src=${ui.zoom} />
    </div>`;
  }

  override render() {
    return html` ${this.renderSnapshotError()}
      <relay-sidebar class="min-h-0 min-w-0 border-r border-separator"></relay-sidebar>
      <relay-chat class="min-h-0 min-w-0"></relay-chat>
      ${ui.drawer ? html`<relay-drawer class="min-h-0 min-w-0 overflow-hidden max-lg:hidden"></relay-drawer>` : nothing}
      ${ui.quickAsk ? html`<relay-quick></relay-quick>` : nothing} ${this.renderZoom()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-app": RelayApp;
  }
}
