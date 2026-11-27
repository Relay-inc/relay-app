import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeBtw } from "../../../application/conversations/actions";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { Working } from "./Working";

/** The open conversation's `/btw` aside above the composer: each question (muted) with its answer under it, the
 *  working line while it waits. Nothing of it belongs to the conversation; × or Esc drops it. */
export function BtwCard({ className }: { className: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const pairs = useConversationsStore(s => s.btw[selected]);
  if (!pairs?.length) return null;
  return (
    <div className={className}>
      <div className="relative flex flex-col gap-2 max-h-[40vh] overflow-y-auto p-3 pr-9 rounded-lg bg-raised border border-separator">
        <button
          className="absolute top-2 right-2 grid place-items-center size-6 cursor-pointer rounded-sm border-0 bg-transparent text-secondary hover:bg-fill"
          title={t("btw.close")}
          aria-label={t("btw.close")}
          onClick={() => closeBtw(selected)}
        >
          <Icon name="close" className="glyph size-3.5" />
        </button>
        {pairs.map(pair => (
          <div key={pair.id} className="flex flex-col gap-1">
            <div className="text-sm text-secondary">/btw {pair.question}</div>
            {pair.answer === undefined ? (
              <Working />
            ) : (
              <Markdown className={`md-chat text-sm ${pair.error ? "text-secondary" : ""}`} text={pair.answer} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
