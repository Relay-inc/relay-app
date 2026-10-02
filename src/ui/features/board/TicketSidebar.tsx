import type { CardView } from "../../../domain/board/types";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { Avatar } from "../../components/Avatar";
import { Ring } from "./Ring";
import { TicketField } from "./TicketField";
import { TicketPicker } from "./TicketPicker";
import { due } from "./format";

/** The ticket window's sidebar: status, task list, assignee (one, or Trello's members as checkboxes), due day, labels
 *  and project, then "Start conversation" and "Copy link". */
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
  const { assignee, assignees } = view;
  // everyone who can be a member, the current members first among them when the board's list lacks one
  const members = assignees ? [...new Map([...(view.people || []), ...assignees].map(p => [p.id, p])).values()] : [];
  return (
    <aside className="border-l border-separator bg-sidebar px-4 py-5 flex flex-col gap-0.5 overflow-y-auto">
      {view.status && (
        <TicketField label={t("kb.fStatus")}>
          <TicketPicker
            current={view.status.id}
            choices={view.statuses}
            label={t("kb.fStatus")}
            onPick={id => onAct("status", id)}
          >
            <Ring state={view.status.state} />
            {view.status.name}
          </TicketPicker>
        </TicketField>
      )}
      {view.list && (
        <TicketField label={t("kb.fList")}>
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            <Icon name="folder" className="glyph size-3.5 text-secondary" />
            {view.list}
          </span>
        </TicketField>
      )}
      {!assignees && (view.people || assignee) && (
        <TicketField label={t("kb.fWho")}>
          <TicketPicker
            current={assignee?.id ?? ""}
            choices={view.people}
            none={t("kb.unassigned")}
            label={t("kb.fWho")}
            onPick={id => onAct("assignee", id)}
          >
            {assignee ? (
              <>
                <Avatar name={assignee.name.split(" ")[0]} />
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
      {day && (
        <TicketField label={t("kb.fDue")}>
          <span className={`inline-flex items-center gap-1.5 text-[13px] ${day.tone}`}>
            <Icon name="cal" className="glyph size-3.5" />
            {day.long}
          </span>
        </TicketField>
      )}
      {!!view.labels.length && (
        <TicketField label={t("kb.fLabels")}>
          <div className="flex flex-wrap gap-1.5">
            {view.labels.map(name => (
              <span key={name} className="h-5.5 px-2 rounded-md bg-fill-2 text-xs inline-flex items-center">
                {name}
              </span>
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
