import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th } from "../../core/i18n";
import { md } from "../../core/markdown";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import { brain, brainAct, brainKey, brainName, openNote, type BrainNote } from "../../domain/brain";

/** The Brain view, as Pull requests does it: the notes staged for review on the left, grouped by the brain they belong
 *  to, the one you picked on the right with Promote and Reject. The CLI does the promoting. */
@customElement("relay-brain")
export class RelayBrain extends LitElement {
  static override styles = [
    tw,
    mdDefaults,
    css`
      :host {
        display: grid;
        grid-template-columns: 380px minmax(0, 1fr);
        min-height: 0;
      }
    `,
  ];
  protected store = new StoreController(this);

  override updated() {
    // with nothing picked yet, the first note of the list
    const first = brain.notes?.[0];
    if (!brain.open && first) {
      brain.open = brainKey(first);
      this.requestUpdate();
    }
  }

  private renderRow(note: BrainNote) {
    const selected = brainKey(note) === brain.open;
    return html`<div
      class="flex flex-col gap-1.25 p-2.5 rounded-[9px] cursor-pointer ${selected ? "bg-accent-soft" : "hover:bg-fill"}"
      @click=${() => {
        brain.open = brainKey(note);
        this.requestUpdate();
      }}
    >
      <span class="text-[13px] font-medium leading-snug">${note.title || note.id}</span>
      <span class="flex flex-wrap items-center gap-2 text-xs text-secondary tabular-nums"
        ><span class="font-mono text-[11px]">${note.kind}</span
        >${t("brain.by", { author: note.author, date: note.created })}</span
      >
    </div>`;
  }
  private renderGroups(notes: BrainNote[]) {
    const brains = [...new Set(notes.map(note => note.brain))];
    return brains.map(path => {
      const rows = notes.filter(note => note.brain === path);
      return html`<section>
        <h2
          class="flex items-baseline gap-1.5 px-4 pt-4.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
          title=${path}
        >
          ${brainName(path)} <span class="tabular-nums">${rows.length}</span>
        </h2>
        <div class="flex flex-col gap-0.5 px-2">${rows.map(note => this.renderRow(note))}</div>
      </section>`;
    });
  }
  private renderList() {
    const { notes, status, busy } = brain;
    if (status && !status.plugin) return html`<div class="text-secondary text-sm p-4">${t("brain.off")}</div>`;
    if (!notes)
      return busy ? nothing : html`<div class="text-secondary text-sm text-center p-4">${t("brain.notLoaded")}</div>`;
    if (!notes.length) return html`<div class="text-secondary text-sm px-4 py-4">${t("brain.none")}</div>`;
    return this.renderGroups(notes);
  }

  private renderDetail(note: BrainNote) {
    const cli = !!brain.status?.cli;
    return html`<div class="max-w-180 px-8 pt-5.5 pb-10 flex flex-col gap-4 select-text cursor-auto">
      <div class="flex items-center gap-2 text-xs text-secondary">
        <span class="font-mono">${note.kind}</span><span>·</span
        ><span title=${note.brain}>${brainName(note.brain)}</span
        >${note.source ? html`<span>·</span><span class="font-mono">${note.source}</span>` : nothing}
        <span class="flex-1"></span>
        <button
          class="btn"
          title=${t("brain.rejectTitle")}
          ?disabled=${brain.acting || !cli}
          @click=${() => brainAct(note, "reject")}
        >
          ${t("brain.reject")}
        </button>
        <button
          class="btn btn-primary"
          title=${t("brain.promoteTitle")}
          ?disabled=${brain.acting || !cli}
          @click=${() => brainAct(note, "promote")}
        >
          ${t("brain.promote")}
        </button>
      </div>
      <h1 class="m-0 text-xl font-semibold leading-snug">${note.title || note.id}</h1>
      <div class="text-xs text-secondary tabular-nums">
        ${t("brain.by", { author: note.author, date: note.created })}
      </div>
      ${cli ? nothing : html`<div class="err-box">${th("brain.noCli", { hint: brain.status?.hint ?? "" })}</div>`}
      <div class="md-panel text-sm leading-[1.55]">${md(note.body)}</div>
    </div>`;
  }

  override render() {
    const note = openNote();
    return html`<div class="min-h-0 overflow-y-auto border-r border-separator pb-4">
        ${brain.err ? html`<div class="err-box m-4">${brain.err}</div>` : nothing}${this.renderList()}
      </div>
      <div class="min-h-0 overflow-y-auto">
        ${
          note
            ? this.renderDetail(note)
            : html`<div class="h-full grid place-items-center text-[13px] text-tertiary">${t("brain.pick")}</div>`
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-brain": RelayBrain;
  }
}
