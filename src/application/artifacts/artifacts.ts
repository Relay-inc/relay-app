import type { Artifact } from "../../domain/agents/types";
import { type ArtifactView, firstView, fromLink } from "../../domain/artifacts/rules";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { showDrawer } from "../navigation/navigation";

// The Artifact drawer: a page Claude Code published to claude.ai, from its local file in a sandboxed frame
// (artifact.rs) or live on claude.ai in the native webview the Design drawer uses (design.rs).

/** The Artifact the drawer shows, and how. */
export const useArtifactStore = makeStore(() => ({
  open: null as Artifact | null,
  view: "local" as ArtifactView,
}));
const set = useArtifactStore.setState;

/** Open an Artifact in the drawer, in the view that shows it best (its file, or live when it has none or comes from a
 *  type). The same Artifact again keeps the view the person picked. */
export function openArtifact(artifact: Artifact) {
  set(draft => {
    if (draft.open?.url !== artifact.url) draft.view = firstView(artifact);
    draft.open = artifact;
  });
  showDrawer("artifact");
}
/** A claude.ai artifact link from a message: the conversation's own record of it when it has one. */
export const openArtifactLink = (url: string, known: Artifact[]) =>
  openArtifact(known.find(artifact => sameArtifact(artifact.url, url)) ?? fromLink(url));
const sameArtifact = (a: string, b: string) => a.replace(/[?#].*$|\/$/g, "") === b.replace(/[?#].*$|\/$/g, "");

export const setArtifactView = (view: ArtifactView) =>
  set(draft => {
    draft.view = view;
  });

export const artifactSrc = backend.artifactSrc;
/** The live page in the native claude.ai webview over the drawer's body; `hide` takes it away. */
export const liveShow = backend.designShow;
export const liveBounds = backend.designBounds;
export const liveHide = () => backend.designHide().catch(() => {});
export { openExternal as openInBrowser } from "../navigation/navigation";
