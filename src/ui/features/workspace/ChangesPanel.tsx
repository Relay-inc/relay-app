import { useState } from "react";
import {
  applyMerge,
  keepChange,
  setChangesOpen,
  undoChange,
  useChangesStore,
  type Pending,
} from "../../../application/navigation/changes";
import { counts, diffOf, isOpen, type Change, type ChangeFile } from "../../../domain/workspace/changes";
import { clockTime } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { agoOf } from "./ago";

const NONE: Change[] = [];
const stem = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/, "");
const base = (path: string) => path.split("/").pop() ?? path;

/** The Changes feed beside a page (K6): what Relay's Claude runs wrote to the workspace, one entry per run, the open
 *  ones first (the newest unfolded, with a diff per note and Keep / Undo), the rest under Reviewed. */
export function ChangesPanel({ folder }: { folder: string }) {
  const { t } = useT();
  const changes = useChangesStore(s => s.by[folder]) ?? NONE;
  const open = changes.filter(isOpen);
  const reviewed = changes.filter(c => !isOpen(c));
  // the entry unfolded: the one picked, else the newest open one
  const [picked, setPicked] = useState<string | null>(null);
  const unfolded = open.find(c => c.id === picked)?.id ?? open[0]?.id;
  return (
    <aside
      aria-label={t("changes.title")}
      className="absolute top-12 right-0 bottom-0 w-145 z-5 flex flex-col bg-bg border-l border-separator shadow-lg"
    >
      <div className="h-13 flex-none flex items-center gap-2.5 pl-4.5 pr-3.5 border-b border-separator">
        <span className="text-[15px] font-semibold">{t("changes.title")}</span>
        <span className="flex-1 min-w-0 truncate text-secondary">{t("changes.sub")}</span>
        <button
          className="size-6.5 grid place-items-center rounded-md text-secondary hover:bg-fill"
          aria-label={t("changes.close")}
          onClick={() => setChangesOpen(false)}
        >
          <Icon name="close" className="glyph size-3" />
        </button>
      </div>
      <div className="flex-none flex items-center gap-2 px-4.5 py-2 text-xs text-secondary bg-well border-b border-separator">
        <Icon name="alert" className="glyph size-3.25 flex-none" />
        {t("changes.hint")}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-2">
        {!changes.length ? <p className="p-3 text-secondary">{t("changes.none")}</p> : null}
        {open.map(c =>
          c.id === unfolded ? (
            <Unfolded key={c.id} folder={folder} change={c} />
          ) : (
            <button
              key={c.id}
              className="text-left rounded-xl border border-separator-strong hover:bg-fill"
              onClick={() => setPicked(c.id)}
            >
              <Head change={c} />
            </button>
          ),
        )}
        {reviewed.length ? (
          <div className="flex items-center gap-2.5 pt-3.5 pb-1.5 px-1 text-[11px] font-semibold tracking-wider uppercase text-secondary">
            {t("changes.reviewed")}
            <span className="flex-1 h-px bg-separator" />
          </div>
        ) : null}
        {reviewed.map(c => (
          <Done key={c.id} change={c} />
        ))}
      </div>
    </aside>
  );
}

/** What an entry is: its source and subject, as the feed words it. */
function useLabel() {
  const { t } = useT();
  return (c: Change) => {
    if (c.source === "capture")
      return c.subject ? t("changes.capture", { subject: c.subject }) : t("changes.captureUntitled");
    if (c.source === "inbox") return t("changes.inbox");
    if (c.source === "prep") return t("changes.prep", { subject: c.subject });
    if (c.source === "wrap-up") return t("changes.wrapup", { subject: c.subject });
    return t("changes.page", {
      action: t(`page.action.${c.source.replace("action:", "")}` as "page.action.link"),
      subject: c.subject,
    });
  };
}
function useTime() {
  const { t, locale } = useT();
  return (at: number) => {
    const day = new Date(at).toDateString() === new Date().toDateString();
    return day ? clockTime(new Date(at).toISOString(), locale) : agoOf(at, t);
  };
}

