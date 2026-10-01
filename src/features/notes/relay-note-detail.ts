import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { md } from "../../core/markdown";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import { panel, closePr, openPr } from "../../domain/panel";
import { noteOf, noteKnown, noteKey } from "../../domain/notes";

// the frontmatter's [[links]] clickable, the rest as written
const frontmatter = (fm: string) => fm.split(/(\[\[[^\]\n]+\]\])/).map(part => {
  const m = /^\[\[([^\]\n]+)\]\]$/.exec(part);
  if (!m) return part;
  const target = noteOf(m[1]), label = m[1].split("|").pop()!.trim();
  return noteKnown(target) ? html`<a class="vlink" @click=${() => openPr(noteKey(target))}>${label}</a>` : label;
});

/** A vault note in the right panel: the frontmatter as small print, the body as markdown. Links in it open the next note. */
@customElement("relay-note-detail")
export class RelayNoteDetail extends LitElement {
  static styles = [tw, mdDefaults, css`:host { display: block; }`];
  protected store = new StoreController(this);

  render() {
    const n = panel.detail[panel.open] as { path: string; text: string } | undefined, err = panel.err;
    const bar = html`<div class="flex items-center flex-wrap gap-2 mb-3"><button class="btn whitespace-nowrap flex-none" title=${t("pr.close")} @click=${closePr}>×</button>
      <span class="text-secondary overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">${n?.path ?? panel.open.slice(5)}</span></div>`;
    if (err) return html`${bar}<div class="err-box">${err}</div>`;
    if (!n) return html`${bar}<div class="text-secondary mb-3">${t("pr.loading")}</div>`;
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(n.text), fm = m ? m[1] : "";
    return html`${bar}${fm ? html`<div class="text-secondary mb-3 font-mono text-xs whitespace-pre-wrap">${frontmatter(fm)}</div>` : nothing}<div class="md-panel [&_p+p]:mt-2">${md(n.text.slice(m ? m[0].length : 0))}</div>`;
  }
}
