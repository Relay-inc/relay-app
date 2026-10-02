import { noteOf } from "../../../shared/markdown";
import { panelItem } from "../../../domain/navigation/keys";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDrawer } from "../../../application/navigation/panel";
import { noteKnown } from "../../../application/workspace/vault";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { DetailFrame } from "../../components/DetailFrame";

type Note = { path: string; text: string };

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** A vault note in the right drawer: the frontmatter as small print, the body as markdown. Links in it open the next
 *  note (ui/app handles `data-note`, the frontmatter's [[links]] use it too). */
export function NoteDetail({ panelKey }: { panelKey: string }) {
  const { t } = useT();
  const note = useNavigationStore(s => s.panel.detail[panelKey]) as Note | undefined;
  const err = useNavigationStore(s => s.panel.err);
  // which notes exist changed: the frontmatter's links follow
  useWorkspaceStore(s => s.notesVersion);
  const item = panelItem(panelKey);

  const match = note ? FRONTMATTER.exec(note.text) : null;
  const properties = match ? match[1] : "";
  return (
    <DetailFrame
      closeLabel={t("pr.close")}
      onClose={closeDrawer}
      bar={
        <span className="text-secondary overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
          {note?.path ?? (item?.kind === "note" ? item.target : "")}
        </span>
      }
      err={err}
      loading={note ? undefined : t("pr.loading")}
    >
      {note ? (
        <>
          {properties ? (
            // no whitespace inside: the frontmatter is pre-wrap. Its [[links]] are clickable, the rest as written
            <div className="text-secondary mb-3 font-mono text-xs whitespace-pre-wrap">
              {properties.split(/(\[\[[^\]\n]+\]\])/).map((part, i) => {
                const link = /^\[\[([^\]\n]+)\]\]$/.exec(part);
                if (!link) return part;
                const target = noteOf(link[1]);
                const label = link[1].split("|").pop()!.trim();
                return noteKnown(target) ? (
                  <a key={i} className="vlink" href="#" data-note={target}>
                    {label}
                  </a>
                ) : (
                  label
                );
              })}
            </div>
          ) : null}
          <Markdown className="md-panel [&_p+p]:mt-2" text={note.text.slice(match ? match[0].length : 0)} />
        </>
      ) : null}
    </DetailFrame>
  );
}
