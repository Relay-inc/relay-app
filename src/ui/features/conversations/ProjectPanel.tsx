import { useEffect, useRef, useState } from "react";
import { isImg } from "../../../shared/icons";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { iconFrom } from "../../../application/workspace/icons";
import { settings } from "../../../application/settings/settings";
import { selectedProject } from "../../../application/conversations/selectors";
import { saveProjectPanel } from "../../../application/conversations/actions";
import { closeProjectPanel } from "../../../application/navigation/navigation";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ProjectImg } from "../../components/ProjectImg";

// a long project name in the select or the inputs never pushes past the panel
const fieldLabel = "grid grid-cols-1 gap-1.5 text-sm text-secondary select-none";

/** Which project this conversation belongs to, and the project's icon and name. Opens under the title; a second
 *  container, it saves on its own. */
export function ProjectPanel() {
  const { t } = useT();
  const current = useDerived(selectedProject);
  const projects = useWorkspaceStore(s => s.snap.projects);
  // what is chosen in the open panel, starting from what is set: the project, an image or an emoji (an image replaces
  // the emoji and the other way round), the label
  const [start] = useState(() => {
    const icon = current ? useWorkspaceStore.getState().icons[current] : undefined;
    const img = icon?.img ?? undefined;
    return {
      img,
      emoji: img || !current ? "" : icon?.icon || "",
      label: current ? settings().projects[current]?.label || "" : "",
    };
  });
  const [projectName, setProjectName] = useState(current);
  const [img, setImg] = useState(start.img);
  const [emoji, setEmoji] = useState(start.emoji);
  const [label, setLabel] = useState(start.label);
  const [err, setErr] = useState("");
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => select.current?.focus(), []);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await iconFrom(file);
    if (!dataUrl) {
      setErr(t("img.unreadable"));
      return;
    }
    setImg(dataUrl);
    setEmoji("");
  };
  const save = async () => {
    const edited = current ? { img, emoji: emoji.trim(), label: label.trim() } : undefined;
    setErr(await saveProjectPanel(projectName, edited));
  };

  const names = projects.map(x => x.name).sort((a, b) => a.localeCompare(b));
  return (
    <div className="absolute z-5 top-14 right-4 w-[340px] grid grid-cols-1 gap-3 bg-bg border border-separator rounded-lg shadow-lg p-3.5">
      {err ? <div className="err-box">{err}</div> : null}
      <label className={fieldLabel}>
        {t("pop.project")}
        <select
          ref={select}
          className="field"
          value={projectName ?? ""}
          onChange={e => setProjectName(e.target.value || null)}
        >
          <option value="">{t("general")}</option>
          {names.map(name => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      {/* the sidebar entry of the project: its image or emoji, and its label */}
      {current ? (
        <div className={fieldLabel}>
          {t("pop.sidebar", { name: current })}
          <div className="flex gap-2 items-center">
            <label className="btn inline-flex items-center flex-none" title={t("pop.imgPick")}>
              {isImg(img) ? (
                <ProjectImg url={img} className="w-4 h-4 flex-none object-contain rounded-xs" />
              ) : (
                t("pop.img")
              )}
              <input type="file" accept="image/*,.ico,.svg" hidden onChange={e => pickFile(e.target.files?.[0])} />
            </label>
            <input
              className="field w-16 text-center placeholder:text-secondary"
              maxLength={4}
              placeholder="Emoji"
              value={emoji}
              onChange={e => {
                setEmoji(e.target.value);
                setImg(undefined);
              }}
            />
            <input
              className="field flex-1 min-w-0 placeholder:text-secondary"
              placeholder={current}
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </div>
        </div>
      ) : null}
      <div>
        <button className="btn" onClick={closeProjectPanel}>
          {t("pop.cancel")}
        </button>
        <button className="btn btn-primary" onClick={save}>
          {t("pop.save")}
        </button>
      </div>
    </div>
  );
}
