import { useEffect, useRef, useState } from "react";
import { worst } from "../../../domain/cloudbuild/rules";
import { cloudOf, loadBuilds, openBuild, useCloudStore } from "../../../application/cloudbuild/cloudbuild";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { PopHeading } from "../board/PopHeading";
import { POPOVER, POP_ROW } from "../board/toolbar";
import { TONE_TEXT, when } from "./BuddyButton";
import { CLOUDBUILD_MARK } from "./cloudmark";

/** A project's Cloud Build triggers in its title bar, next to Buddy's button: the dot is the worst status, the menu each
 *  trigger with its last build, a click opens the build's log in the Google Cloud console. Shown only for a vault
 *  project linked to a GCP project (Settings › Projects). */
export function CloudbuildButton({ project }: { project: string }) {
  const { t } = useT();
  const ref = useDerived(() => cloudOf(project));
  const builds = useCloudStore(s => s.builds[project]);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(root, open, () => setOpen(false));
  useEffect(() => {
    if (ref) loadBuilds(project);
  }, [project, ref]);
  if (!ref) return null;

  const list = builds?.list ?? [];
  const tone = worst(list);
  const toggle = () => {
    if (!open) loadBuilds(project, true);
    setOpen(!open);
  };
  return (
    <span ref={root} className="relative flex">
      <button
        className={`btn-icon relative ${open ? "bg-accent-soft text-accent-text!" : ""}`}
        title={t(`cb.tone.${tone}`)}
        aria-label={t(`cb.tone.${tone}`)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Glyph svg={CLOUDBUILD_MARK} className="size-4" viewBox="0 0 24 24" />
        {tone !== "none" && (
          <span className={`absolute right-1 bottom-1 size-1.5 rounded-full bg-current ${TONE_TEXT[tone]}`}></span>
        )}
      </button>
      {open && (
        <div className={`absolute top-full right-0 mt-2 z-30 w-80 p-1 rounded-[10px] ${POPOVER}`} role="menu">
          <PopHeading>{`Cloud Build · ${ref.project}`}</PopHeading>
          {builds?.err && <div className="px-2 py-1.5 text-xs text-late">{builds.err}</div>}
          {!builds?.list && !builds?.err && <div className="px-2 py-1.5 text-xs text-secondary">{t("pr.loading")}</div>}
          {builds?.list && !list.length && <div className="px-2 py-1.5 text-xs text-secondary">{t("cb.empty")}</div>}
          <div className="max-h-80 overflow-y-auto">
            {list.map(trigger => {
              const { run } = trigger;
              const meta = [when(run.finished || run.started), run.branch, run.commit].filter(Boolean).join(" · ");
              return (
                <button
                  key={trigger.id}
                  type="button"
                  role="menuitem"
                  className={`w-full text-left h-auto! py-1.5 ${POP_ROW}`}
                  title={t(`cb.tone.${trigger.tone}`)}
                  onClick={() => {
                    setOpen(false);
                    openBuild(run.url);
                  }}
                >
                  <span className={`size-2 flex-none rounded-full bg-current ${TONE_TEXT[trigger.tone]}`}></span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px]">{trigger.id ? trigger.name : t("cb.manual")}</span>
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
