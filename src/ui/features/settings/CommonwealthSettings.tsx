import { useBrainStore } from "../../../application/brain/store";
import { useState } from "react";
import { installCommonwealth, joinTeamBrain } from "../../../application/brain/brain";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, FOOTER_IN_ROW, HINT_IN_ROW, OK_MESSAGE } from "./blocks";
import { Field } from "./Field";
import { StatusLine } from "./StatusLine";

/** Commonwealth's body on its page in Integrations: what was detected, and joining a team brain. */
export function CommonwealthSettings() {
  const { t, th } = useT();
  const status = useBrainStore(s => s.status);
  const installing = useBrainStore(s => s.installing);
  const message = useBrainStore(s => s.installErr);
  const joining = useBrainStore(s => s.joining);
  const joined = useBrainStore(s => s.joined);
  const joinErr = useBrainStore(s => s.joinErr);
  const [remote, setRemote] = useState("");
  const routed = (status?.projects ?? []).filter(row => row.name);
  return (
    <div>
      <p className={HINT_IN_ROW}>{t("cw.help")}</p>
      <Field label={t("cw.plugin")}>
        <StatusLine level={status?.plugin ? "ok" : "off"}>
          {t(status?.plugin ? "cw.installed" : "cw.missing")}
        </StatusLine>
        {status?.plugin ? null : (
          <button className={buttonClass("primary")} disabled={installing} onClick={installCommonwealth}>
            {installing ? t("cw.installing") : t("cw.install")}
          </button>
        )}
      </Field>
      <Field label={t("cw.cli")}>
        {status?.cli ? (
          <StatusLine level="ok">{t("cw.cliFound", { path: status.cli })}</StatusLine>
        ) : (
          <StatusLine level="warn">
            <Html html={th("cw.cliMissing", { hint: status?.hint ?? "" })} />
          </StatusLine>
        )}
      </Field>
      <Field label={t("cw.team")} hint={t("cw.teamHelp")} id="cwremote" className="w-full">
        <input
          className={FIELD}
          id="cwremote"
          value={remote}
          onChange={e => setRemote(e.target.value)}
          placeholder="git@github.com:org/brain.git"
          spellCheck={false}
          autoComplete="off"
        />
      </Field>
      <div className={FOOTER_IN_ROW}>
        {joining ? (
          <span className="spinner"></span>
        ) : joinErr ? (
          <span className={`${ERROR_MESSAGE} whitespace-pre-wrap`}>{joinErr}</span>
        ) : joined ? (
          <span className={`${OK_MESSAGE} whitespace-pre-wrap`}>{joined}</span>
        ) : null}
        <span className="flex-1"></span>
        <button
          className={buttonClass("primary")}
          disabled={joining || !status?.cli || !remote.trim()}
          onClick={() => joinTeamBrain(remote)}
        >
          {joining ? t("cw.joining") : t("cw.join")}
        </button>
      </div>
      <Field label={t("cw.projects")}>
        {routed.length ? (
          <span className="grid justify-items-end gap-0.5 text-xs text-s-muted">
            {routed.map(row => (
              <span key={row.project}>
                {row.project} · {row.name}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-s-faint">{t("cw.noProjects")}</span>
        )}
      </Field>
      {message ? <div className={`${ERROR_MESSAGE} whitespace-pre-wrap`}>{message}</div> : null}
    </div>
  );
}
