import { useEffect, useState } from "react";
import type { AgentCfg } from "../../../domain/settings/types";
import { accountsOf, MOST_ROOM, removeAccount, renameAccount } from "../../../domain/settings/accounts";
import { accountRoom, addAgentAccount, saveAgentAccounts } from "../../../application/settings/agents-page";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD_CHIP, PILL, SELECT } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { Section } from "./Section";
import { Switch } from "./Switch";

/** The agent's logins as a card of rows: the extra config folders (each with what is left of its plan when the
 *  provider says), which one new conversations use, and whether to move on when one's limits run out. */
export function AgentAccounts({ id, config }: { id: string; config: AgentCfg }) {
  const { t } = useT();
  const now = accountsOf(config);
  const last = now.accounts[now.accounts.length - 1];
  // per account folder, the percent of its plan left; empty while unknown
  const [room, setRoom] = useState<Record<string, number>>({});
  useEffect(() => {
    void accountRoom(id).then(setRoom);
  }, [id]);
  return (
    <Section
      title={t("ag.accounts")}
      desc={
        <>
          {t("ag.accountsHelp")} {last && <code>CLAUDE_CONFIG_DIR={last.dir} claude /login</code>}
        </>
      }
      rows
    >
      {now.accounts.map((account, i) => (
        <div key={account.dir} className="flex items-center gap-3">
          <ChangeInput
            className={FIELD_CHIP}
            aria-label={t("ag.accountName")}
            value={account.name}
            maxLength={40}
            onCommit={(name, input) => {
              const next = renameAccount(now, i, name);
              // a blank name is not saved: the field shows the old one again
              if (next) saveAgentAccounts(id, next);
              else input.value = account.name;
            }}
          />
          <code className="min-w-0 flex-1 truncate text-xs text-s-muted" title={account.dir}>
            {account.dir}
          </code>
          {account.dir in room && <span className={PILL}>{t("ag.accountLeft", { pct: room[account.dir] })}</span>}
          <button
            className={buttonClass("ghost")}
            aria-label={t("ag.accountRemove", { name: account.name })}
            onClick={() => saveAgentAccounts(id, removeAccount(now, i))}
          >
            {t("ag.remove")}
          </button>
        </div>
      ))}
      {now.accounts.length > 0 && (
        <>
          <Field
            label={t("ag.accountActive")}
            id={`agact-${id}`}
            hint={now.active === MOST_ROOM ? t("ag.accountMostRoomHelp") : undefined}
          >
            <Select
              className={SELECT}
              id={`agact-${id}`}
              options={[
                ...[{ name: t("ag.accountOwn"), dir: "" }, ...now.accounts].map(a => ({ id: a.dir, name: a.name })),
                { id: MOST_ROOM, name: t("ag.accountMostRoom") },
              ]}
              value={now.active}
              onChange={active => saveAgentAccounts(id, { ...now, active })}
            />
          </Field>
          <Field label={t("ag.accountAuto")} id={`agauto-${id}`} hint={t("ag.accountAutoHelp")}>
            <Switch id={`agauto-${id}`} on={now.auto} onToggle={auto => saveAgentAccounts(id, { ...now, auto })} />
          </Field>
        </>
      )}
      <div>
        <button className={`${buttonClass("ghost")} -ml-2`} onClick={() => addAgentAccount(id, now)}>
          {t("ag.accountAdd")}
        </button>
      </div>
    </Section>
  );
}
