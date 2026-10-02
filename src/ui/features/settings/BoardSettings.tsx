import { useEffect, useState } from "react";
import type { BoardOpt, BoardProvider } from "../../../domain/board/types";
import { matchBoard } from "../../../domain/settings/board-match";
import type { IntegrationConfig } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  boardRows,
  boardSetUp,
  clearBoard,
  formText,
  importBoard,
  loadAllBoards,
  mapBoard,
  saveBoardForm,
  setBoardField,
  type BoardLink,
  type BoardRow,
} from "../../../application/settings/integrations";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import {
  BUTTON_GLYPH,
  buttonClass,
  ERROR_MESSAGE,
  FIELD,
  FOOTER_IN_ROW,
  HINT_IN_ROW,
  OPTIONAL_TEXT,
  SELECT,
  STATUS_TEXT,
  withoutColon,
} from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";
import { SettingsMenu } from "./SettingsMenu";
import { Switch } from "./Switch";

type ProviderField = BoardProvider["settings"]["fields"][number];
const NO_CONFIG: IntegrationConfig = {};

// the boards under their workspace, so a picked board shows its own name
const boardOptions = (list: BoardOpt[]) =>
  list.map(board => ({ id: `${board.project}/${board.id}`, name: board.name, group: board.group }));

/** A board provider's sections on its page in Integrations: the connection (token, the fields of its config), its
 *  boards per vault project. What is typed stays in the store until Save, so it survives going back to the list. */
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
  const rows = useDerived(() => boardRows(provider));
  // the row that adds a link: what is picked so far
  const [addProject, setAddProject] = useState("");
  const [addBoard, setAddBoard] = useState("");
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

  const link = (links: BoardLink[]) => mapBoard(provider, links);

  // a linked vault project: its board, to change, and unlink
  const linkedRow = (row: BoardRow, list: BoardOpt[]) => {
    const vaultProject = row.vaultProject;
    const current = list.find(board => board.id === row.board);
    return (
      <Field key={vaultProject} label={vaultProject}>
        <Select
          className={SELECT}
          aria-label={vaultProject}
          options={boardOptions(list)}
          value={current ? `${current.project}/${current.id}` : ""}
          onChange={value => link([{ vaultProject, value }])}
        />
        <button
          className={buttonClass("ghost", true)}
          title={t("int.unlink")}
          aria-label={t("int.unlink")}
          onClick={() => link([{ vaultProject, value: "" }])}
        >
          <Icon name="close" className={BUTTON_GLYPH} />
        </button>
      </Field>
    );
  };

  // vault projects without a board whose name matches one: linked with one click, or all at once
  const suggestions = (free: BoardRow[], list: BoardOpt[]) => {
    const matches = free
      .map(row => ({ row, board: matchBoard(row.vaultProject, list) }))
      .filter((match): match is { row: BoardRow; board: BoardOpt } => !!match.board);
    if (!matches.length) return null;
    const links = matches.map(({ row, board }) => ({
      vaultProject: row.vaultProject,
      value: `${board.project}/${board.id}`,
    }));
    return (
      <div className="grid grid-cols-1 gap-1.5 border-t border-s-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <b className="text-xs font-semibold">{t("int.suggested")}</b>
          {links.length > 1 && (
            <button className={buttonClass("ghost")} onClick={() => link(links)}>
              {t("int.linkAll")}
            </button>
          )}
        </div>
        {matches.map(({ row, board }, i) => (
          <div key={row.vaultProject} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {row.vaultProject}{" "}
              <span className="text-s-faint">
                → {board.name} · {board.group}
              </span>
              {row.other && (
                <>
                  {" "}
                  <span className={OPTIONAL_TEXT}>({t("int.nowOn", { name: row.other })})</span>
                </>
              )}
            </span>
            <button className={buttonClass()} onClick={() => link([links[i]])}>
              {t("int.link")}
            </button>
          </div>
        ))}
      </div>
    );
  };

  // one more: a vault project and a board, then Link
  const addRow = (free: BoardRow[], list: BoardOpt[]) => {
    if (!free.length) return null;
    const options = boardOptions(list);
    const project = free.some(row => row.vaultProject === addProject) ? addProject : "";
    const board = options.some(option => option.id === addBoard) ? addBoard : "";
    const add = () => {
      link([{ vaultProject: project, value: board }]);
      setAddProject("");
      setAddBoard("");
    };
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-s-border pt-3">
        <Select
          className={`${SELECT} w-44!`}
          aria-label={t("int.pickProject")}
          empty={t("int.pickProject")}
          options={free.map(row => ({
            id: row.vaultProject,
            name: row.other ? `${row.vaultProject} (${row.other})` : row.vaultProject,
          }))}
          value={project}
          onChange={setAddProject}
        />
        <span className="text-s-faint">→</span>
        <Select
          className={`${SELECT} min-w-0 flex-1`}
          aria-label={t("int.pickBoard")}
          empty={t("int.pickBoard")}
          options={options}
          value={board}
          onChange={setAddBoard}
        />
        <button className={buttonClass()} disabled={!project || !board} onClick={add}>
          {t("int.link")}
        </button>
      </div>
    );
  };

  // which board a vault project opens: the linked ones, suggestions by name, and a row to add one
  const boardLinks = () => {
    if (!wantBoards || !boards) return null;
    let body;
    if (!boards.list) body = <div className={HINT_IN_ROW}>{t("pr.loading")}</div>;
    else if (boards.err) body = <span className={ERROR_MESSAGE}>{boards.err}</span>;
    else {
      const list = boards.list;
      const linked = rows.filter(row => row.board);
      const free = rows.filter(row => !row.board);
      body = (
        <>
          {linked.length ? (
            linked.map(row => linkedRow(row, list))
          ) : (
            <div className={HINT_IN_ROW}>{t("int.noLinks")}</div>
          )}
          {suggestions(free, list)}
          {addRow(free, list)}
        </>
      );
    }
    return (
      <Section title={t("int.boards")} desc={<Html html={th("int.boardsHelp")} />}>
        {body}
      </Section>
    );
  };

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
      </Section>
      {boardLinks()}
    </>
  );
}
