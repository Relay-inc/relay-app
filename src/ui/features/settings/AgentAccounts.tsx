import type { AgentCfg } from "../../../domain/settings/types";
import { accountsOf, removeAccount, renameAccount } from "../../../domain/settings/accounts";
import { addAgentAccount, saveAgentAccounts } from "../../../application/settings/agents-page";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD_CHIP, SELECT } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { Switch } from "./Switch";

/** The agent's logins: the CLI's own and the extra config folders, which one new conversations use, and whether to
 *  move on when one's limits run out. Rows of the folded-open row's grid, like the rest of AgentSettings. */
export function AgentAccounts({ id, config }: { id: string; config: AgentCfg }) {
  const { t } = useT();
  const now = accountsOf(config);
  const last = now.accounts[now.accounts.length - 1];
  return (
    <>
      <Field
        label={t("ag.accounts")}
        hint={
          <>
            {t("ag.accountsHelp")} {last && <code>CLAUDE_CONFIG_DIR={last.dir} claude /login</code>}
          </>
        }
      >
        <div className="flex flex-col items-end gap-1">
          {now.accounts.map((account, i) => (
            <div key={account.dir} className="flex items-center justify-end gap-2">
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
              <code className="max-w-48 truncate text-xs text-s-muted" title={account.dir}>
                {account.dir}
              </code>
              <button
                className={buttonClass("ghost")}
                aria-label={t("ag.accountRemove", { name: account.name })}
                onClick={() => saveAgentAccounts(id, removeAccount(now, i))}
              >
                {t("ag.remove")}
              </button>
            </div>
          ))}
          <button className={buttonClass("ghost")} onClick={() => addAgentAccount(id, now)}>
            {t("ag.accountAdd")}
          </button>
        </div>
      </Field>
      {now.accounts.length > 0 && (
        <>
          <Field label={t("ag.accountActive")} id={`agact-${id}`}>
            <Select
              className={SELECT}
              id={`agact-${id}`}
              options={[{ name: t("ag.accountOwn"), dir: "" }, ...now.accounts].map(a => ({ id: a.dir, name: a.name }))}
              value={now.active}
              onChange={active => saveAgentAccounts(id, { ...now, active })}
            />
          </Field>
          <Field label={t("ag.accountAuto")} id={`agauto-${id}`} hint={t("ag.accountAutoHelp")}>
            <Switch id={`agauto-${id}`} on={now.auto} onToggle={auto => saveAgentAccounts(id, { ...now, auto })} />
          </Field>
        </>
      )}
    </>
  );
}
