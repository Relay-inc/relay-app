import { searchProjects } from "../domain/navigation/project-search";
import { quickSend } from "./conversations/actions";
import { openProject, toggleQuickAsk } from "./navigation/navigation";
import { settings } from "./settings/settings";
import { useWorkspaceStore } from "./workspace/store";

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
    const projects = useWorkspaceStore.getState().snap.projects.map(project => ({
      ...project,
      label: settings().projects[project.name]?.label,
    }));
    const [best] = searchProjects(projects, query, 1);
    if (best) openProject(best.name);
    else toggleQuickAsk(true);
  }
}
