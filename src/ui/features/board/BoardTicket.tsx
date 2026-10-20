import type { BoardProvider, CardDetail } from "../../../domain/board/types";
import { cardsIn, filtered, refOf, type Board } from "../../../domain/board/rules";
import { buildTicket, pipelineOfBoard, ticketBuildState } from "../../../application/pipeline/runner";
import { useDerived } from "../../hooks/useDerived";
import { picturesOf } from "../../../domain/pipeline/rules";
import { openBoardCard, ticketChat } from "../../../application/board/board";
import { cardAct, cardOf, closeTicket } from "../../../application/navigation/panel";
import { useNavigationStore } from "../../../application/navigation/store";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { ModalHeader } from "../../components/ModalHeader";
import { ModalLink } from "../../components/ModalLink";
import { useT } from "../../hooks/useT";
import { TicketActivity } from "./TicketActivity";
import { TicketFiles } from "./TicketFiles";
import { TicketHeading } from "./TicketHeading";
import { TicketSidebar } from "./TicketSidebar";
import { TicketLinked } from "./TicketLinked";
import { numbered } from "./format";
import "../../styles/board.css";
import { ColumnResize } from "../navigation/ColumnResize";

// the provider writes its strings in the language of the moment: `_lang` draws them again on a switch
const viewOf = (detail: CardDetail, data: unknown, _lang: string) => (data ? detail.view(data) : null);

/** The card open in the ticket window over the board: the main column (title, description, files, activity with the
 *  comment box) and the sidebar with its fields. Previous and next step through the cards the board shows, in
 *  column order, round from the last to the first. The window is inert while an action runs. */
export function BoardTicket({
  provider,
  board,
  step,
  project,
}: {
  provider: BoardProvider;
  board: Board;
  step?: (id: string) => void; // opens another card (Today: with the board that card came from)
  project?: string; // the vault project a conversation goes under, when it is not the board's (Today)
}) {
  const { t, lang } = useT();
  const modal = useNavigationStore(s => s.panel.modal);
  const data = useNavigationStore(s => s.panel.detail[s.panel.modal]);
  const err = useNavigationStore(s => s.panel.err);
  const actErr = useNavigationStore(s => s.panel.actErr);
  const acting = useNavigationStore(s => s.panel.acting);
  const open = modal ? cardOf(modal) : undefined;
  // the board's pipeline, when one runs on it: the sidebar's Build with agent
  const ref = refOf(provider, board);
  const piped = useDerived(() => !!pipelineOfBoard(ref));
  const buildState = useDerived(() => (open ? ticketBuildState(open.id) : "build"));
  if (!open || open.provider.id !== provider.id) return null;
  const view = viewOf(open.detail, data, lang);

  const cards = filtered(board);
  const order = board.columns.flatMap(column => cardsIn(provider, board, cards, column.id));
  const at = order.findIndex(card => card.id === open.id);
  const number = view?.number ?? board.cards.find(card => card.id === open.id)?.number ?? "";
  const projectName = board.projects?.find(p => p.id === board.project)?.name ?? "";
  const where = [projectName, view?.board].filter(Boolean).join(" · ");
  const act = (action: string, value: string, files: File[] = []) => cardAct(modal, action, { value, files });
  const startChat = () =>
    ticketChat(
      provider,
      [`${number} ${view?.title ?? ""}`.trim(), view?.url].filter(Boolean).join("\n"),
      project,
      view ? picturesOf(view) : [],
    );

  const body = () => {
    if (err)
      return (
        <div className="p-8">
          <div className="err-box">{err}</div>
        </div>
      );
    if (!view) return <div className="p-8 text-secondary">{t("kb.loading")}</div>;
    return (
      <div className="ticket relative min-h-0 grid grid-cols-[minmax(0,1fr)_var(--ticketSide-w)] flex-1">
        <ColumnResize column="ticketSide" />
        <div className="overflow-y-auto px-10 pt-7 pb-8 flex flex-col gap-7 select-text cursor-auto">
          {actErr && <div className="err-box">{actErr}</div>}
          <h2 className="m-0 text-xl leading-snug font-semibold tracking-tight text-pretty">
            {view.closed && (
              <span className="text-xs font-normal text-secondary border border-separator rounded-sm px-1 mr-1.5 align-middle">
                {t("kb.closed")}
              </span>
            )}
            {view.title}
          </h2>
          {view.description.trim() ? (
            // the provider's HTML after its clean() or its safe Markdown
            <div
              className="md-panel text-sm leading-relaxed max-w-150"
              dangerouslySetInnerHTML={{ __html: view.description }}
            />
          ) : (
            <div className="text-sm text-tertiary">{t("kb.noDesc")}</div>
          )}
          {view.files && (
            <section className="flex flex-col gap-2">
              <TicketHeading>{t("kb.files")}</TicketHeading>
              {view.files.length ? (
                <TicketFiles provider={provider.id} files={view.files} />
              ) : (
                <div className="text-secondary text-sm">{t("kb.noFiles")}</div>
              )}
              <label className="btn self-start inline-flex items-center cursor-pointer">
                {t("kb.attach")}
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={e => {
                    const input = e.currentTarget;
                    if (input.files?.length) act("attach", "", [...input.files]);
                    input.value = "";
                  }}
                />
              </label>
            </section>
          )}
          <TicketLinked provider={provider} card={modal} number={number} />
          <TicketActivity
            key={modal}
            feed={view.feed}
            providerId={provider.id}
            providerName={provider.name}
            people={view.people}
            onComment={(text, mentions) => cardAct(modal, "comment", { value: text, files: [], mentions })}
          />
        </div>
        <TicketSidebar
          view={view}
          projectName={projectName}
          onAct={act}
          onChat={startChat}
          build={
            piped
              ? { state: buildState, onBuild: () => buildTicket(ref, { id: open.id, title: view.title, number }) }
              : undefined
          }
        />
      </div>
    );
  };

  return (
    <Modal acting={acting} onClose={closeTicket}>
      <ModalHeader
        left={
          <>
            {where && (
              <>
                <span className="inline-flex items-center gap-1.5 text-secondary">
                  <Icon name="board" className="glyph size-3.5" />
                  {where}
                </span>
                <span className="text-tertiary">/</span>
              </>
            )}
            {number && <span className="font-mono text-xs">{numbered(number)}</span>}
          </>
        }
        position={at >= 0 ? t("kb.tasksOf", { n: at + 1, total: order.length }) : ""}
        // previous and next go round: from the last card on to the first
        first={order.length < 2}
        last={order.length < 2}
        onStep={by =>
          order.length &&
          (step ?? (id => openBoardCard(provider, id)))(order[(Math.max(at, 0) + by + order.length) % order.length].id)
        }
        onClose={closeTicket}
        link={view?.url ? <ModalLink href={view.url}>{t("kb.openIn", { name: provider.name })}</ModalLink> : undefined}
      />
      {body()}
    </Modal>
  );
}
