import { triggersOf, type CloudRef, type Trigger } from "../../domain/cloudbuild/rules";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { settings } from "../settings/settings";

// Cloud Build in the main window: a vault project's linked GCP project (settings.cloudbuild) shows a button in its title
// bar, its dot the worst status of the triggers, its menu each trigger with its last build. Read-only: every call is a
// GET the backend allowlists (packages/integration-cloudbuild), with gcloud's login.

type CloudState = {
  builds: Record<string, { list: Trigger[] | null; err: string; at: number }>; // per vault project
};
export const useCloudStore = makeStore<CloudState>(() => ({ builds: {} }));
const set = useCloudStore.setState;

/** The GCP project linked to a vault project, while Cloud Build is switched on. */
export const cloudOf = (project: string): CloudRef | null => {
  const s = settings();
  return s.integrations?.cloudbuild?.on === true ? (s.cloudbuild?.[project] ?? null) : null;
};

// ponytail: refreshed when the title bar shows or the menu opens, at most once a minute; no background polling
const FRESH = 60_000;
/** The project's triggers and their last builds, unless they arrived less than a minute ago. One call: the last 50
 *  builds, so a trigger with none among them is not listed. */
export async function loadBuilds(project: string, force = false) {
  const ref = cloudOf(project);
  const had = useCloudStore.getState().builds[project];
  if (!ref || (!force && had && Date.now() - had.at < FRESH)) return;
  set(draft => {
    draft.builds[project] = { list: had?.list ?? null, err: "", at: Date.now() };
  });
  try {
    const path = `/v1/projects/${ref.project}/locations/${ref.location}/builds?pageSize=50`;
    const list = triggersOf(await backend.integrationCall("cloudbuild", "GET", path, null));
    set(draft => {
      draft.builds[project] = { list, err: "", at: Date.now() };
    });
  } catch (error) {
    set(draft => {
      draft.builds[project] = { list: had?.list ?? null, err: String(error), at: Date.now() };
    });
  }
}
/** A build's log in the browser; only the Google Cloud console (domain/cloudbuild keeps the rest out). */
export const openBuild = (url: string) => url && backend.openUrl(url);
