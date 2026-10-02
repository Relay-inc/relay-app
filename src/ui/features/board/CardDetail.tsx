import { Fragment, useState, type DragEvent } from "react";
import type { CardDetail as CardDetailModel } from "../../../domain/board/types";
import { cardAct, cardOf, closeDetail } from "../../../application/navigation/panel";
import { useNavigationStore } from "../../../application/navigation/store";
import { DetailFrame } from "../../components/DetailFrame";
import { hasFiles } from "../../components/image-files";
import { Note } from "../../components/Note";
import { useT } from "../../hooks/useT";
import { CardFiles } from "./CardFiles";
import { CardSection } from "./CardSection";
import { Select } from "../../components/Select";
import "../../styles/board.css";

const META = "flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums";

// the provider writes its strings and dates in the language of the moment: `_lang` draws them again on a switch
const viewOf = (detail: CardDetailModel, data: unknown, _lang: string) => (data ? detail.view(data) : null);
const labelsOf = (detail: CardDetailModel, _lang: string) => detail.labels();

/** A tracker card in the right panel, drawn from its provider's view of it: fields (status and assignee as pickers),
 *  files, description and feed. The panel is inert while an action runs, and files dropped on the card are attached. */
export function CardDetail({ panelKey }: { panelKey: string }) {
  const { lang } = useT();
  const data = useNavigationStore(s => s.panel.detail[panelKey]);
  const err = useNavigationStore(s => s.panel.err);
  const acting = useNavigationStore(s => s.panel.acting);
  const actErr = useNavigationStore(s => s.panel.actErr);
  const [comment, setComment] = useState("");
  const card = cardOf(panelKey);
  if (!card) return null;
  const labels = labelsOf(card.detail, lang);
  const view = viewOf(card.detail, data, lang);
  const act = (action: string, value: string, files: File[] = []) => cardAct(panelKey, action, { value, files });
  const canAttach = !!view?.actions.includes("attach");

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    act("attach", "", [...e.dataTransfer.files]);
  };
  const sendComment = async () => {
    if (await act("comment", comment)) setComment("");
  };

  const body = () => {
    if (!view) return null;
    return (
      <div
        onDragOver={canAttach ? e => hasFiles(e) && e.preventDefault() : undefined}
        onDrop={canAttach ? onDrop : undefined}
      >
        <div className={META}>
          {view.meta.map((text, i) => (
            <span key={i}>{text}</span>
          ))}
        </div>
        <h2 className="text-sm font-semibold mb-2 leading-snug">
          {view.closed && (
            <span className="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5">
              {labels.closed}
            </span>
          )}
          {view.title}
        </h2>
        <div className={META}>
          {view.byline.map((text, i) => (
            <span key={i}>{text}</span>
          ))}
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 mt-3 text-sm items-center">
          {view.fields.map(({ label, value, pick }) => (
            <Fragment key={label}>
              <dt className="text-secondary">{label}</dt>
              <dd className="wrap-anywhere">
                {pick ? (
                  <Select
                    className="field w-full"
                    options={pick.options}
                    value={pick.current}
                    empty={pick.none}
                    onChange={picked => act(pick.action, picked)}
                  />
                ) : (
                  value
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
        {view.files && (
          <CardSection title={labels.files} count={view.files.length}>
            {view.files.length ? (
              <CardFiles files={view.files} />
            ) : (
              <div className="text-secondary mb-2">{labels.noFiles}</div>
            )}
            {canAttach && (
              <label className="btn inline-flex items-center cursor-pointer">
                {labels.attach}
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
            )}
          </CardSection>
        )}
        <CardSection title={labels.desc}>
          {view.description.trim() ? (
            // the provider's HTML after its clean()
            <div className="md-panel" dangerouslySetInnerHTML={{ __html: view.description }} />
          ) : (
            <Note>{labels.noDesc}</Note>
          )}
        </CardSection>
        <CardSection title={labels.feed} count={view.feed.length}>
          {view.actions.includes("comment") && (
            <div className="flex flex-col gap-1.5 mb-3">
              <textarea
                className="field w-full resize-y py-1.5"
                rows={3}
                placeholder={labels.commentPh}
                value={comment}
                onChange={e => setComment(e.target.value)}
              />
              <button className="btn primary self-end" onClick={sendComment}>
                {labels.comment}
              </button>
            </div>
          )}
          {view.feed.length ? (
            view.feed.map((entry, i) => (
              <div key={i} className="py-2 border-b border-separator">
                <div className="flex items-center gap-2 text-sm mb-1">
                  <b>{entry.who}</b>
                  <span className="ml-auto text-xs text-secondary tabular-nums">{entry.at}</span>
                </div>
                {entry.html ? (
                  <div className="md-panel" dangerouslySetInnerHTML={{ __html: entry.html }} />
                ) : (
                  entry.change && <Note>{entry.change}</Note>
                )}
                {!!entry.files.length && <CardFiles files={entry.files} />}
              </div>
            ))
          ) : (
            <Note>{labels.nothing}</Note>
          )}
        </CardSection>
      </div>
    );
  };

  return (
    <div className={`card-detail ${acting ? "opacity-70" : ""}`} inert={acting}>
      <DetailFrame
        closeLabel={labels.close}
        onClose={closeDetail}
        before={actErr && <div className="err-box mb-3">{actErr}</div>}
        bar={
          view && (
            <>
              <span className="flex-1"></span>
              <a className="btn whitespace-nowrap flex-none inline-flex items-center" href={view.url}>
                {labels.open}
              </a>
            </>
          )
        }
        err={err}
        loading={view ? undefined : labels.loading}
      >
        {body()}
      </DetailFrame>
    </div>
  );
}
