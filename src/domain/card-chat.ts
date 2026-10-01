import { t } from "../core/i18n";
import { config } from "./config";
import { project, findProjects } from "./vault";
import { chat, newChat } from "./chats/state";
import { panel, cardOf } from "./panel";
import { select } from "./navigation";

// "Discuss" on a card: a new conversation about it, under the vault project its board is linked to (else the one
// project its title names). Claude reads the card itself; the provider's prompt goes in front of the user's first
// message, like a mail's "Discuss".
export async function cardChat(key: string) {
  const card = cardOf(key),
    detail = panel.detail[key],
    ref = panel.cardRefs[key];
  if (!card?.detail.chat || !detail || !ref) return;
  const { title, prompt } = card.detail.chat(detail, card.id);
  const linked = Object.entries(config.value.boards || {}).find(
    ([, b]) => b.provider === ref.provider && b.project === ref.project && b.board === ref.board,
  )?.[0];
  const hits = findProjects(title);
  const chatKey = newChat(linked && project(linked) ? linked : hits.length === 1 ? hits[0] : null);
  const conversation = chat.chats[chatKey];
  conversation.title = title.slice(0, 48);
  chat.messages[chatKey] = [{ kind: "note", text: t("note.cardStarted", { name: card.provider.name, title }) }]; // also keeps this title
  conversation.mail = prompt; // goes in front of the first message the user sends
  await select(chatKey);
}
