import { useBrainStore } from "../../../application/brain/store";
import { installCommonwealth } from "../../../application/brain/brain";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, HINT_IN_ROW } from "./blocks";
import { Field } from "./Field";
import { StatusLine } from "./StatusLine";

/** Commonwealth's body on its page in Integrations: nothing to configure, only what was detected. */
export function CommonwealthSettings() {
  const { t, th } = useT();
  const status = useBrainStore(s => s.status);
  const installing = useBrainStore(s => s.installing);
  const message = useBrainStore(s => s.installErr);
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
