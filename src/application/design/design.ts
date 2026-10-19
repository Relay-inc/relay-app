import * as backend from "../../infrastructure/backend";

// The Design drawer's claude.ai webview (design.rs) and a project's saved link, in the vault's .relay/config.json.
export const designLink = (project: string) => backend.designLink(project).catch(() => "");
export const setDesignLink = backend.setDesignLink;
export const designShow = backend.designShow;
export const designBounds = backend.designBounds;
export const designHide = () => backend.designHide().catch(() => {});
