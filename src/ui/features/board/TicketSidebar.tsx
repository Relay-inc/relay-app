import { useRef, useState } from "react";
import type { CardView } from "../../../domain/board/types";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { Avatar } from "../../components/Avatar";
import { Ring } from "./Ring";
import { TicketField } from "./TicketField";
import { TicketPicker } from "./TicketPicker";
import { due } from "./format";

/** The ticket window's sidebar: status, folder › task list, assignee (one, or Trello's members as checkboxes), due day
 *  (Yesterday, Today, Tomorrow when it is), labels (added and removed here when the provider writes them) and project,
 *  then "Start conversation" and "Copy link". */
export function TicketSidebar({
  view,
  projectName,
  onAct,
  onChat,
}: {
  view: CardView;
  projectName: string;
  onAct: (action: string, value: string) => void;
  onChat: () => void;
}) {
  const { t, locale } = useT();
  const day = due(view.due || null, locale);
  // the label being typed after + Label, null while it is not
  const [label, setLabel] = useState<string | null>(null);
  // Escape drops what was typed: the blur that follows must not add it
  const cancelled = useRef(false);
  const near =
    day && day.left >= -1 && day.left <= 1
      ? t(day.left < 0 ? "kb.yesterday" : day.left ? "kb.tomorrow" : "kb.today")
      : "";
  const addLabel = () => {
    if (label?.trim() && !cancelled.current) onAct("label-add", label.trim());
    cancelled.current = false;
    setLabel(null);
  };
  const { assignee, assignees } = view;
  // everyone who can be a member, the current members first among them when the board's list lacks one
  const members = assignees ? [...new Map([...(view.people || []), ...assignees].map(p => [p.id, p])).values()] : [];
  return (
    <aside className="border-l border-separator bg-sidebar px-4 py-5 flex flex-col gap-0.5 overflow-y-auto">
      {view.status && (
        <TicketField label={t("kb.fStatus")}>
          <TicketPicker
            current={view.status.id}
            currentName={view.status.name}
            choices={view.statuses}
            label={t("kb.fStatus")}
            onPick={id => onAct("status", id)}
          >
            <Ring state={view.status.state} tone={view.status.tone} />
            {view.status.name}
          </TicketPicker>
        </TicketField>
      )}
      {view.list && (
        <TicketField label={t("kb.fList")}>
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            <Icon name="folder" className="glyph size-3.5 text-secondary" />
            {[view.folder, view.list].filter(Boolean).join(" › ")}
          </span>
        </TicketField>
      )}
      {!assignees && (view.people || assignee) && (
        <TicketField label={t("kb.fWho")}>
          <TicketPicker
            current={assignee?.id ?? ""}
            currentName={assignee?.name ?? ""}
            choices={view.people}
            none={t("kb.unassigned")}
            label={t("kb.fWho")}
            onPick={id => onAct("assignee", id)}
          >
            {assignee ? (
              <>
                <Avatar name={assignee.name} />
                {assignee.name}
              </>
            ) : (
              <span className="text-secondary font-normal">{t("kb.unassigned")}</span>
            )}
          </TicketPicker>
        </TicketField>
      )}
      {assignees && (
        <TicketField label={t("kb.fWho")}>
          <div className="flex flex-col gap-1">
            {members.map(person => (
              <label key={person.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={assignees.some(a => a.id === person.id)}
                  onChange={e => onAct(e.target.checked ? "member-add" : "member-remove", person.id)}
                />
                {person.name}
              </label>
            ))}
          </div>
        </TicketField>
      )}
      <TicketField label={t("kb.fDue")}>
        <span className={`inline-flex items-center gap-1.5 text-[13px] ${day?.tone ?? "text-secondary"}`}>
          <Icon name="cal" className="glyph size-3.5" />
          {day ? (near ? `${near}, ${day.dayMonth}` : day.long) : t("kb.noDue")}
        </span>
      </TicketField>
      {(!!view.labels.length || view.editLabels) && (
        <TicketField label={t("kb.fLabels")}>
          <div className="flex flex-wrap gap-1.5">
            {view.labels.map((name, i) => (
              <span
                key={`${i}:${name}`}
                className="group h-5.5 px-2 rounded-md bg-fill-2 text-xs inline-flex items-center gap-1"
              >
                {name}
                {view.editLabels && (
                  <button
                    type="button"
                    className="hidden group-hover:grid size-3.5 -mr-1 place-items-center border-0 rounded-sm bg-transparent text-secondary hover:text-label"
                    title={t("kb.labelRemove", { name })}
                    aria-label={t("kb.labelRemove", { name })}
                    onClick={() => onAct("label-remove", name)}
                  >
                    <Icon name="close" className="glyph size-2.5 stroke-2" />
                  </button>
                )}
              </span>
            ))}
            {view.editLabels &&
              (label === null ? (
                <button
                  type="button"
                  className="h-5.5 px-1.5 rounded-md border border-dashed border-separator-strong bg-transparent text-xs text-tertiary hover:text-label cursor-default"
                  onClick={() => {
                    cancelled.current = false;
                    setLabel("");
                  }}
                >
                  {t("kb.labelAdd")}
                </button>
              ) : (
                <input
                  className="h-5.5 w-24 px-1.5 rounded-md border border-separator-strong bg-raised text-xs text-label outline-none"
                  aria-label={t("kb.fLabels")}
                  autoFocus
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  onBlur={addLabel}
                  onKeyDown={e => {
                    if (e.key === "Enter") addLabel();
                    else if (e.key === "Escape") {
                      // the label, not the ticket window
                      e.preventDefault();
                      e.stopPropagation();
                      cancelled.current = true;
                      setLabel(null);
                    }
                  }}
                />
              ))}
          </div>
        </TicketField>
      )}
      {projectName && (
        <TicketField label={t("kb.fProject")}>
          <span className="flex items-center gap-1.5 text-[13px]">
            <Icon name="folder" className="glyph size-3.5 text-ctx-a" />
            {projectName}
          </span>
        </TicketField>
      )}
      <div className="h-px bg-separator mx-2 my-3"></div>
      <div className="flex flex-col gap-2 px-2">
        <button
          className="btn btn-primary inline-flex items-center justify-center gap-1.5 h-8 rounded-lg"
          onClick={onChat}
        >
          <Icon name="chat" className="glyph size-3.5" />
          {t("kb.startChat")}
        </button>
        {view.url && (
          <button className="btn h-8 rounded-lg" onClick={() => copyText(view.url)}>
            {t("kb.copyLink")}
          </button>
        )}
      </div>
    </aside>
  );
}
