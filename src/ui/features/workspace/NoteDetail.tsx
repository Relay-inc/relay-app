import { noteOf } from "../../../shared/markdown";
import { panelItem } from "../../../domain/navigation/keys";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDrawer } from "../../../application/navigation/panel";
import { noteKnown } from "../../../application/workspace/vault";
import { noteProperties } from "../../../domain/workspace/rules";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { DetailFrame } from "../../components/DetailFrame";

type Note = { path: string; text: string };

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** A vault note in the right drawer: the frontmatter as a table of properties, the body as markdown. Links in it open the next
 *  note (ui/app handles `data-note`, the frontmatter's [[links]] use it too). */
export function NoteDetail({ panelKey }: { panelKey: string }) {
  const { t } = useT();
  const note = useNavigationStore(s => s.panel.detail[panelKey]) as Note | undefined;
  const err = useNavigationStore(s => s.panel.err);
  // which notes exist changed: the frontmatter's links follow
  useWorkspaceStore(s => s.notesVersion);
  const item = panelItem(panelKey);

  const match = note ? FRONTMATTER.exec(note.text) : null;
  const properties = match ? noteProperties(match[1]) : [];
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
          {properties.length ? (
            // the frontmatter as Obsidian shows it: key and value per row, its [[links]] clickable
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 mb-5 px-3 py-2.5 rounded-lg bg-fill text-xs">
              {properties.map(([key, values]) => (
                <div key={key} className="contents">
                  <dt className="text-tertiary">{key}</dt>
                  <dd className="text-secondary wrap-anywhere">
                    {values.map((value, i) => (
                      <span key={i}>
                        {i ? ", " : null}
                        <PropertyValue value={value} />
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Markdown className="md-note" text={note.text.slice(match ? match[0].length : 0)} />
        </>
      ) : null}
    </DetailFrame>
  );
}

/** A property's value: a [[link]] in it opens the note when it exists, the rest as written. */
function PropertyValue({ value }: { value: string }) {
  return value.split(/(\[\[[^\]\n]+\]\])/).map((part, i) => {
    const link = /^\[\[([^\]\n]+)\]\]$/.exec(part);
    if (!link) return part;
    const target = noteOf(link[1]);
    const label = link[1].split("|").pop()!.trim();
    return noteKnown(target) ? (
      <a key={i} className="vlink text-accent cursor-pointer" href="#" data-note={target}>
        {label}
      </a>
    ) : (
      label
    );
  });
}
