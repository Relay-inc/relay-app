import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { projectOf } from "../conversations/selectors";
import { useNavigationStore } from "../navigation/store";
import { select, showDrawer } from "../navigation/navigation";

// The Design drawer's claude.ai webview (design.rs) and a project's saved link, in the vault's .relay/config.json.
export const designLink = (project: string) => backend.designLink(project).catch(() => "");
export const setDesignLink = backend.setDesignLink;
export const designShow = backend.designShow;
export const designBounds = backend.designBounds;
export const designHide = () => backend.designHide().catch(() => {});

/** `start`: a page a project without a link shows (design_create); `placed`: the projects whose webview sits in the drawer. */
export const useDesignStore = makeStore(() => ({
  start: {} as Record<string, string>,
  placed: {} as Record<string, boolean>,
}));
const set = useDesignStore.setState;
export const designPlaced = (project: string, on: boolean) =>
  set(draft => {
    draft.placed[project] = on;
  });

/** An agent's design tool wants the drawer: open it on the conversation's project and answer design.rs once the
 *  webview is placed, so the tool finds it. */
export async function openForTool({ id, key, start }: { id: number; key: string; start: string | null }) {
  const project = projectOf(key);
  if (!project) return backend.designOpened(id, "");
  if (useNavigationStore.getState().selected !== key) await select(key);
  if (start) set(draft => void (draft.start[project] = start));
  showDrawer("design");
  await new Promise<void>(resolve => {
    if (useDesignStore.getState().placed[project]) return resolve();
    const off = useDesignStore.subscribe(state => {
      if (state.placed[project]) {
        off();
        resolve();
      }
    });
    setTimeout(() => (off(), resolve()), 20_000); // design.rs gives up then too
  });
  return backend.designOpened(id, project);
}
export const watchDesign = () => backend.onDesignOpen(open => void openForTool(open));
/** A project's new design got its link (design_create); returns the stop function. */
export const onDesignLink = (handler: (link: { project: string; url: string }) => void) => {
  const off = backend.onDesignLink(handler);
  return () => void off.then(stop => stop());
};
