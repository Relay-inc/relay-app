import { useEffect } from "react";
import { clockTime } from "../../../shared/format";
import { acceptAll, fileWithClaude, loadInboxNotes, useInboxStore } from "../../../application/inbox/inbox";
import { keeps, type InboxNote } from "../../../domain/inbox/rules";
import { activeFolder } from "../../../application/navigation/workspaces";
import { bindingLabel } from "../../../domain/settings/shortcuts";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Toast } from "../conversations/Toast";
import { useNavigationStore } from "../../../application/navigation/store";
import { InboxRow } from "./InboxRow";

const NONE: InboxNote[] = [];
// Quick capture's default key (Settings › Shortcuts can change it): the empty state names it
const CAPTURE_KEY = bindingLabel("ctrl+alt+meta+KeyN");

/** The Inbox (K7): the notes dropped in without a place, newest first. File with Claude asks for a home for each and
 *  nothing moves until a row is accepted. */
export function InboxView({ className }: { className: string }) {
  const { t, tn, locale } = useT();
  const folder = useDerived(() => activeFolder());
  const notes = useInboxStore(s => s.notes[folder]) ?? NONE;
  const proposal = useInboxStore(s => s.proposal[folder]);
  const skipped = useInboxStore(s => s.skipped);
  const busy = useInboxStore(s => s.busy);
  const toast = useNavigationStore(s => s.toast);
  useEffect(() => {
    void loadInboxNotes(folder);
  }, [folder]);
  const items = proposal?.items ?? [];
  const sub = proposal
    ? t("inbox.proposed", { time: clockTime(new Date(proposal.at).toISOString(), locale) })
    : t("inbox.unproposed");
  return (
    <div className={`${className} min-h-0 relative`}>
      <div className="h-full overflow-y-auto">
        <article className="w-full max-w-225 mx-auto pt-10 px-8 pb-16 flex flex-col gap-4">
          <header className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight">{t("nav.inbox")}</h1>
              <div className="text-secondary">
                {tn("inbox.notes", notes.length)}
                {notes.length ? ` · ${sub}` : ""}
              </div>
            </div>
            <button
              className="btn px-3 cursor-pointer disabled:opacity-50"
              disabled={busy !== "" || !items.some(item => !keeps(item))}
              onClick={() => void acceptAll()}
            >
              {t("inbox.acceptAll")}
            </button>
            <button
              className={`btn btn-primary px-3 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50`}
              disabled={busy !== "" || !notes.length}
              onClick={() => void fileWithClaude()}
            >
              <Icon name="wand" className="glyph size-3.25" />
              {busy === "propose" ? t("inbox.filing") : t("inbox.fileWith")}
            </button>
          </header>
          {notes.length ? (
            <>
              <div className="border border-separator rounded-xl">
                {notes.map((note, index) => (
                  <InboxRow
                    key={note.path}
                    note={note}
                    item={items.find(item => item.path === note.path)}
                    skipped={skipped.includes(note.path)}
                    last={index === notes.length - 1}
                  />
                ))}
              </div>
              <p className="text-xs text-secondary">{t("inbox.note")}</p>
            </>
          ) : (
            <p className="py-10 text-center text-secondary">{t("inbox.empty", { key: CAPTURE_KEY })}</p>
          )}
        </article>
      </div>
      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toast toast={toast} />
        </div>
      ) : null}
    </div>
  );
}
