import { useEffect, useState } from "react";
import {
  createContext,
  createProject,
  deleteProject,
  projectEntry,
  projectKinds,
  PROJECT_STATES,
  sharedWorkspace,
} from "../../../application/navigation/pages";
import { useT } from "../../hooks/useT";

/** What the dialog does: a new context, a new project in `context` (`then` gets its key), or a project deleted. */
export type ProjectAsk =
  | { kind: "context" }
  | { kind: "project"; context: string; then?: (key: string) => void }
  | { kind: "delete"; key: string };

const FIELD = "w-full px-2 py-1.5 rounded-md border border-separator bg-bg text-label";

/** The small window for a workspace's contexts and projects, in the look of the Pages tab's file dialog: a name (and
 *  for a project its type and state), or a delete confirmed. */
export function ProjectDialog({ ask, onClose }: { ask: ProjectAsk; onClose: () => void }) {
  const { t, tn } = useT();
  const [name, setName] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [kind, setKind] = useState("");
  const [state, setState] = useState<string>(PROJECT_STATES[0]);
  const [busy, setBusy] = useState(false);
  // the types the workspace has templates for, the first picked
  useEffect(() => {
    if (ask.kind !== "project") return;
    let live = true;
    void projectKinds().then(list => {
      if (!live) return;
      setKinds(list);
      setKind(list[0] ?? "Project");
    });
    return () => {
      live = false;
    };
  }, [ask.kind]);
  const project = ask.kind === "delete" ? projectEntry(ask.key) : null;

  const go = async () => {
    if (busy) return;
    setBusy(true);
    if (ask.kind === "context") await createContext(name.trim());
    else if (ask.kind === "project") {
      const key = await createProject(ask.context, name.trim(), kind || "Project", state);
      if (key) ask.then?.(key);
    } else await deleteProject(ask.key);
    onClose();
  };
  const shared = sharedWorkspace();
  const title =
    ask.kind === "context"
      ? t("pages.newContextTitle")
      : ask.kind === "project"
        ? t("pages.newProjectTitle", { context: ask.context })
        : tn("pages.deleteProjectTitle", project?.count ?? 0, { name: project?.label ?? "" });
  const blocked = busy || (ask.kind === "delete" ? !project : !name.trim() || (ask.kind === "project" && !kind));
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-label={title}
        className="w-100 grid gap-3 p-5 bg-bg border border-separator rounded-xl shadow-lg text-sm text-label"
        onSubmit={e => {
          e.preventDefault();
          if (!blocked) void go();
        }}
        onKeyDown={e => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {ask.kind === "delete" ? (
          <p className="text-secondary">
            {t("pages.deleteProjectHere")}{" "}
            {shared ? t("pages.deleteShared", { workspace: shared }) : t("pages.deleteHere")}
          </p>
        ) : (
          <label className="grid gap-1 text-secondary">
            {t("pages.name")}
            <input className={FIELD} value={name} onChange={e => setName(e.target.value)} autoFocus />
          </label>
        )}
        {ask.kind === "project" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-secondary">
              {t("pages.projectType")}
              <select className={FIELD} value={kind} onChange={e => setKind(e.target.value)}>
                {kinds.map(k => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-secondary">
              {t("pages.projectState")}
              <select className={FIELD} value={state} onChange={e => setState(e.target.value)}>
                {PROJECT_STATES.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn cursor-pointer" onClick={onClose}>
            {t("pages.cancel")}
          </button>
          <button
            type="submit"
            className={`btn cursor-pointer disabled:opacity-50 ${ask.kind === "delete" ? "bg-late border-late text-on-accent hover:opacity-90" : "btn-primary"}`}
            disabled={blocked}
            autoFocus={ask.kind === "delete"}
          >
            {t(ask.kind === "delete" ? "pages.doDelete" : "pages.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
