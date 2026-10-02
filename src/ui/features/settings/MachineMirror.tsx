import { useState } from "react";
import type { Machine, MirrorProgress } from "../../../domain/settings/types";
import type { Key } from "../../../shared/i18n";
import { agoParts, conflictPath } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import {
  addMirrorExclude,
  removeMirrorExclude,
  saveMirror,
  wipeMirror,
} from "../../../application/settings/machines-page";
import { relativeFormat } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT_IN_ROW } from "./blocks";
import { StatusLine } from "./StatusLine";
import { Switch } from "./Switch";

const ROOT: Record<MirrorProgress["root"], Key> = {
  context: "mc.mirrorRootContext",
  plugins: "mc.mirrorRootPlugins",
  vault: "mc.mirrorRootVault",
  memory: "mc.mirrorRootMemory",
};

/** "Mirror this Mac" on a machine: the switch with its trade-off confirm, the vault folders that stay here, the last
 *  sync round and removing the copy on the machine. */
export function MachineMirror({ machine }: { machine: Machine }) {
  const { t, tn, locale } = useT();
  const on = !!machine.mirror?.on;
  const exclude = machine.mirror?.exclude ?? [];
  const status = useSettingsStore(s => s.machinesPage.mirror[machine.id]);
  const message = useSettingsStore(s => s.machinesPage.mirrorMessages[machine.id]);
  const progress = useSettingsStore(s => s.machinesPage.mirrorProgress[machine.id]);
  const [turningOn, setTurningOn] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState("");
  const ago = status ? agoParts(status.at) : null;
  const id = `mcmirror-${machine.id}`;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          on={on || turningOn}
          onToggle={checked => {
            if (checked && !on) setTurningOn(true);
            else {
              setTurningOn(false);
              if (!checked) saveMirror(machine, false, exclude);
            }
          }}
        />
        <label className="text-xs font-medium text-s-fg" htmlFor={id}>
          {t("mc.mirror")}
        </label>
      </div>
      <p className={HINT_IN_ROW}>{t("mc.mirrorHelp")}</p>
      {turningOn && !on ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-s-muted">{t("mc.mirrorConfirm")}</span>
          <button
            className={buttonClass("primary")}
            onClick={async () => {
              await saveMirror(machine, true, exclude);
              setTurningOn(false);
            }}
          >
            {t("mc.mirrorTurnOn")}
          </button>
          <button className={buttonClass("ghost")} onClick={() => setTurningOn(false)}>
            {t("mc.cancel")}
          </button>
        </div>
      ) : null}
      {on || exclude.length ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-s-fg">{t("mc.mirrorExclude")}</span>
          {exclude.length ? (
            exclude.map(item => (
              <div key={item} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-s-fg">{item}</span>
                <button className={buttonClass("ghost")} onClick={() => removeMirrorExclude(machine, item)}>
                  {t("mc.removeFolder")}
                </button>
              </div>
            ))
          ) : (
            <p className={HINT_IN_ROW}>{t("mc.mirrorNoExclude")}</p>
          )}
          <div className="flex items-center gap-2">
            <input
              className={`${FIELD} min-w-0 flex-1 font-mono`}
              placeholder="Contexts/Personal"
              aria-label={t("mc.mirrorExcludePath")}
              spellCheck={false}
              value={path}
              onChange={e => {
                setPath(e.target.value);
                setPathError("");
              }}
            />
            <button
              className={buttonClass("ghost")}
              disabled={!path.trim()}
              onClick={async () => {
                const error = await addMirrorExclude(machine, path);
                setPathError(error);
                if (!error) setPath("");
              }}
            >
              {t("mc.mirrorAdd")}
            </button>
          </div>
          {pathError ? <span className={ERROR_MESSAGE}>{pathError}</span> : null}
        </div>
      ) : null}
      {on ? (
        <div className="grid gap-1">
          {progress ? (
            <div className="grid gap-1">
              <span className="text-xs text-s-muted">
                {t("mc.mirrorStep", { step: progress.step, root: t(ROOT[progress.root]) })}
                {" · "}
                {progress.total
                  ? t("mc.mirrorFiles", { done: progress.done, total: progress.total })
                  : t("mc.mirrorComparing")}
              </span>
              {/* without a value the bar runs on its own while the files are compared */}
              <progress
                className="h-1.5 w-full"
                aria-label={t("mc.mirrorProgress")}
                max={progress.total || undefined}
                value={progress.total ? progress.done : undefined}
              />
            </div>
          ) : null}
          {status ? (
            <>
              <span className="text-xs text-s-muted">
                {ago
                  ? t("mc.mirrorLast", {
                      when: relativeFormat(locale, { numeric: "auto" }).format(ago.value, ago.unit),
                    })
                  : t("mc.mirrorNever")}
                {" · "}
                {t("mc.mirrorCounts", { sent: status.pushed, received: status.pulled })}
              </span>
              {status.locked ? <StatusLine level="warn">{t("mc.mirrorLocked")}</StatusLine> : null}
              {!status.in_ram ? <p className={HINT_IN_ROW}>{t("mc.mirrorNotInRam")}</p> : null}
              {status.conflicts.length ? (
                <div className="grid gap-0.5">
                  <span className="text-xs text-s-muted">{tn("mc.mirrorConflicts", status.conflicts.length)}</span>
                  {status.conflicts.map(conflict => (
                    <span key={conflict} className="font-mono text-xs text-s-fg">
                      {t("mc.mirrorConflict", { path: conflictPath(conflict) })}
                    </span>
                  ))}
                </div>
              ) : null}
              {status.errors.map((error, index) => (
                <span key={index} className={ERROR_MESSAGE}>
                  {error}
                </span>
              ))}
            </>
          ) : progress ? null : (
            <span className="text-xs text-s-muted">{t("mc.mirrorNever")}</span>
          )}
        </div>
      ) : null}
      {message ? <span className={message.ok ? "text-xs text-s-muted" : ERROR_MESSAGE}>{message.text}</span> : null}
      {on || status ? (
        <div className="flex flex-wrap items-center gap-2">
          {wiping ? (
            <>
              <span className="text-xs text-s-muted">{t("mc.mirrorWipeSure")}</span>
              <button
                className={buttonClass("dangerSolid")}
                onClick={() => {
                  setWiping(false);
                  wipeMirror(machine);
                }}
              >
                {t("mc.mirrorWipe")}
              </button>
              <button className={buttonClass("ghost")} onClick={() => setWiping(false)}>
                {t("mc.cancel")}
              </button>
            </>
          ) : (
            <button className={buttonClass("danger")} onClick={() => setWiping(true)}>
              {t("mc.mirrorWipe")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
