import { projectsOf, refOf } from "../../domain/cloudbuild/rules";
import type { Message } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { useSettingsStore } from "./store";
import { save } from "./window";

// Settings for Cloud Build: gcloud's login on its page in Integrations (nothing is stored, like GitHub's gh), the GCP
// project and location per vault project in Settings › Projects.

const current = () => useSettingsStore.getState().settings;

/** The account gcloud is signed in with, or why not; the status line and the Connect button follow it. */
export async function checkCloudbuild() {
  useSettingsStore.setState(draft => {
    draft.integrations.cloudbuild = { account: "", error: "" };
  });
  try {
    const account = await backend.gcloudStatus();
    useSettingsStore.setState(draft => {
      draft.integrations.cloudbuild.account = account;
    });
  } catch (error) {
    useSettingsStore.setState(draft => {
      draft.integrations.cloudbuild.error = String(error);
    });
  }
}
/** Every project the login can see (a few pages at most), as picker options. */
export async function cloudProjects() {
  const list = [];
  let page = "";
  // ponytail: 5 pages of 200 projects, a login with more should type the project id
  for (let n = 0; n < 5; n++) {
    const answer = (await backend.integrationCall(
      "cloudbuild",
      "GET",
      `/v1/projects?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      null,
    )) as { nextPageToken?: string };
    list.push(...projectsOf(answer));
    page = answer.nextPageToken ?? "";
    if (!page) break;
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
/** The Check button: the account, then the projects it can see. */
export async function testCloudbuild(): Promise<Message> {
  await checkCloudbuild();
  const { account, error } = useSettingsStore.getState().integrations.cloudbuild;
  if (!account) return { text: error, ok: false };
  try {
    const projects = await cloudProjects();
    return { text: t("cb.connected", { account, n: projects.length }), ok: true };
  } catch (error) {
    return { text: String(error), ok: false };
  }
}
/** Link a vault project to a GCP project and location, or unlink it (project ""). */
export function linkCloudbuild(vaultProject: string, project: string, location: string) {
  const cloudbuild = { ...current().cloudbuild };
  const ref = refOf(project, location);
  if (ref) cloudbuild[vaultProject] = ref;
  else delete cloudbuild[vaultProject];
  return save({ ...current(), cloudbuild });
}
