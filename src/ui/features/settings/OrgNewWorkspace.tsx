import type { TeamServer } from "../../../domain/settings/types";
import { orgDisplayName } from "../../../domain/settings/servers";
import { createSharedVault, editForm, openForm, pickSharedFolder } from "../../../application/settings/shared-vaults";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT } from "./blocks";
import { PathField } from "./PathField";
import { TrustBadge } from "./TrustBadge";

const LABEL = "pt-1.5 text-[13px] font-medium text-s-fg";

/** New workspace on an organisation, open in the page: a name, with or without history (chosen here, for good, and
 *  said so next to Create), and the folder on this Mac it syncs into. Whoever makes it is its admin. */
export function OrgNewWorkspace({ team }: { team: TeamServer }) {
  const { t } = useT();
  const form = useSettingsStore(s => s.shared.form);
  const message = useSettingsStore(s => s.shared.messages.form);
  const busy = useSettingsStore(s => !!s.shared.busy.form);
  const name = orgDisplayName(team);
  const choice = (none: boolean, title: string, help: string) => (
    <label
      className={`flex cursor-default items-start gap-2.5 rounded-xl border p-3 ${form.noHistory === none ? "border-s-primary ring-1 ring-s-primary" : "border-s-border"}`}
    >
      <input
        type="radio"
        name="history"
        className="mt-0.5"
        checked={form.noHistory === none}
        onChange={() => editForm({ noHistory: none })}
      />
      <span className="grid gap-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-s-fg">
          {none ? <Icon name="bookmark" className="glyph size-3.5 stroke-2" /> : null}
          {title}
        </span>
        <span className="text-xs text-s-muted">{help}</span>
      </span>
    </label>
  );
  return (
    <section className="grid gap-4 rounded-xl border border-s-border bg-raised px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-s-fg">{t("srv.newOn", { name })}</h2>
        <span className="text-xs text-s-muted">{t("srv.youBecomeAdmin")}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <label htmlFor="org-ws-name" className={LABEL}>
          {t("set.sharedName")}
        </label>
        <input
          id="org-ws-name"
          className={`${FIELD} w-80`}
          placeholder={t("set.sharedNamePlaceholder")}
          value={form.name}
          onChange={e => editForm({ name: e.target.value })}
        />
        <span className={LABEL}>{t("srv.history")}</span>
        <div className="grid gap-2.5">
          <div className="grid gap-2.5 md:grid-cols-2">
            {choice(false, t("srv.keepHistory"), t("srv.keepHistoryHelp"))}
            {choice(true, t("set.sharedNoHistoryLabel"), t("srv.noHistoryHelp"))}
          </div>
          <span className="flex items-start gap-2 rounded-lg bg-s-warn/10 px-3 py-2 text-xs text-s-fg">
            <Icon name="lock" className="glyph mt-px size-3.5 flex-none stroke-2 text-s-warn" />
            {t("srv.historyOnce")}
          </span>
        </div>
        <span className={LABEL}>{t("set.sharedFolder")}</span>
        <div className="grid gap-1">
          <PathField
            value={form.folder}
            tip={form.folder}
            readOnly
            placeholder={t("vault.none")}
            pickTip={t("vault.pickPath")}
            onPick={pickSharedFolder}
          />
          <span className={HINT}>{t("set.sharedNewFolderHelp")}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex flex-1 items-center gap-2 text-xs text-s-muted">
          <TrustBadge kind="org" name={name} />
          {t("srv.syncsRightAway")}
        </span>
        {message && !message.ok ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
        <button className={buttonClass("ghost")} onClick={() => openForm("")}>
          {t("mc.cancel")}
        </button>
        <button
          className={buttonClass("primary")}
          disabled={busy || !form.name.trim() || !form.folder}
          onClick={() => void createSharedVault()}
        >
          {t("srv.createWorkspace")}
        </button>
      </div>
    </section>
  );
}
