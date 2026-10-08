import type { ChangeEvent } from "react";
import type { ProjectIcon as Icon } from "../../../domain/workspace/types";
import { isSite } from "../../../domain/workspace/rules";
import { useSettingsStore } from "../../../application/settings/store";
import {
  iconHint,
  setIconFromFile,
  setIconText,
  setLabel,
  setProjectIcon,
  setRepos,
} from "../../../application/settings/projects-page";
import { Icon as AppIcon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, FIELD, FIELD_CHIP, FIELD_ICON } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { PipelineSettings } from "./PipelineSettings";
import { ProjectIcon } from "./ProjectIcon";

/** One project's settings, in its folded-open row: the name in Relay, its icon on one line (tile, emoji or website,
 *  and small buttons) and its repos as removable chips. */
export function ProjectSettings({ name, icon }: { name: string; icon: Icon | undefined }) {
  const { t } = useT();
  const label = useSettingsStore(s => s.settings.projects[name]?.label ?? "");
  const repos = useSettingsStore(s => s.projectsPage.repos[name]) ?? [];
  const hint = useDerived(() => iconHint(name));
  // one input for an emoji or a website; the buttons for an image, none and guessing again
  const iconText = icon?.icon ?? (icon && isSite(icon.value) ? icon.value : "");

  const onIconFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setIconFromFile(name, file);
  };
  const onNewRepo = (value: string, input: HTMLInputElement) => {
    const repo = value.trim();
    if (!repo) return;
    input.value = "";
    setRepos(name, [...repos, repo]);
  };

  // its parts are rows of the folded-open row's grid, so they get its gap
  return (
    <>
      <Field label={t("pc.name")}>
        <ChangeInput
          className={FIELD}
          value={label}
          placeholder={name}
          spellCheck={false}
          onCommit={value => setLabel(name, value.trim())}
        />
      </Field>
      <Field label={t("pc.icon")} hint={hint}>
        <span className="flex items-center gap-1.5">
          <span className="grid size-7 flex-none place-items-center rounded-md border border-s-border">
            <ProjectIcon icon={icon} where="tile" />
          </span>
          <ChangeInput
            className={FIELD_ICON}
            value={iconText}
            placeholder={t("pc.iconPh")}
            spellCheck={false}
            onCommit={value => setIconText(name, value.trim())}
          />
          <label className={buttonClass("plain", true)} title={t("pi.upload")}>
            <AppIcon name="upload" className={BUTTON_GLYPH} />
            <input type="file" accept="image/*,.ico,.svg" hidden onChange={onIconFile} />
          </label>
          <button
            className={buttonClass("plain", true)}
            onClick={() => setProjectIcon(name, "none")}
            title={t("pi.none")}
          >
            <AppIcon name="none" className={BUTTON_GLYPH} />
          </button>
          <button
            className={buttonClass("plain", true)}
            onClick={() => setProjectIcon(name, "reset")}
            title={t("pi.reset")}
          >
            <AppIcon name="refresh" className={BUTTON_GLYPH} />
          </button>
        </span>
      </Field>
      <Field label={t("pc.repos")} hint={t("pc.reposHelp")}>
        <span className="flex max-w-xs flex-wrap justify-end gap-1.5">
          {repos.map(repo => (
            <span
              key={repo}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-s-border pr-1 pl-2 font-mono text-xs text-s-muted"
            >
              {repo}
              <button
                className="grid size-4 place-items-center rounded-full text-s-subtle hover:bg-s-hover hover:text-s-fg"
                onClick={() =>
                  setRepos(
                    name,
                    repos.filter(x => x !== repo),
                  )
                }
                title={t("ag.remove")}
              >
                ×
              </button>
            </span>
          ))}
          <ChangeInput
            className={FIELD_CHIP}
            value=""
            placeholder="owner/repo"
            spellCheck={false}
            onCommit={onNewRepo}
          />
        </span>
      </Field>
      <PipelineSettings name={name} />
    </>
  );
}
