import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { md } from "../../core/markdown";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import { panel, closeDetail, openDetail } from "../../domain/panel";
import { noteOf, noteKnown } from "../../domain/notes";
import { noteKey, panelItem } from "../../domain/keys";

type Note = { path: string; text: string };

// the frontmatter's [[links]] clickable, the rest as written
const frontmatter = (text: string) =>
  text.split(/(\[\[[^\]\n]+\]\])/).map(part => {
    const link = /^\[\[([^\]\n]+)\]\]$/.exec(part);
    if (!link) return part;
    const target = noteOf(link[1]);
    const label = link[1].split("|").pop()!.trim();
    return noteKnown(target) ? html`<a class="vlink" @click=${() => openDetail(noteKey(target))}>${label}</a>` : label;
  });

const noteTarget = (key: string) => {
  const item = panelItem(key);
  return item?.kind === "note" ? item.target : "";
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** A vault note in the right panel: the frontmatter as small print, the body as markdown. Links in it open the next note. */
@customElement("relay-note-detail")
export class RelayNoteDetail extends LitElement {
  static override styles = [
    tw,
    mdDefaults,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);

  private renderBar(note: Note | undefined) {
    return html`<div class="flex items-center flex-wrap gap-2 mb-3">
      <button class="btn whitespace-nowrap flex-none" title=${t("pr.close")} @click=${closeDetail}>×</button>
      <span class="text-secondary overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0"
        >${note?.path ?? noteTarget(panel.open)}</span
      >
    </div>`;
  }
  private renderNote(note: Note) {
    const match = FRONTMATTER.exec(note.text);
    const properties = match ? match[1] : "";
    const markdown = note.text.slice(match ? match[0].length : 0);
    return html`${
        properties
          ? html`<div class="text-secondary mb-3 font-mono text-xs whitespace-pre-wrap">
              ${frontmatter(properties)}
            </div>`
          : nothing
      }
      <div class="md-panel [&_p+p]:mt-2">${md(markdown)}</div>`;
  }

  override render() {
    const note = panel.detail[panel.open] as Note | undefined;
    const bar = this.renderBar(note);
    if (panel.err)
      return html`${bar}
        <div class="err-box">${panel.err}</div>`;
    if (!note)
      return html`${bar}
        <div class="text-secondary mb-3">${t("pr.loading")}</div>`;
    return html`${bar}${this.renderNote(note)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-note-detail": RelayNoteDetail;
  }
}
