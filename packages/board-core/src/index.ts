// The board contract, nothing specific to one tracker: the shapes a provider works in and the strings bridge.
export type * from "./types";
export * from "./i18n";
/** Text for a URL query, also escaping what encodeURIComponent leaves and the backend's path check refuses (path_ok). */
export const queryText = (q: string) => encodeURIComponent(q).replace(/[!'()*~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
