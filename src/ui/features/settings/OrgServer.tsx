import type { ReactNode } from "react";
import type { TeamServer } from "../../../domain/settings/types";
import { orgServerCommands } from "../../../domain/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { HINT } from "./blocks";
import { CommandBlock } from "./MachineSetup";
import { ServerStatus } from "./OrgOverview";
import { OrgSignOut } from "./OrgSignOut";
import { WhereTag } from "./WhereTag";

const ROW = "grid min-w-0 grid-cols-[8rem_1fr] items-center gap-3 border-t border-s-border py-2 first:border-t-0";
const KEY = "text-xs text-s-muted";

/** Server: what Relay knows (address, this app's version) and what whoever runs the box does there, each block saying
 *  where it happens: update, move, back up, restore. Relay does not update an organisation server and cannot see
 *  whether a backup runs: the page says so and shows the commands. */
export function OrgServer({ team }: { team: TeamServer }) {
  const { t, th } = useT();
  const setup = useSettingsStore(s => s.machinesPage.setup);
  const c = setup ? orgServerCommands(setup.image, setup.version) : null;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <div className="grid min-w-0 gap-5">
        <Block title={t("srv.addressVersion")} where="relay">
          <div className={ROW}>
            <span className={KEY}>{t("srv.address")}</span>
            <span className="text-xs text-s-fg">
              <span className="font-mono">{team.host}</span>
              <span className="text-s-muted"> {t("srv.port", { port: team.port })}</span>
            </span>
          </div>
          <div className={ROW}>
            <span className={KEY}>{t("srv.status")}</span>
            <ServerStatus team={team} />
          </div>
          {setup ? (
            <div className={ROW}>
              <span className={KEY}>{t("srv.thisApp")}</span>
              <span className="text-xs text-s-fg">Relay {setup.version}</span>
            </div>
          ) : null}
          <span className={HINT}>{t("srv.versionHelp")}</span>
        </Block>
        {c ? (
          <Block title={t("srv.update")} where="box">
            <span className={HINT}>{t("srv.updateHelp")}</span>
            <CommandBlock hint={t("srv.updateEnv")} command={c.env} wrap />
            <CommandBlock hint={t("srv.updateThen")} command={c.update} />
            <Html className={HINT} html={th("srv.updateDone")} />
          </Block>
        ) : null}
        <Block title={t("srv.move")} where="box">
          <span className="text-xs text-s-muted">{t("srv.moveHelp", { host: team.host })}</span>
        </Block>
        <Block title={t("srv.keeps")}>
          <div className={ROW}>
            <code className="font-mono text-xs text-s-fg">team.json</code>
            <span className={KEY}>{t("srv.keepsTeam")}</span>
          </div>
          <div className={ROW}>
            <code className="font-mono text-xs text-s-fg">vaults/&lt;id&gt;/</code>
            <span className={KEY}>{t("srv.keepsVaults")}</span>
          </div>
          <div className={ROW}>
            <code className="font-mono text-xs text-s-fg">identity.crt.der</code>
            <span className={KEY}>{t("srv.keepsIdentity")}</span>
          </div>
        </Block>
      </div>
      <div className="grid min-w-0 gap-5">
        {c ? (
          <Block title={t("srv.backup")} where="box">
            <CommandBlock hint={t("srv.backupNow")} command={c.backup} />
            <CommandBlock hint={t("srv.backupNightly")} command={c.cron} wrap />
            <span className="flex items-start gap-2 rounded-lg bg-s-warn/10 px-3 py-2 text-xs text-s-fg">
              <Icon name="alert" className="glyph mt-px size-3.5 flex-none stroke-2 text-s-warn" />
              {t("srv.backupKey", { host: team.host })}
            </span>
            <span className={HINT}>{t("srv.backupUnseen")}</span>
          </Block>
        ) : null}
        {c ? (
          <Block title={t("srv.restore")} where="box">
            <CommandBlock hint={t("srv.restoreHelp")} command={c.restore} />
            <span className="text-xs text-s-muted">
              {t("srv.restoreDns")} <b className="font-medium text-s-fg">{t("srv.restoreNoWayBack")}</b>
            </span>
          </Block>
        ) : null}
        <OrgSignOut team={team} />
      </div>
    </div>
  );
}

function Block({ title, where, children }: { title: string; where?: "relay" | "box"; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-xl border border-s-border bg-raised px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-s-fg">{title}</h2>
        {where ? <WhereTag where={where} /> : null}
      </div>
      {children}
    </section>
  );
}