/** The top of an entry: its icon, label and time, the run's reason line and the notes it touched as chips. */
function Head({ change }: { change: Change }) {
  const label = useLabel()(change);
  const time = useTime()(change.at);
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3">
      <span className="size-6.5 flex-none grid place-items-center rounded-md bg-accent-soft text-accent-text">
        <Icon name="wand" className="glyph size-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate font-semibold">{label}</span>
          <span className="flex-none text-xs text-secondary">{time}</span>
        </div>
        {change.reason ? <div className="mt-0.5">{change.reason}</div> : null}
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {/* an Inbox filing holds each note twice, where it was and where it went: the chips name the second */}
          {change.files
            .filter(f => change.source !== "inbox" || f.after !== null)
            .map(f => (
              <span
                key={f.path}
                title={f.path}
                className="h-5 inline-flex items-center px-1.75 rounded-md bg-fill-2 text-xs"
              >
                {stem(f.path)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

function Unfolded({ folder, change }: { folder: string; change: Change }) {
  const { t, tn } = useT();
  const merging = useChangesStore(s => s.merging);
  const open = change.files.filter(f => f.state === "open");
  return (
    <section className="rounded-xl border border-separator-strong overflow-hidden">
      <Head change={change} />
      {change.files.map(f => (
        <FileDiff key={f.path} folder={folder} id={change.id} file={f} pending={merging[`${change.id}\n${f.path}`]} />
      ))}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-separator">
        <span className="flex-1 text-xs text-secondary">{tn("changes.notes", change.files.length)}</span>
        <button
          className="h-7 px-3 rounded-lg border border-separator-strong font-medium hover:bg-fill disabled:opacity-50"
          disabled={!open.length}
          onClick={async () => {
            for (const f of open) await undoChange(folder, change.id, f.path);
          }}
        >
          {t("changes.undoAll")}
        </button>
        <button
          className="h-7 px-3 rounded-lg bg-accent text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50"
          disabled={!open.length}
          onClick={() => void keepChange(folder, change.id)}
        >
          {t("changes.keepAll")}
        </button>
      </div>
    </section>
  );
}

function FileDiff({ folder, id, file, pending }: { folder: string; id: string; file: ChangeFile; pending?: Pending }) {
  const { t } = useT();
  const lines = diffOf(file.before, file.after);
  const { add, del } = counts(lines);
  return (
    <div data-file={file.path} className="border-t border-separator">
      <div className="flex items-center gap-2 h-8.5 px-3.5 bg-well">
        <span title={file.path} className="font-mono text-[11.5px] font-semibold truncate">
          {base(file.path)}
        </span>
        {file.before === null ? <span className="text-xs text-secondary">{t("changes.newNote")}</span> : null}
        {file.after === null ? <span className="text-xs text-secondary">{t("changes.removed")}</span> : null}
        <span className="flex-none text-xs text-add-fg">+{add}</span>
        <span className="flex-none text-xs text-del-fg">−{del}</span>
        <span className="flex-1" />
        {file.state === "open" ? (
          <>
            <button
              className="h-6 px-2.25 rounded-md border border-separator-strong text-xs font-medium hover:bg-fill"
              onClick={() => void keepChange(folder, id, file.path)}
            >
              {t("changes.keep")}
            </button>
            <button
              className="h-6 px-2.25 rounded-md text-xs text-secondary hover:bg-fill"
              onClick={() => void undoChange(folder, id, file.path)}
            >
              {t("changes.undo")}
            </button>
          </>
        ) : (
          <span className="text-xs text-secondary">{t(file.state === "kept" ? "changes.kept" : "changes.undone")}</span>
        )}
      </div>
      {pending ? <Merge folder={folder} id={id} path={file.path} pending={pending} /> : <Lines lines={lines} />}
    </div>
  );
}

/** The note was edited after the run: what Undo would make of it, to apply, or Keep mine. */
function Merge({ folder, id, path, pending }: { folder: string; id: string; path: string; pending: Pending }) {
  const { t } = useT();
  const { merge, merged } = pending;
  return (
    <div className="px-3.5 py-2.5 flex flex-col gap-2">
      <p className="text-xs text-secondary">{merged === null ? t("changes.mergeClash") : t("changes.mergeHint")}</p>
      {merged !== null ? <Lines lines={diffOf(merge.current, merged)} /> : null}
      <div className="flex gap-2 justify-end">
        <button
          className="h-6 px-2.25 rounded-md border border-separator-strong text-xs font-medium hover:bg-fill"
          onClick={() => void keepChange(folder, id, path)}
        >
          {t("changes.mergeKeep")}
        </button>
        {merged !== null ? (
          <button
            className="h-6 px-2.25 rounded-md border border-separator-strong text-xs font-medium hover:bg-fill"
            onClick={() => void applyMerge(folder, id, path)}
          >
            {t("changes.mergeApply")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Lines({ lines }: { lines: ReturnType<typeof diffOf> }) {
  return (
    <div className="font-mono text-xs leading-5 pt-1 pb-1.5">
      {lines.map((l, i) => (
        <div
          key={i}
          className={`flex px-3.5 ${l.sign === "+" ? "bg-add-bg text-add-fg" : l.sign === "-" ? "bg-del-bg text-del-fg" : "text-secondary"}`}
        >
          <span className="w-4 flex-none">{l.sign === "-" ? "−" : l.sign === " " ? "" : l.sign}</span>
          <span className="whitespace-pre-wrap break-words min-w-0">{l.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

/** A reviewed entry: one dim line. */
function Done({ change }: { change: Change }) {
  const { t } = useT();
  const label = useLabel()(change);
  const time = useTime()(change.at);
  const undone = change.files.every(f => f.state === "undone");
  return (
    <div className="flex items-center gap-2.5 h-8 px-3.5 opacity-60 text-[12.5px]">
      <Icon name="check" className="glyph size-3 flex-none" />
      <span className="font-semibold flex-none">{t(undone ? "changes.undone" : "changes.kept")}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="flex-none text-secondary">{time}</span>
    </div>
  );
}
