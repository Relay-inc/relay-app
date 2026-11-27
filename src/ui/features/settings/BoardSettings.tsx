import type { BoardProvider } from "../../../domain/board/types";
import type { IntegrationConfig } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  boardSetUp,
  clearBoard,
  formText,
  importBoard,
  saveBoardForm,
  setBoardField,
} from "../../../application/settings/integrations";
import { go } from "../../../application/settings/window";
import { Html } from "../../components/Html";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, FOOTER_IN_ROW, HINT_IN_ROW, STATUS_TEXT, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";
import { SettingsMenu } from "./SettingsMenu";
import { Switch } from "./Switch";

type ProviderField = BoardProvider["settings"]["fields"][number];
const NO_CONFIG: IntegrationConfig = {};

/** A board provider's sections on its page in Integrations: the connection (token, the fields of its config), and
 *  where its boards are linked to projects (Settings › Projects, the one place for that). What is typed stays in the
 *  store until Save, so it survives going back to the list. */
export function BoardSettings({ provider }: { provider: BoardProvider }) {
  const { t, pt, pth } = useT();
  const config = useSettingsStore(s => s.settings.integrations[provider.id]) ?? NO_CONFIG;
  const hasToken = useSettingsStore(s => !!s.integrations.tokens[provider.id]);
  const form = useSettingsStore(s => s.integrations.form);
  // can it take its credentials from Claude Code, and does Claude Code have them
  const mcp = useSettingsStore(s => s.integrations.mcp[provider.id]);
  const message = useSettingsStore(s => s.integrations.messages[provider.id]);
  const setUp = useDerived(() => !!boardSetUp(provider));

  const fieldId = (fieldConfig: ProviderField) => `f-${provider.id}-${fieldConfig.key}`;
  const secretInput = (id: string) => (
    <input
      className={FIELD}
      id={id}
      type="password"
      autoComplete="off"
      placeholder={hasToken ? t("int.tokenStored") : t("int.tokenPaste")}
      value={formText(form, id)}
      onChange={e => setBoardField(id, e.target.value)}
      spellCheck={false}
    />
  );
  const providerField = (fieldConfig: ProviderField) => {
    const id = fieldId(fieldConfig);
    if (fieldConfig.check) {
      const label = fieldConfig.placeholder ? pt(provider, fieldConfig.placeholder) : pt(provider, fieldConfig.label);
      return (
        <Field key={id} label={label} id={id}>
          <Switch id={id} on={!!(form[id] ?? config[fieldConfig.key])} onToggle={on => setBoardField(id, on)} />
        </Field>
      );
    }
    const input = fieldConfig.secret ? (
      secretInput(id)
    ) : (
      <input
        className={FIELD}
        id={id}
        inputMode={fieldConfig.numeric ? "numeric" : undefined}
        value={formText(form, id, config[fieldConfig.key])}
        onChange={e => setBoardField(id, e.target.value)}
        placeholder={fieldConfig.placeholder ? pt(provider, fieldConfig.placeholder) : undefined}
        spellCheck={false}
      />
    );
    return (
      <Field key={id} label={withoutColon(pt(provider, fieldConfig.label))} id={id}>
        {input}
      </Field>
    );
  };

  // the button that opens the tracker's token page, when it has one; until then it says what is missing
  const tokenButton = () => {
    const tokenUrl = provider.settings.tokenUrl;
    if (!tokenUrl) return null;
    const secrets = Object.fromEntries(
      provider.settings.fields
        .filter(fieldConfig => fieldConfig.secret)
        .map(fieldConfig => [fieldConfig.key, formText(form, fieldId(fieldConfig)).trim()]),
    );
    const url = tokenUrl(secrets);
    const label = pt(provider, "getToken");
    // a link: the settings window opens https links in the browser
    if (url)
      return (
        <a className={`${buttonClass()} inline-flex items-center no-underline`} href={url}>
          {label}
        </a>
      );
    return (
      <button className={buttonClass()} disabled title={pt(provider, "needKey")}>
        {label}
      </button>
    );
  };

  // the rarer actions behind "…": take the credentials from Claude Code, clear the token
  const more = [
    mcp?.supported
      ? {
          id: "import",
          name: t("int.importClaude"),
          status: <span className={STATUS_TEXT}>{t(mcp.found ? "int.importFound" : "int.importNone")}</span>,
        }
      : null,
    hasToken ? { id: "clear", name: t("int.clear") } : null,
  ].filter(x => x != null);

  // the other secrets first: the token is the one you get with them (Trello: the API key, then its token)
  const tokenId = `tok-${provider.id}`;
  const fields = provider.settings.fields;
  const secrets = fields.filter(fieldConfig => fieldConfig.secret && !fieldConfig.check);
  const rest = fields.filter(fieldConfig => !secrets.includes(fieldConfig));
  return (
    <>
      <Section title={t("int.connection")}>
        {!setUp && mcp?.found && (
          <div className="flex items-center gap-3 rounded-md border border-s-border bg-s-mutedbg/35 px-3 py-2.5 text-xs">
            <span className="flex-1">{t("int.foundClaudeLong", { name: provider.name })}</span>
            <button className={buttonClass("primary")} onClick={() => importBoard(provider)}>
              {t("int.import")}
            </button>
          </div>
        )}
        <Html as="p" className={`${HINT_IN_ROW} [&_a]:underline`} html={pth(provider, provider.settings.help)} />
        {secrets.map(providerField)}
        <Field label={withoutColon(pt(provider, provider.settings.tokenLabel))} id={tokenId}>
          {provider.settings.tokenUrl ? (
            <div className="flex items-center gap-2">
              {secretInput(tokenId)}
              {tokenButton()}
            </div>
          ) : (
            secretInput(tokenId)
          )}
        </Field>
        {rest.map(providerField)}
        <div className={FOOTER_IN_ROW}>
          <Footer message={message}>
            <SettingsMenu
              up
              tip={t("int.more")}
              items={more}
              onPick={id => (id === "import" ? importBoard(provider) : clearBoard(provider))}
            />
            <button className={buttonClass("primary")} onClick={() => saveBoardForm(provider)}>
              {t("int.save")}
            </button>
          </Footer>
        </div>
      </Section>
      <Section
        title={t("int.boards")}
        desc={t("int.boardsInProjects")}
        action={
          <button className={buttonClass()} onClick={() => go("projects")}>
            {t("int.openProjects")}
          </button>
        }
      />
    </>
  );
}
