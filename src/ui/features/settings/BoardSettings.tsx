import { useEffect } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import type { IntegrationConfig } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  boardLinks,
  boardSetUp,
  clearBoard,
  formText,
  importBoard,
  loadAllBoards,
  mapBoard,
  saveBoardForm,
  setBoardField,
} from "../../../application/settings/integrations";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import {
  buttonClass,
  ERROR_MESSAGE,
  FIELD,
  FOOTER_IN_ROW,
  HINT,
  HINT_IN_ROW,
  SELECT,
  STATUS_TEXT,
  withoutColon,
} from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { SettingsMenu } from "./SettingsMenu";
import { Switch } from "./Switch";

type ProviderField = BoardProvider["settings"]["fields"][number];
const NO_CONFIG: IntegrationConfig = {};

/** A board provider's body in the integrations list: the token, the fields of its config, its boards per vault
 *  project. What is typed stays in the store until Save, so it survives the row folding shut. */
export function BoardSettings({ provider, onRemove }: { provider: BoardProvider; onRemove: () => void }) {
  const { t, th, pt, pth } = useT();
  const config = useSettingsStore(s => s.settings.integrations[provider.id]) ?? NO_CONFIG;
  const hasToken = useSettingsStore(s => !!s.integrations.tokens[provider.id]);
  const form = useSettingsStore(s => s.integrations.form);
  // can it take its credentials from Claude Code, and does Claude Code have them
  const mcp = useSettingsStore(s => s.integrations.mcp[provider.id]);
  const message = useSettingsStore(s => s.integrations.messages[provider.id]);
  const boards = useSettingsStore(s => s.integrations.all[provider.id]);
  const setUp = useDerived(() => !!boardSetUp(provider));
  const rows = useDerived(() => boardLinks(provider));
  // a provider that lists all its boards in one call, once set up, maps them to the vault's projects
  const wantBoards = !!provider.settings.allBoards && setUp;
  useEffect(() => {
    if (wantBoards && !boards) loadAllBoards(provider);
  }, [wantBoards, boards, provider]);

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

  // the provider's boards per vault project
  const boardMapping = () => {
    if (!wantBoards || !boards) return null;
    if (!boards.list) return <div className={HINT_IN_ROW}>{t("pr.loading")}</div>;
    if (boards.err)
      return (
        <div className="flex items-center gap-2">
          <span className={ERROR_MESSAGE}>{boards.err}</span>
        </div>
      );
    const options = boards.list.map(board => ({
      id: `${board.project}/${board.id}`,
      name: `${board.group} › ${board.name}`,
      board: board.id,
    }));
    return (
      <>
        <div className="mt-2 grid gap-0.5 border-t border-s-border pt-3">
          <b className="text-xs font-semibold">{t("int.boards")}</b>
          <Html as="p" className={HINT} html={th("int.boardsHelp")} />
        </div>
        {rows.map(row => (
          <Field key={row.vaultProject} label={row.vaultProject}>
            <Select
              className={SELECT}
              options={options}
              value={options.find(option => option.board === row.board)?.id ?? ""}
              empty={row.noneLabel}
              onChange={value => mapBoard(provider, row.vaultProject, value)}
            />
          </Field>
        ))}
      </>
    );
  };

  // the other secrets first: the token is the one you get with them (Trello: the API key, then its token)
  const tokenId = `tok-${provider.id}`;
  const fields = provider.settings.fields;
  const secrets = fields.filter(fieldConfig => fieldConfig.secret && !fieldConfig.check);
  const rest = fields.filter(fieldConfig => !secrets.includes(fieldConfig));
  // one element: the fold's gap is between bodies, the fields inside sit without one
  return (
    <div>
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
        <button className={buttonClass("ghost")} onClick={onRemove}>
          {t("ag.remove")}
        </button>
        <SettingsMenu
          up
          tip={t("int.more")}
          items={more}
          onPick={id => (id === "import" ? importBoard(provider) : clearBoard(provider))}
        />
        <Footer message={message}>
          <button className={buttonClass("primary")} onClick={() => saveBoardForm(provider)}>
            {t("int.save")}
          </button>
        </Footer>
      </div>
      {boardMapping()}
    </div>
  );
}
