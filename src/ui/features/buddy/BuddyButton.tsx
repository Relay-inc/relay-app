import { useEffect, useRef, useState } from "react";
import { worst, type Tone } from "../../../domain/buddy/rules";
import { buddyOf, loadPipes, loadRuns, openInBuddy, useBuddyStore } from "../../../application/buddy/buddy";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { PopHeading } from "../board/PopHeading";
import { POPOVER, POP_ROW } from "../board/toolbar";

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", fail: "text-late", busy: "text-soon", none: "text-tertiary" };
const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";

/** A project's Buddy pipelines in its title bar: the dot is the worst status, the menu each pipeline with its last
 *  run, a click opens it in Buddy. Shown only for a vault project linked to a Buddy project (Settings › Projects). */
export function BuddyButton({ project }: { project: string }) {
  const { t } = useT();
  const ref = useDerived(() => buddyOf(project));
  const pipes = useBuddyStore(s => s.pipes[project]);
  const runs = useBuddyStore(s => s.runs);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(root, open, () => setOpen(false));
  useEffect(() => {
    if (ref) loadPipes(project);
  }, [project, ref]);
  if (!ref) return null;

  const list = pipes?.list ?? [];
  const tone = worst(list);
  const toggle = () => {
    if (!open) loadPipes(project, true).then(() => loadRuns(project));
    setOpen(!open);
  };
  return (
    <span ref={root} className="relative flex">
      <button
        className={`btn-icon relative ${open ? "bg-accent-soft text-accent-text!" : ""}`}
        title={t(`bd.tone.${tone}`)}
        aria-label={t(`bd.tone.${tone}`)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="workflow" className="glyph size-4" />
        {tone !== "none" && (
          <span className={`absolute right-1 bottom-1 size-1.5 rounded-full bg-current ${TONE_TEXT[tone]}`}></span>
        )}
      </button>
      {open && (
        <div className={`absolute top-full right-0 mt-2 z-30 w-80 p-1 rounded-[10px] ${POPOVER}`} role="menu">
          <PopHeading>{`Buddy · ${ref.project}`}</PopHeading>
          {pipes?.err && <div className="px-2 py-1.5 text-xs text-late">{pipes.err}</div>}
          {!pipes?.list && !pipes?.err && <div className="px-2 py-1.5 text-xs text-secondary">{t("pr.loading")}</div>}
          {pipes?.list && !list.length && <div className="px-2 py-1.5 text-xs text-secondary">{t("bd.empty")}</div>}
          <div className="max-h-80 overflow-y-auto">
            {list.map(pipe => {
              const run = runs[`${project}#${pipe.id}`];
              const meta = run
                ? [when(run.finished || run.started), run.branch, run.by].filter(Boolean).join(" · ")
                : "";
              return (
                <button
                  key={pipe.id}
                  type="button"
                  role="menuitem"
                  className={`w-full text-left h-auto! py-1.5 ${POP_ROW} ${pipe.disabled ? "opacity-50" : ""}`}
                  title={t(`bd.tone.${pipe.tone}`)}
                  onClick={() => {
                    setOpen(false);
                    openInBuddy(pipe.url);
                  }}
                >
                  <span className={`size-2 flex-none rounded-full bg-current ${TONE_TEXT[pipe.tone]}`}></span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px]">{pipe.name}</span>
                    {meta && <span className="block truncate text-[11px] text-secondary">{meta}</span>}
                  </span>
                  <Icon name="out" className="glyph size-3.5 text-tertiary" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}
