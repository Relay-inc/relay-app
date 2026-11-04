import type { Chat } from "../../domain/conversations/types";
import type { LinkedNote } from "../../domain/workspace/linked";
import { noteName } from "../../domain/navigation/pages";
import type { Reminder } from "../../domain/reminders/types";
import { chatsOf } from "../conversations/selectors";
import { useWorkspaceStore } from "../workspace/store";
import { linkedOf } from "./linked";
import { pageContext, pageProject } from "./pages";

/** What a project or a context page shows under its body, "From links": built from what points at it, written nowhere. */
export type Sections = {
  meetings: LinkedNote[];
  documents: LinkedNote[];
  people: LinkedNote[];
  reminders: Reminder[];
  conversations: Chat[];
};

/** The auto sections of a page (a path of the workspace shown); null when it is neither a project's nor a context's
 *  note. A context's reminders and conversations are those of its projects. */
export function autoSections(path: string): Sections | null {
  const project = pageProject(path);
  const context = project ? undefined : pageContext(path);
  if (!project && !context) return null;
  const keys = project ? [project.key] : context!.projects.map(p => p.key);
  const { meetings, documents, people } = project
    ? linkedOf(noteName(project.note), project.folder?.path ?? "")
    : linkedOf(context!.name, context!.folder);
  return {
    meetings,
    documents,
    people,
    reminders: useWorkspaceStore.getState().snap.reminders.filter(r => !!r.project && keys.includes(r.project)),
    conversations: keys.flatMap(key => chatsOf(key)).sort((a, b) => b.at - a.at),
  };
}
