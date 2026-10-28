import { t } from "../../shared/i18n";
import { hasStarted, inWorkspace, vaultChoices } from "../../domain/conversations/rules";
import { push } from "../../domain/conversations/events";
import { rehome } from "../../domain/conversations/migrate";
import * as backend from "../../infrastructure/backend";
import { useConversationsStore } from "../conversations/store";
import { saveChats } from "../conversations/chats";
import { useWorkspaceStore } from "../workspace/store";
import { loadSnapshot, vaultName } from "../workspace/vault";
import { settings } from "../settings/settings";
import { toast } from "./navigation";

export type { MigratePlan } from "../../infrastructure/backend";

// A project moved or copied to another workspace (src-tauri migrate.rs). On a move its Claude Code conversations go
// along with their transcripts; one that cannot (another agent, or mail into a team workspace) becomes a general
// conversation of the workspace it ran in, with a note. A draft follows.

/** The workspace folder a project lives in, as the last snapshot read it. */
export const projectVault = (project: string) => {
  const snap = useWorkspaceStore.getState().snap;
  return snap.projects.find(p => p.name === project)?.vault || snap.vault?.vault || "";
};

/** The workspace a conversation that ran in `vault` shows under (domain `inWorkspace`): its own, or the main one. */
export function shownUnder(vault: string) {
  const s = settings();
  return vaultChoices(s).find(choice => inWorkspace(vault, choice.folder, s))?.folder ?? s.vault;
}

/** The project's started conversations as the backend weighs them: their title, and whether they read mail. */
function startedChats(project: string) {
  const s = useConversationsStore.getState();
  return Object.values(s.chats)
    .filter(chat => chat.project === project && hasStarted(s, chat.key))
    .map(chat => ({ key: chat.key, title: chat.title, mail: !!chat.fromMail }));
}

/** What the dialog shows: what goes, what stays, what is in the way, the target's contexts, on a move which
 *  conversations go along. */
export const migratePreview = (project: string, to: string, mode: "move" | "copy", context = "") =>
  backend.migrateProject(project, to, context, mode, true, startedChats(project));

/** The project's conversations with a turn running: a move waits for them. */
export function runningChats(project: string) {
  const s = useConversationsStore.getState();
  return Object.values(s.chats).filter(chat => chat.project === project && s.status[chat.key] === "busy");
}

/** Moves or copies the project; on a move its conversations as above. An error as text, "" when done. */
export async function migrate(project: string, to: string, mode: "move" | "copy", context: string) {
  if (mode === "move" && runningChats(project).length) return t("mig.running");
  const from = projectVault(project);
  const main = useWorkspaceStore.getState().snap.vault?.vault ?? "";
  let done: backend.MigratePlan;
  try {
    done = await backend.migrateProject(project, to, context, mode, false, startedChats(project));
  } catch (e) {
    return String(e);
  }
  if (mode === "move") {
    const moved = new Set(done.chats.filter(chat => chat.moves).map(chat => chat.key));
    useConversationsStore.setState(draft => {
      const started = (key: string) => hasStarted(draft, key);
      const stayed = rehome(draft.chats, project, done.key, moved, started, from && from !== main ? from : undefined);
      const here = vaultName(shownUnder(from || main));
      for (const key of stayed)
        push(draft, key, { kind: "note", text: t("mig.stayed", { name: vaultName(to), here }) });
      for (const key of moved) push(draft, key, { kind: "note", text: t("mig.came", { name: vaultName(to) }) });
    });
    saveChats();
  }
  await loadSnapshot();
  toast(t(mode === "move" ? "mig.moved" : "mig.copied", { name: vaultName(to) }));
  return "";
}
