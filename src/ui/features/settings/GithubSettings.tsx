import { useSettingsStore } from "../../../application/settings/store";
import { checkGithub, saveGithub, setGithubOwners } from "../../../application/settings/integrations";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, HINT_IN_ROW, withoutColon } from "./blocks";
import { Field } from "./Field";
import { RemoveFooter } from "./RemoveFooter";

/** GitHub's body on its page in Integrations: the owners to show PRs of. No token of our own, the app uses gh's login.
 *  The owners as typed stay in the store until Save. */
export function GithubSettings({ onRemove }: { onRemove: () => void }) {
  const { t, th } = useT();
  const owners = useSettingsStore(s => s.integrations.github.owners ?? s.settings.github.owners);
  const message = useSettingsStore(s => s.integrations.github.message);
  return (
    <div>
      <Html as="p" className={HINT_IN_ROW} html={th("gh.help")} />
      <Field label={withoutColon(t("gh.owners"))} id="ghowners">
        <input
          className={FIELD}
          id="ghowners"
          value={owners}
          onChange={e => setGithubOwners(e.target.value)}
          spellCheck={false}
          placeholder={t("gh.ownersPh")}
        />
      </Field>
      <RemoveFooter onRemove={onRemove} message={message}>
        <button className={buttonClass()} onClick={checkGithub}>
          {t("gh.recheck")}
        </button>
        <button className={buttonClass("primary")} onClick={saveGithub}>
          {t("set.save")}
        </button>
      </RemoveFooter>
    </div>
  );
}
