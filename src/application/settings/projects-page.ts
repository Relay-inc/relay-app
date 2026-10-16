import { t } from "../../shared/i18n";
import { isSite } from "../../domain/workspace/rules";
import type { IconKind } from "../../domain/workspace/types";
import * as backend from "../../infrastructure/backend";
import { iconFrom, loadIcons, setIcon } from "../workspace/icons";
import { save } from "./window";
import { useSettingsStore } from "./store";

// Settings › Projects: every project, a row folds open to its configuration. The name in Relay stays in the app's
// settings; the icon and the repos live in the vault's .relay/config.json.
const st = () => useSettingsStore.getState();
type Page = ReturnType<typeof st>["projectsPage"];
const page = (patch: Partial<Page>) =>
  useSettingsStore.setState(draft => {
    Object.assign(draft.projectsPage, patch);
  });
// an empty text clears the message
const said = (text: string, ok: boolean) => page({ message: text ? { text, ok } : null });

/** Icons, projects and repos, read when the page first shows and again when the backend says the icons changed. */
async function loadProjectsPage() {
  const [icons, snapshot, repos] = await Promise.all([
    loadIcons(),
    backend.snapshot().catch(() => ({ projects: [] })),
    backend.projectRepos().catch(() => ({})),
  ]);
  const projects = snapshot.projects || [];
  page({
    icons,
    repos,
    projects: projects.map(({ name, context, summary }) => ({ name, context, summary })),
    names: projects.map(project => String(project.name)).sort((a, b) => a.localeCompare(b)),
  });
}
/** Called when the page shows: loads once, then follows icons-changed. */
export function showProjectsPage() {
  if (st().projectsPage.loading) return;
  page({ loading: true });
  loadProjectsPage();
  backend.onIconsChanged(() => {
    if (st().projectsPage.icons) loadProjectsPage();
  });
}

/** What the icon is now, under the icon line. */
export function iconHint(project: string) {
  const icon = st().projectsPage.icons?.[project];
  if (!icon) return t("pi.guess");
  if (isSite(icon.value) && icon.img) return `${t("pi.site")} ${icon.value}`;
  if (icon.img) return t("pi.image");
  if (icon.icon) return t("pi.emoji");
  if (!isSite(icon.value)) return t("pi.noIcon");
  const faviconTried = st().settings.favicons?.tried?.[project] === icon.value;
  return faviconTried ? t("pi.siteNoIcon", { site: icon.value }) : t("pi.siteSoon", { site: icon.value });
}
export async function setRepos(project: string, repos: string[]) {
  try {
    await backend.setProjectRepos(project, repos);
    said("", true);
    page({ repos: await backend.projectRepos() });
  } catch (error) {
    said(String(error), false);
  }
}
/** Find icons: Claude looks up the website of every project without an icon (or set to none), its favicon follows. */
export async function findIcons() {
  const { icons, projects } = st().projectsPage;
  const targets = projects.filter(project => {
    const icon = icons?.[project.name];
    return !icon || icon.value === "";
  });
  if (!targets.length) return said(t("pi.findNone"), true);
  page({ finding: true, message: null });
  try {
    const sites = await backend.findIconSites(
      targets.map(project => ({ name: project.name, context: project.context ?? "", summary: project.summary ?? "" })),
    );
    for (const [name, site] of Object.entries(sites)) await setIcon(name, "site", site);
    const found = Object.keys(sites).length;
    said(found ? t("pi.found", { n: found, total: targets.length }) : t("pi.findNone"), true);
  } catch (error) {
    said(String(error), false);
  }
  page({ finding: false });
}
/** The backend emits icons-changed, which reloads the page. */
export async function setProjectIcon(project: string, kind: IconKind, value = "") {
  try {
    await setIcon(project, kind, value);
    said("", true);
  } catch (error) {
    said(String(error), false);
  }
}
export async function setIconFromFile(project: string, file: File) {
  const dataUrl = await iconFrom(file);
  if (dataUrl) return setProjectIcon(project, "img", dataUrl);
  said(t("img.unreadable"), false);
}
/** What the single icon input does with what was typed: nothing is reset, a website is a site, else an emoji. */
export const setIconText = (project: string, text: string) =>
  setProjectIcon(project, !text ? "reset" : isSite(text) ? "site" : "emoji", text);
/** The project's name in Relay; empty goes back to the note name. */
export function setLabel(project: string, label: string) {
  const next = structuredClone(st().settings);
  if (label) next.projects[project] = { ...next.projects[project], label };
  else delete next.projects[project];
  return save(next);
}
