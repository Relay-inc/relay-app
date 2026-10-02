import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import xtermCss from "@xterm/xterm/css/xterm.css?inline";
import { t } from "../../core/i18n";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { addTerminal, closeTerminal, showTerminal, termsOf, type Term } from "../../domain/terminals";

/** The project's shells as tabs, the shown one filling the rest. The terminals outlive this element (domain/terminals.ts): it only re-attaches them. */
@customElement("relay-terminals")
export class RelayTerminals extends LitElement {
  static override styles = [
    tw,
    unsafeCSS(xtermCss),
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
        background: var(--bg);
      }
      #screen {
        flex: 1;
        min-height: 0;
        padding: 6px 0 6px 10px;
      }
    `,
  ];
  protected store = new StoreController(this);
  @property() project = "";
  @query("#screen") private screen!: HTMLElement;
  private shown: Term | undefined;
  private resizer = new ResizeObserver(() => this.fitShown());
  private scheme = matchMedia("(prefers-color-scheme: dark)");
  private recolor = () => this.applyTheme();
  private themeWatch = new MutationObserver(this.recolor);

  override connectedCallback() {
    super.connectedCallback();
    this.scheme.addEventListener("change", this.recolor);
    this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizer.disconnect();
    this.scheme.removeEventListener("change", this.recolor);
    this.themeWatch.disconnect();
    this.shown = undefined; // the xterm stays alive in the domain; the next element attaches it again
  }

  override willUpdate(changes: PropertyValues<this>) {
    // the first time a project shows terminals it gets one; closing the last tab leaves it empty
    if (changes.has("project") && this.project && !termsOf(this.project)?.list.length) addTerminal(this.project);
  }

  protected override firstUpdated() {
    this.resizer.observe(this.screen);
  }
  protected override updated() {
    const entry = termsOf(this.project);
    const term = entry?.list.find(x => x.id === entry.active);
    if (term !== this.shown) this.attach(term);
  }

  private attach(term: Term | undefined) {
    this.shown = term;
    this.screen.replaceChildren(...(term ? [term.el] : []));
    if (!term) return;
    if (!term.xterm.element) term.xterm.open(term.el);
    this.applyTheme();
    this.fitShown();
    term.xterm.focus();
  }

  private fitShown() {
    if (this.screen.clientWidth > 0 && this.screen.clientHeight > 0) this.shown?.fit.fit();
  }

  // the app's colours, read where they resolve, so light/dark and the pinned theme in the settings both land
  private applyTheme() {
    const style = getComputedStyle(this);
    const color = (name: string) => style.getPropertyValue(name).trim();
    for (const term of termsOf(this.project)?.list ?? [])
      term.xterm.options.theme = {
        background: color("--bg"),
        foreground: color("--label"),
        cursor: color("--label"),
        selectionBackground: color("--fill-2"),
      };
  }

  private renderTab(term: Term, active: boolean) {
    return html`<div
      class="group flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-md text-xs cursor-pointer select-none ${
        active ? "bg-fill-2 text-label" : "text-secondary hover:bg-fill"
      } ${term.exited ? "opacity-60" : ""}"
      @click=${() => showTerminal(this.project, term.id)}
    >
      ${term.title}
      <button
        class="btn-icon cursor-pointer"
        title=${t("term.close")}
        aria-label=${t("term.close")}
        @click=${(e: Event) => {
          e.stopPropagation();
          closeTerminal(this.project, term.id);
        }}
      >
        ${icon("close", "glyph size-3 stroke-current!")}
      </button>
    </div>`;
  }

  override render() {
    const entry = termsOf(this.project);
    return html`
      <div class="flex items-center gap-1 px-2 py-1.5 border-b border-separator">
        ${entry?.list.map(term => this.renderTab(term, term.id === entry.active)) ?? nothing}
        <button
          class="btn-icon cursor-pointer"
          title=${t("term.new")}
          aria-label=${t("term.new")}
          @click=${() => addTerminal(this.project)}
        >
          ${icon("plus", "glyph size-3.75 stroke-current!")}
        </button>
      </div>
      <div id="screen"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-terminals": RelayTerminals;
  }
}
