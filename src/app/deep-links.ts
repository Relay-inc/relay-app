import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { quickSend } from "../domain/chats/actions";
import { openProject, toggleQuickAsk } from "../domain/navigation";
import { vault } from "../domain/vault";
import { config } from "../domain/config";
import { searchProjects } from "../domain/project-search";

/** relay://ask opens Cmd-K, relay://ask?q=… asks the quick question, relay://open?q=… opens the best matching project. */
export function handleLink(link: string) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  const query = url.searchParams.get("q")?.trim() || "";
  if (url.host === "ask") {
    if (query) quickSend(query, []);
    else toggleQuickAsk(true);
  } else if (url.host === "open") {
    const projects = vault.snap.projects.map(project => ({
      ...project,
      label: config.value.projects[project.name]?.label,
    }));
    const [best] = searchProjects(projects, query, 1);
    if (best) openProject(best.name);
    else toggleQuickAsk(true);
  }
}

// the link that launched the app arrives before anything listens: pick it up once the app has booted
export async function listenToLinks() {
  (await getCurrent())?.forEach(handleLink);
  onOpenUrl(urls => urls.forEach(handleLink));
}
