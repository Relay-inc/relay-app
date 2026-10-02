import { Fragment, useState } from "react";
import { useConversationsStore } from "../../../application/conversations/store";
import { blockedAgents, label, projectOf, waitCount } from "../../../application/conversations/selectors";
import { backgroundAction } from "../../../application/conversations/actions";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { PendingRequest } from "./PendingRequest";

const ACTIONS = ["hide", "stop", "attach"] as const;
type Action = (typeof ACTIONS)[number];
const LABELS = { hide: "wait.hide", stop: "wait.stop", attach: "bar.openTerminal" } as const;

const heading = (text: string) => <div className="text-sm font-semibold text-secondary -mb-1.5">{text}</div>;

/** The Waiting view: what agents ask, grouped per conversation, and background sessions that are blocked. */
export function WaitingView() {
  const { t, locale } = useT();
  const pendingList = useConversationsStore(s => s.pendingList);
  const count = useDerived(waitCount);
  const blocked = useDerived(blockedAgents);
  // the conversations the cards wait in, by key: their title, and their project in front of it for the heading
  const titles = useDerived(() =>
    Object.fromEntries(
      pendingList.map(request => [
        request.project,
        { label: label(request.project), project: projectOf(request.project) },
      ]),
    ),
  );
  // a failed hide, stop or attach shows its error on the button
  const [errors, setErrors] = useState<Record<string, string>>({});

  const act = async (action: Action, id: string) => {
    const key = action + ":" + id;
    try {
      await backgroundAction(action, id);
    } catch (e) {
      const text = String(e).slice(0, 60);
      setErrors(before => ({ ...before, [key]: text }));
    }
  };
  if (!count) return <div className="text-center text-sm text-secondary">{t("wait.none")}</div>;
  const requestsByChat: Record<string, typeof pendingList> = {};
  for (const request of pendingList) {
    if (!requestsByChat[request.project]) requestsByChat[request.project] = [];
    requestsByChat[request.project].push(request);
  }
  return (
    <div className="flex flex-col gap-3.5">
      {Object.entries(requestsByChat).map(([chatKey, requests]) => (
        <Fragment key={chatKey}>
          {heading(`${titles[chatKey].project ? `${titles[chatKey].project} · ` : ""}${titles[chatKey].label}`)}
          {requests.map(request => (
            <PendingRequest key={request.id} request={request} where={request.project ? titles[chatKey].label : ""} />
          ))}
        </Fragment>
      ))}
      {blocked.map(agent => (
        <Fragment key={agent.id}>
          {heading(agent.name ?? "")}
          <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3">
            <div className="text-sm text-secondary">
              {t("wait.bg", { date: agent.startedAt ? new Date(agent.startedAt).toLocaleDateString(locale) : "" })}
            </div>
            <div className="flex justify-end gap-2">
              {ACTIONS.map(action => (
                <button
                  key={action}
                  className={action === "attach" ? "btn btn-primary" : "btn"}
                  onClick={() => act(action, agent.id)}
                >
                  {errors[action + ":" + agent.id] ?? t(LABELS[action])}
                </button>
              ))}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
