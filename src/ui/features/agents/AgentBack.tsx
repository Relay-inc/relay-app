import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeAgent } from "../../../application/navigation/navigation";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The title bar over an agent's page: back to the conversation that spawned it (Esc does the same). */
export function AgentBack() {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const title = useConversationsStore(s => s.chats[selected]?.title ?? "");
  return (
    <div className="flex-none h-12 flex items-center px-3 border-b border-separator select-none" data-tauri-drag-region>
      <button
        className="inline-flex items-center gap-1.5 h-7.5 pl-1.5 pr-2.5 rounded-lg border-0 bg-transparent text-[13px] font-medium text-secondary cursor-default hover:bg-fill-2 hover:text-label max-w-full"
        onClick={closeAgent}
      >
        <Icon name="left" className="glyph size-3.75 flex-none" />
        <span className="truncate">{title || t("agents.conversation")}</span>
        <span className="px-1 rounded border border-separator-strong font-mono text-[11px] leading-4 text-tertiary">
          esc
        </span>
      </button>
    </div>
  );
}
