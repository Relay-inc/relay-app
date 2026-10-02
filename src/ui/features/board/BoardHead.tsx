import type { BoardProvider } from "../../../domain/board/types";
import type { Board } from "../../../domain/board/rules";
import {
  linkBoard,
  linkedProject,
  pickBoard,
  pickProject,
  showBoard,
  vaultProjects,
} from "../../../application/board/board";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Select } from "../../components/Select";

const SELECT = "field max-w-2xs";

/** The board's head row: project and board pickers, the link to a vault project and reload. It wraps when the
 *  column is too narrow, the right-hand group moving to its own line. */
export function BoardHead({ provider, board }: { provider: BoardProvider; board: Board }) {
  const { t } = useT();
  const projects = useDerived(() => vaultProjects());
  // which vault project this board belongs to: a vault project has at most one board
  const linked = useDerived(() => linkedProject(provider));
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3.5">
      <Select
        className={SELECT}
        options={board.projects || []}
        value={board.project}
        empty={board.project ? undefined : board.projects ? t("kb.pickProject") : t("pr.loading")}
        onChange={id => pickProject(provider, id)}
      />
      {board.project && (
        <Select
          className={SELECT}
          options={board.boards}
          value={board.board}
          empty={board.board ? undefined : t("kb.noBoards")}
          onChange={id => pickBoard(provider, id)}
        />
      )}
      <span className="ml-auto flex items-center gap-2">
        {board.board && !!projects.length && (
          <>
            <span className="text-xs text-label opacity-75" title={t("kb.linkHelp")}>
              {t("kb.link")}
            </span>
            <Select
              className={SELECT}
              options={projects.map(([id, name]) => ({ id, name }))}
              value={linked}
              empty={t("kb.linkNone")}
              onChange={project => linkBoard(provider, project)}
            />
          </>
        )}
        {board.busy && <span className="spinner"></span>}
        <button className="btn" onClick={() => showBoard(provider, true)}>
          {t("pr.reload")}
        </button>
      </span>
    </div>
  );
}
