import { useEffect } from "react";
import type { Tone } from "../../../domain/buddy/rules";
import { buildsOf, markBuildsSeen, readBuilds } from "../../../application/builds/builds";
import { openInBuddy, useBuddyStore } from "../../../application/buddy/buddy";
import { openBuild, useCloudStore } from "../../../application/cloudbuild/cloudbuild";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { BUDDY_MARK } from "../buddy/mark";
import { CLOUDBUILD_MARK } from "../buddy/cloudmark";

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", fail: "text-late", busy: "text-soon", none: "text-tertiary" };
const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";

/** The project's Buddy pipelines and Cloud Build triggers in one list, each with its last run; a row opens it in the
 *  browser. Opening the tab counts as having seen the failed ones (the title bar stops calling for them). */
export function BuildsPanel({ project }: { project: string }) {
  const { t } = useT();
  const builds = useDerived(() => buildsOf(project));
  const errs = [useBuddyStore(s => s.pipes[project]?.err), useCloudStore(s => s.builds[project]?.err)].filter(Boolean);
  const buddyLoaded = useBuddyStore(s => !!s.pipes[project]?.list);
  const cloudLoaded = useCloudStore(s => !!s.builds[project]?.list);
  const loaded = buddyLoaded || cloudLoaded;
  useEffect(() => {
    void readBuilds(project, true);
  }, [project]);
  useEffect(() => markBuildsSeen(project), [project, builds]);

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto -mx-1 px-1">
      {errs.map(err => (
        <div key={err} className="px-2 py-1.5 text-xs text-late">
          {err}
        </div>
      ))}
      {!loaded && !errs.length && <div className="px-2 py-1.5 text-xs text-secondary">{t("pr.loading")}</div>}
      {loaded && !builds.length && <div className="px-2 py-1.5 text-xs text-secondary">{t("builds.empty")}</div>}
      {builds.map(build => {
        const buddy = build.source === "buddy";
        const meta = [when(build.at), build.branch, build.by].filter(Boolean).join(" · ");
        return (
          <button
            key={build.key}
            type="button"
            className="flex items-start gap-2.5 w-full text-left px-2 py-2 rounded-lg cursor-default hover:bg-fill-2"
            title={t(buddy ? `bd.tone.${build.tone}` : `cb.tone.${build.tone}`)}
            onClick={() => (buddy ? openInBuddy(build.url) : openBuild(build.url))}
          >
            <span className={`mt-1 size-2.5 flex-none grid place-items-center ${TONE_TEXT[build.tone]}`}>
              {build.tone === "busy" ? (
                <span className="size-2.5 rounded-full border-2 border-current border-r-transparent animate-spin"></span>
              ) : (
                <span className="size-2 rounded-full bg-current"></span>
              )}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="truncate text-[13px]">{build.name || t("cb.manual")}</span>
              <span className="flex items-center gap-1.5 text-xs text-secondary">
                <Glyph svg={buddy ? BUDDY_MARK : CLOUDBUILD_MARK} className="size-3 flex-none" viewBox="0 0 24 24" />
                <span className="truncate">{meta}</span>
              </span>
            </span>
            <Icon name="out" className="glyph mt-0.5 size-3.5 flex-none text-tertiary" />
          </button>
        );
      })}
    </div>
  );
}
