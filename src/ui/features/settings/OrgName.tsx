import { useState } from "react";
import type { TeamServer } from "../../../domain/settings/types";
import { orgDisplayName } from "../../../domain/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { setTeamName } from "../../../application/settings/teams";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, FIELD } from "./blocks";

/** The organisation's name as the page's title. An organisation admin edits it in place: every Mac shows the new one
 *  with its next look at the server. Empty takes the name away, the host shows. */
export function OrgName({ team }: { team: TeamServer }) {
  const { t } = useT();
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const [typed, setTyped] = useState<string | null>(null);
  if (typed === null)
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-xl font-semibold text-s-fg">{orgDisplayName(team)}</h1>
        {team.admin ? (
          <button
            className={buttonClass("ghost")}
            title={t("srv.nameEditTip")}
            onClick={() => setTyped(team.name ?? "")}
          >
            <Icon name="edit" className={BUTTON_GLYPH} />
            {t(team.name ? "srv.edit" : "srv.nameAdd")}
          </button>
        ) : null}
      </div>
    );
  const save = async () => {
    if (await setTeamName(team.fp, typed)) setTyped(null);
  };
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        className={`${FIELD} w-72 text-[15px] font-semibold`}
        aria-label={t("srv.name")}
        placeholder={team.host}
        maxLength={60}
        autoFocus
        value={typed}
        onChange={e => setTyped(e.target.value)}
        onKeyDown={e => e.key === "Escape" && setTyped(null)}
      />
      <button type="submit" className={buttonClass("primary")} disabled={busy}>
        {t("srv.save")}
      </button>
      <button type="button" className={buttonClass("ghost")} onClick={() => setTyped(null)}>
        {t("mc.cancel")}
      </button>
      <span className="basis-full text-xs text-s-muted">{t("srv.nameHelp")}</span>
    </form>
  );
}
