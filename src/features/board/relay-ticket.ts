import { LitElement, css, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, property } from "lit/decorators.js";
import { t, currentLocale } from "../../core/i18n";
import { copyText, emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import type { CardView, Opt } from "../../domain/providers";
import { avatar, due, ring } from "./format";

declare global {
  interface HTMLElementEventMap {
    "ticket-close": CustomEvent<void>;
    "ticket-step": CustomEvent<number>;
    "ticket-chat": CustomEvent<void>;
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(currentLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/** One task in a window over the board: the main column (title, description, files, activity with the comment box)
 * and the sidebar with its fields. Pure view: it asks for things with events, the board does them ("ticket-close",
 * "ticket-step" ±1, "ticket-chat", and the "detail-act" of the providers for status, assignee, comment and files). */
@customElement("relay-ticket")
export class RelayTicket extends LitElement {
  static override styles = [
    tw,
    mdDefaults,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  @property({ attribute: false }) view: CardView | null = null;
  @property() err = "";
  @property() actErr = "";
  @property({ type: Boolean }) acting = false;
  @property() providerName = "";
  @property() projectName = "";
  /** "3 of 14" */
  @property() position = "";
  @property({ type: Boolean }) first = false;
  @property({ type: Boolean }) last = false;
  /** the card's number as the board has it, until the full card has loaded */
  @property() number = "";

  private act(from: EventTarget, action: string, value: string, files: File[] = [], done?: () => void) {
    emit(from as HTMLElement, "detail-act", { action, value, files, done });
  }

  private iconButton(name: string, title: string, onClick: () => void, disabled = false) {
    return html`<button class="btn-icon disabled:opacity-40" title=${title} ?disabled=${disabled} @click=${onClick}>
      ${icon(name, "glyph size-4")}
    </button>`;
  }

  private renderHeader(v: CardView | null) {
    const where = [this.projectName, v?.board].filter(Boolean).join(" · ");
    const number = v?.number ?? this.number;
    return html`<div class="h-13 flex-none flex items-center gap-2 pl-5 pr-3 border-b border-separator">
      ${where ? html`<span class="inline-flex items-center gap-1.5 text-secondary">${icon("board", "glyph size-3.5")}${where}</span><span class="text-tertiary">/</span>` : nothing}
      ${number ? html`<span class="font-mono text-xs">${/^\d+$/.test(number) ? "#" : ""}${number}</span>` : nothing}
      <span class="flex-1"></span>
      <span class="text-xs text-tertiary tabular-nums mr-0.5">${this.position}</span>
      ${this.iconButton("left", t("kb.prev"), () => emit(this, "ticket-step", -1), this.first)}
      ${this.iconButton("right", t("kb.next"), () => emit(this, "ticket-step", 1), this.last)}
      <span class="w-px h-4 bg-separator-strong mx-1"></span>
      ${
        v?.url
          ? html`<a
              class="inline-flex items-center gap-1 h-7 px-2.5 rounded-[7px] text-xs text-secondary no-underline hover:bg-fill-2 hover:text-label"
              href=${v.url}
              >${t("kb.openIn", { name: this.providerName })}${icon("out", "glyph size-3")}</a
            >`
          : nothing
      }
      ${this.iconButton("close", t("kb.closeEsc"), () => emit(this, "ticket-close"))}
    </div>`;
  }

  private files(list: NonNullable<CardView["files"]>) {
    return html`<ul class="flex flex-col gap-1 my-1.5 text-sm">
      ${list.map(f => html`<li class="flex items-baseline gap-2 min-w-0">${f.url ? html`<a class="truncate" href=${f.url}>${f.name}</a>` : html`<span class="truncate">${f.name}</span>`}<span class="text-xs text-secondary tabular-nums">${size(f.size)}</span></li>`)}
    </ul>`;
  }

  private heading(text: string) {
    return html`<h3 class="m-0 text-[11px] font-semibold tracking-wider uppercase text-tertiary">${text}</h3>`;
  }

  private renderFiles(v: CardView) {
    if (!v.files) return nothing;
    return html`<section class="flex flex-col gap-2">
      ${this.heading(t("kb.files"))}
      ${v.files.length ? this.files(v.files) : html`<div class="text-secondary text-sm">${t("kb.noFiles")}</div>`}
      <label class="btn self-start inline-flex items-center cursor-pointer"
        >${t("kb.attach")}<input
          type="file"
          multiple
          hidden
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            if (input.files?.length) this.act(input, "attach", "", [...input.files]);
            input.value = "";
          }}
      /></label>
    </section>`;
  }

  private renderActivity(v: CardView) {
    const send = (e: Event) => {
      const box = (e.target as HTMLElement).closest("section")!.querySelector("textarea")!;
      if (box.value.trim()) this.act(box, "comment", box.value, [], () => (box.value = ""));
    };
    return html`<section class="flex flex-col gap-1">
      <div class="mb-1.5">${this.heading(t("kb.activity"))}</div>
      ${v.feed.map(
        f =>
          html`<div class="flex gap-3 py-2">
            ${avatar(f.who || this.providerName, "size-6 text-[9px]")}
            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
              <div class="flex gap-2 text-xs">
                <b class="font-semibold">${f.who || this.providerName}</b
                ><span class="text-tertiary tabular-nums">${when(f.at)}</span>
              </div>
              ${f.html ? html`<div class="md-panel text-sm leading-relaxed">${unsafeHTML(f.html)}</div>` : f.change ? html`<div class="text-sm text-secondary">${f.change}</div>` : nothing}
              ${f.files.length ? this.files(f.files) : nothing}
            </div>
          </div>`,
      )}
      <div class="flex items-center gap-2.5 mt-2 py-2 pl-3.5 pr-2 rounded-xl border border-separator-strong bg-raised">
        <textarea
          class="flex-1 min-w-0 border-0 outline-none bg-transparent text-sm text-label resize-none p-0"
          rows="1"
          placeholder=${t("kb.commentPh")}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send(e);
            }
          }}
        ></textarea>
        <button
          class="h-7 px-3 rounded-[7px] border-0 bg-fill-2 text-secondary text-xs font-medium hover:text-label"
          @click=${send}
        >
          ${t("kb.comment")}
        </button>
      </div>
    </section>`;
  }

  /** A sidebar field; the title above it, the value below. */
  private field(label: string, body: unknown) {
    return html`<div class="flex flex-col gap-1 px-2 py-1.5">
      <span class="text-xs text-secondary">${label}</span>${body}
    </div>`;
  }
  /** The value as a pill that opens the browser's own list over it when there are choices, else plain. */
  private picker(action: string, current: string, choices: Opt[] | undefined, shown: unknown, none?: string) {
    const pill = "inline-flex self-start items-center gap-2 h-6.5 px-2 -ml-2 rounded-[7px] text-[13px]";
    if (!choices) return html`<span class="${pill} font-medium">${shown}</span>`;
    return html`<label class="${pill} relative font-medium hover:bg-fill-2"
      >${shown}
      <select
        class="absolute inset-0 opacity-0 w-full"
        @change=${(e: Event) => this.act(e.target!, action, (e.target as HTMLSelectElement).value)}
      >
        ${none ? html`<option value="" ?selected=${!current}>${none}</option>` : nothing}
        ${choices.map(o => html`<option value=${o.id} ?selected=${o.id === current}>${o.name}</option>`)}
      </select></label
    >`;
  }

  private renderSidebar(v: CardView) {
    const day = due(v.due || null);
    return html`<aside class="border-l border-separator bg-sidebar px-4 py-5 flex flex-col gap-0.5 overflow-y-auto">
      ${v.status ? this.field(t("kb.fStatus"), this.picker("status", v.status.id, v.statuses, html`${ring(v.status.state)}${v.status.name}`)) : nothing}
      ${v.list ? this.field(t("kb.fList"), html`<span class="inline-flex items-center gap-1.5 text-[13px]">${icon("folder", "glyph size-3.5 text-secondary")}${v.list}</span>`) : nothing}
      ${
        v.people || v.assignee
          ? this.field(
              t("kb.fWho"),
              this.picker(
                "assignee",
                v.assignee?.id ?? "",
                v.people,
                v.assignee
                  ? html`${avatar(v.assignee.name.split(" ")[0])}${v.assignee.name}`
                  : html`<span class="text-secondary font-normal">${t("kb.unassigned")}</span>`,
                t("kb.unassigned"),
              ),
            )
          : nothing
      }
      ${day ? this.field(t("kb.fDue"), html`<span class="inline-flex items-center gap-1.5 text-[13px] ${day.tone}">${icon("cal", "glyph size-3.5")}${day.long}</span>`) : nothing}
      ${v.labels.length ? this.field(t("kb.fLabels"), html`<div class="flex flex-wrap gap-1.5">${v.labels.map(name => html`<span class="h-5.5 px-2 rounded-md bg-fill-2 text-xs inline-flex items-center">${name}</span>`)}</div>`) : nothing}
      ${this.projectName ? this.field(t("kb.fProject"), html`<span class="flex items-center gap-1.5 text-[13px]">${icon("folder", "glyph size-3.5 text-ctx-a")}${this.projectName}</span>`) : nothing}
      <div class="h-px bg-separator mx-2 my-3"></div>
      <div class="flex flex-col gap-2 px-2">
        <button
          class="btn btn-primary inline-flex items-center justify-center gap-1.5 h-8 rounded-lg"
          @click=${() => emit(this, "ticket-chat")}
        >
          ${icon("chat", "glyph size-3.5")}${t("kb.startChat")}
        </button>
        ${v.url ? html`<button class="btn h-8 rounded-lg" @click=${(e: Event) => copyText(v.url, e.currentTarget as HTMLElement)}>${t("kb.copyLink")}</button>` : nothing}
      </div>
    </aside>`;
  }

  private renderBody(v: CardView | null) {
    if (this.err) return html`<div class="p-8"><div class="err-box">${this.err}</div></div>`;
    if (!v) return html`<div class="p-8 text-secondary">${t("kb.loading")}</div>`;
    return html`<div class="min-h-0 grid grid-cols-[minmax(0,1fr)_272px] flex-1">
      <div class="overflow-y-auto px-10 pt-7 pb-8 flex flex-col gap-7 select-text cursor-auto">
        ${this.actErr ? html`<div class="err-box">${this.actErr}</div>` : nothing}
        <h2 class="m-0 text-xl leading-snug font-semibold tracking-tight text-pretty">
          ${v.closed ? html`<span class="text-xs font-normal text-secondary border border-separator rounded-sm px-1 mr-1.5 align-middle">${t("kb.closed")}</span>` : nothing}${v.title}
        </h2>
        ${v.description.trim() ? html`<div class="md-panel text-sm leading-relaxed max-w-150">${unsafeHTML(v.description)}</div>` : html`<div class="text-sm text-tertiary">${t("kb.noDesc")}</div>`}
        ${this.renderFiles(v)}${this.renderActivity(v)}
      </div>
      ${this.renderSidebar(v)}
    </div>`;
  }

  override render() {
    return html`<div
      class="fixed inset-0 z-50 grid place-items-center bg-black/30"
      @click=${() => emit(this, "ticket-close")}
    >
      <div
        class="w-240 max-w-[calc(100vw-48px)] h-175 max-h-[calc(100vh-48px)] flex flex-col bg-bg rounded-2xl shadow-md ring-1 ring-separator-strong overflow-hidden ${this.acting ? "opacity-70" : ""}"
        .inert=${this.acting}
        @click=${(e: Event) => e.stopPropagation()}
      >
        ${this.renderHeader(this.view)}${this.renderBody(this.view)}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-ticket": RelayTicket;
  }
}
