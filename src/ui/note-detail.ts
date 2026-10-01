import { html, nothing } from "lit";
import { t } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { md } from "../lib/md";
import { S } from "../app/state";
import { closePr, openPr } from "../app/actions";
import { noteOf, noteKnown, noteKey } from "../app/notes";
import css from "./note-detail.css?inline";

// the frontmatter's [[links]] clickable, the rest as written
const frontmatter = (fm: string) => fm.split(/(\[\[[^\]\n]+\]\])/).map(part => {
  const m = /^\[\[([^\]\n]+)\]\]$/.exec(part);
  if (!m) return part;
  const target = noteOf(m[1]), label = m[1].split("|").pop()!.trim();
  return noteKnown(target) ? html`<a class="vlink" @click=${() => openPr(noteKey(target))}>${label}</a>` : label;
});

/** A vault note in the right panel: the frontmatter as small print, the body as markdown. Links in it open the next note. */
export class RelayNoteDetail extends RelayElement {
  static styles = styles(css);
  render() {
    const n = S.prDetail[S.prOpen] as { path: string; text: string } | undefined, err = S.prDetailErr;
    const bar = html`<div class="prd-bar"><button class="btn" title=${t("pr.close")} @click=${closePr}>×</button><span class="meta note-path">${n?.path ?? S.prOpen.slice(5)}</span></div>`;
    if (err) return html`${bar}<div class="err">${err}</div>`;
    if (!n) return html`${bar}<div class="meta">${t("pr.loading")}</div>`;
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(n.text), fm = m ? m[1] : "";
    return html`${bar}${fm ? html`<div class="meta note-fm">${frontmatter(fm)}</div>` : nothing}<div class="stand note-body">${md(n.text.slice(m ? m[0].length : 0))}</div>`;
  }
}
customElements.define("relay-note-detail", RelayNoteDetail);
