import type { Artifact } from "../../domain/agents/types";
import { type ArtifactView, firstView, fromLink } from "../../domain/artifacts/rules";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { showDrawer } from "../navigation/navigation";
import { useNavigationStore } from "../navigation/store";
import { useConversationsStore } from "../conversations/store";
import { artifactsIn } from "../../domain/artifacts/rules";

// The Artifact drawer: a page Claude Code published to claude.ai, from its local file in a sandboxed frame
// (artifact.rs) or live on claude.ai in a native webview (design.rs).

/** Per conversation, the Artifact its drawer shows and how: each conversation keeps its own while another is open. */
export const useArtifactStore = makeStore(() => ({
  shown: {} as Record<string, { open: Artifact; view: ArtifactView }>,
}));
const set = useArtifactStore.setState;
const selected = () => useNavigationStore.getState().selected;
/** The Artifact the open conversation's drawer shows, and how. */
export function useShownArtifact() {
  const key = useNavigationStore(s => s.selected);
  return useArtifactStore(s => s.shown[key]);
}

/** Open an Artifact in the open conversation's drawer, in the view that shows it best (its file, or live when it has
 *  none or comes from a type). The same Artifact again keeps the view the person picked. */
export function openArtifact(artifact: Artifact) {
  const key = selected();
  set(draft => {
    const was = draft.shown[key];
    draft.shown[key] = { open: artifact, view: was?.open.url === artifact.url ? was.view : firstView(artifact) };
  });
  showDrawer("artifact");
}
/** A claude.ai artifact link from a message: the conversation's own record of it when it has one. */
export const openArtifactLink = (url: string, known: Artifact[]) =>
  openArtifact(known.find(artifact => sameArtifact(artifact.url, url)) ?? fromLink(url));
const sameArtifact = (a: string, b: string) => a.replace(/[?#].*$|\/$/g, "") === b.replace(/[?#].*$|\/$/g, "");

export const setArtifactView = (view: ArtifactView) =>
  set(draft => {
    const shown = draft.shown[selected()];
    if (shown) shown.view = view;
  });

export const artifactSrc = backend.artifactSrc;
/** The live page in the native claude.ai webview over the drawer's body; `hide` takes it away. */
export const liveShow = backend.designShow;
export const liveBounds = backend.designBounds;
export const liveHide = () => backend.designHide().catch(() => {});
export { openExternal as openInBrowser } from "../navigation/navigation";

/** Claude opened a page for the user (the Artifact tool's `open`, a publish with `auto_open`), which Claude Code does
 *  only in its own UI: the drawer shows it, when that conversation is the one in view (an agent elsewhere does not
 *  take over the window; its card in the conversation keeps the page). */
export function showArtifact(key: string, url: string) {
  if (useNavigationStore.getState().selected !== key) return;
  openArtifactLink(url, artifactsIn(useConversationsStore.getState().messages[key]));
}
