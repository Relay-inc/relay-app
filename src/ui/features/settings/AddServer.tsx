import { useState, type ReactNode } from "react";
import type { AddKind } from "../../../application/settings/store";
import { chooseAdd } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, HINT } from "./blocks";
import { AddJoin } from "./AddJoin";
import { AddOrg } from "./AddOrg";
import { AddOwn } from "./AddOwn";
import { Steps } from "./Steps";
import { TrustBadge } from "./TrustBadge";

const TH = "px-3 py-2 text-left text-xs font-normal text-s-muted";
const TD = "border-t border-s-border px-3 py-3 align-top";

/** Add a server: first what it is for (fixed when it is set up), then the steps for that. `setup`: the organisation
 *  server being set up on this Mac. */
export function AddServer({ setup }: { setup: boolean }) {
  const kind = useSettingsStore(s => s.serversPage.add);
  return (
    <div className="mx-auto grid max-w-240 min-w-0 gap-6 px-8 pt-6 pb-10">
      {setup ? <AddOrg /> : kind === "own" ? <AddOwn /> : kind === "join" ? <AddJoin /> : <Choose />}
    </div>
  );
}

/** Step 1: a machine of your own, a server for an organisation, or one someone else runs, side by side: what you get,
 *  who can read it, who sets it up. */
function Choose() {
  const { t } = useT();
  const kind = useSettingsStore(s => s.serversPage.add);
  const [picked, setPicked] = useState<AddKind>(kind || "own");
  const row = (id: AddKind, title: string, about: string, gets: ReactNode, reads: ReactNode, setup: string) => (
    <tr
      className={`cursor-default ${picked === id ? "bg-s-sel/40" : "hover:bg-s-hover"}`}
      onClick={() => setPicked(id)}
    >
      <td className={TD}>
        <label className="flex items-start gap-2.5">
          <input
            type="radio"
            name="add-kind"
            className="mt-0.5"
            checked={picked === id}
            onChange={() => setPicked(id)}
          />
          <span className="grid gap-1">
            <span className="text-[13px] font-medium text-s-fg">{title}</span>
            <span className="text-xs text-s-muted">{about}</span>
          </span>
        </label>
      </td>
      <td className={`${TD} text-xs text-s-fg`}>{gets}</td>
      <td className={`${TD} text-xs`}>{reads}</td>
      <td className={`${TD} text-xs text-s-muted`}>{setup}</td>
    </tr>
  );
  const list = (keys: string[]) => (
    <ul className="grid list-disc gap-0.5 pl-4">
      {keys.map(k => (
        <li key={k}>{k}</li>
      ))}
    </ul>
  );
  return (
    <>
      <header className="grid gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold text-s-fg">{t("srv.add")}</h1>
          <p className={HINT}>{t("srv.addIntro")}</p>
        </div>
        <Steps steps={[t("srv.stepFor"), t("srv.stepNext")]} at={1} />
      </header>
      <table className="w-full min-w-0 border-collapse overflow-hidden rounded-xl border border-s-border bg-raised">
        <thead>
          <tr>
            <th className={TH}>{t("srv.kind")}</th>
            <th className={TH}>{t("srv.youGet")}</th>
            <th className={TH}>{t("srv.whoCanReadIt")}</th>
            <th className={TH}>{t("srv.setupCol")}</th>
          </tr>
        </thead>
        <tbody>
          {row(
            "own",
            t("srv.ownMachine"),
            t("srv.ownAbout"),
            list([t("srv.ownGet1"), t("srv.ownGet2"), t("srv.ownGet3"), t("srv.ownGet4")]),
            <span className="grid justify-items-start gap-1.5">
              <TrustBadge kind="e2e" />
              <span className="text-s-muted">{t("srv.ownReads")}</span>
            </span>,
            t("srv.ownSetup"),
          )}
          {row(
            "org",
            t("srv.kindOrgServer"),
            t("srv.orgAbout"),
            <>
              {list([t("srv.orgGet1"), t("srv.orgGet2"), t("srv.orgGet3"), t("srv.orgGet4")])}
              <span className="mt-1.5 block text-s-muted">{t("srv.orgNot")}</span>
            </>,
            <span className="grid justify-items-start gap-1.5">
              <TrustBadge kind="org" name={t("srv.theOrg")} />
              <span className="text-s-muted">{t("srv.orgReads")}</span>
            </span>,
            t("srv.orgSetup"),
          )}
          {row(
            "join",
            t("srv.joinTitle"),
            t("srv.joinAbout"),
            list([t("srv.joinGet1"), t("srv.joinGet2")]),
            <span className="text-s-muted">{t("srv.joinReads")}</span>,
            t("srv.joinSetup"),
          )}
        </tbody>
      </table>
      <p className="flex items-start gap-2.5 rounded-xl border border-s-border bg-s-mutedbg/40 px-3.5 py-3 text-xs text-s-fg">
        <Icon name="lock" className="glyph mt-px size-3.5 flex-none stroke-2 text-s-muted" />
        <span>
          <b className="font-medium">{t("srv.fixedTitle")}</b> {t("srv.fixedHelp")}
        </span>
      </p>
      <p className="text-xs text-s-muted">{t("srv.agentsLogin")}</p>
      <div className="flex justify-end">
        <button className={buttonClass("primary")} onClick={() => chooseAdd(picked)}>
          {t("srv.continue")}
        </button>
      </div>
    </>
  );
}
