// A link to one claude.ai Artifact: claude.ai/artifact/{id} or claude.ai/code/artifact/{uuid}, not the gallery
// (/artifacts) and no look-alike host. Markdown marks these so the app opens them in its Artifact drawer.
const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+\/?(?:[?#].*)?$/;
export const isArtifactUrl = (url: string | null | undefined) => !!url && ARTIFACT_URL.test(url);
