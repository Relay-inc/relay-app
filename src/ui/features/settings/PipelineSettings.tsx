import { useEffect, useState, type ReactNode } from "react";
import type { Column } from "../../../domain/board/types";
import { checksOf, EMPTY_PIPELINE } from "../../../domain/pipeline/rules";
import type { Pipeline } from "../../../domain/pipeline/types";
import { useSettingsStore } from "../../../application/settings/store";
import { pipelineColumns, setPipeline, setPipelineRepo } from "../../../application/settings/pipeline";
import { trackerBoards } from "../../../application/board/trackers";
import { provider as providerById } from "../../../shared/plugins";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { HELP, MONO, TEXT } from "./ProjectSettings";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { Stepper } from "./Stepper";
import { Switch } from "./Switch";

type Cols = { groupings: { id: string; label: string }[]; group: string; columns: Column[] };
type Step = "pick" | "busy" | "review" | "merged";

// a card of rows: each with its padding and a hairline above it
const CARD =
  "grid min-w-0 rounded-xl border border-s-border bg-raised [&>*]:min-w-0 [&>*+*]:border-t [&>*+*]:border-s-border";
const ROW = "px-3.5 py-3";
const FIELD_SELECT = `${SELECT} h-7.5 w-full text-[13px]`;

/** The Pipeline tab of a project: the switch with how it picks up, the ticket flow (the board's columns a ticket moves
 *  through, in one line), the branches and checks, how the agent builds and the review after it. */
export function PipelineSettings({ name, onGeneral }: { name: string; onGeneral: () => void }) {
  const { t, any } = useT();
  const stored = useSettingsStore(s => s.settings.pipelines?.[name]);
  const p: Pipeline = { ...EMPTY_PIPELINE, ...stored };
  const board = useSettingsStore(s => s.settings.boards?.[name]);
  const linked = !!board;
  // only Productive has a client portal to keep comments out of
  const clients = board?.provider === "productive";
  const found = useSettingsStore(s => s.projectsPage.checkouts[name]) ?? [];
  const [cols, setCols] = useState<Cols | null>(null);
  const [boardName, setBoardName] = useState<{ of: string; name: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!linked) return;
    pipelineColumns(name, p.group).then(setCols, e => setErr(String(e?.message ?? e)));
  }, [name, p.group, linked]);
  const boardKey = board ? `${board.provider}/${board.project}/${board.board}` : "";
  useEffect(() => {
    if (!board) return;
    trackerBoards(board.provider, board.project, name).then(
      list => setBoardName({ of: boardKey, name: list.find(b => b.id === board.board)?.name ?? "" }),
      () => {},
    );
  }, [board, boardKey, name]);
  // "Productive › Portal v2": the tracker, and the board once its name is loaded
  const uses = board
    ? [providerById(board.provider)?.name ?? board.provider, boardName?.of === boardKey ? boardName.name : ""]
        .filter(Boolean)
        .join(" › ")
    : "";

  const set = (patch: Partial<Pipeline>) => setPipeline(name, patch);
  const manual = p.mode === "manual";
  const options = (cols?.columns ?? []).map(c => ({ id: c.id, name: c.name }));
  const general = (
    <button className="text-accent-text underline" onClick={onGeneral}>
      {t("pc.general")}
    </button>
  );
  const column = (k: Step | "input", className = FIELD_SELECT) => (
    <Select
      className={className}
      aria-label={t(`pl.col.${k}`)}
      empty={k === "merged" ? t("pl.none") : t("pl.pickColumn")}
      options={options}
      value={p[k]}
      onChange={v => set({ [k]: v })}
      disabled={!linked}
    />
  );
  // the steps a ticket goes through; with hand-picked tickets there is no column to pick up from
  const steps: Step[] = manual ? ["busy", "review", "merged"] : ["pick", "busy", "review", "merged"];
  const step = (k: Step, i: number): ReactNode => (
    <label key={k} className="grid content-start gap-1" title={t(`pl.col.${k}Help`)}>
      <span className="text-xs text-s-muted">
        {i + 1} · {t(`pl.col.${k}`)}
      </span>
      {column(k)}
    </label>
  );
  const arrow = (key: string) => (
    <span key={key} aria-hidden="true" className="hidden self-end pb-1 text-s-faint @xl:block">
      <Icon name="right" className="size-4 fill-none stroke-current stroke-2" />
    </span>
  );

  return (
    <>
      <div className={CARD}>
        <Field
          wrap
          className={ROW}
          label={t("pl.title")}
          id={`pl-${name}`}
          info={t("pl.help")}
          hint={
            linked ? (
              t("pl.usesBoard", { board: uses })
            ) : (
              <>
                {t("pl.linkFirst")} {general}
              </>
            )
          }
        >
          <Switch id={`pl-${name}`} on={p.on} disabled={!linked} onToggle={on => set({ on })} />
        </Field>
        <Field wrap className={ROW} label={t("pl.mode")} hint={t(manual ? "pl.modeManualHelp" : "pl.modeAutoHelp")}>
          <Segmented
            label={t("pl.mode")}
            options={[
              ["auto", t("pl.modeAuto")],
              ["manual", t("pl.modeManual")],
            ]}
            value={p.mode ?? "auto"}
            onPick={mode => set({ mode })}
          />
        </Field>
        <Field
          wrap
          className={ROW}
          label={t("pl.label")}
          id={`pl-label-${name}`}
          hint={t(manual ? "pl.labelManual" : "pl.labelHelp")}
        >
          <ChangeInput
            id={`pl-label-${name}`}
            className={`${TEXT} w-35`}
            value={p.label}
            placeholder="agent"
            spellCheck={false}
            disabled={manual}
            onCommit={v => set({ label: v.trim() })}
          />
        </Field>
        <Field
          wrap
          className={ROW}
          label={t("pl.mine")}
          id={`pl-mine-${name}`}
          hint={t(manual ? "pl.labelManual" : "pl.mineHelp")}
        >
          <Switch id={`pl-mine-${name}`} on={!!p.mine} disabled={manual} onToggle={mine => set({ mine })} />
        </Field>
        <Field wrap className={ROW} label={t("pl.parallel")}>
          <Stepper
            label={t("pl.parallel")}
            fewer={t("pc.fewer")}
            more={t("pc.more")}
            value={p.parallel}
            min={1}
            max={5}
            onChange={parallel => set({ parallel })}
          />
        </Field>
      </div>
      {err && <span className={ERROR_MESSAGE}>{err}</span>}

      <Section
        title={t("pl.flow")}
        desc={t("pl.flowHelp")}
        action={
          (cols?.groupings.length ?? 0) > 1 && (
            <label className="flex items-center gap-2">
              <span className={HELP}>{t("pl.group")}</span>
              <Select
                className={`${SELECT} h-7.5 w-40 text-[13px]`}
                options={cols!.groupings.map(g => ({ id: g.id, name: any(g.label) }))}
                value={cols!.group}
                onChange={group => set({ group, pick: "", busy: "", review: "", input: "", merged: "" })}
              />
            </label>
          )
        }
      >
        <div
          className={`grid grid-cols-2 items-start gap-x-2 gap-y-3 ${manual ? "@xl:grid-cols-[1fr_auto_1fr_auto_1fr]" : "@xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]"}`}
        >
          {steps.flatMap((k, i) => (i ? [arrow(`a${i}`), step(k, i)] : [step(k, i)]))}
        </div>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-s-border pt-3"
          title={t("pl.col.inputHelp")}
        >
          <span className="min-w-56 flex-1">{t("pl.col.inputAny")}</span>
          {column("input", `${SELECT} h-7.5 w-40 text-[13px]`)}
        </div>
      </Section>

      <Section title={t("pl.branches")} desc={t("pl.branchesHelp")} rows>
        <Field wrap label={t("pl.base")} id={`pc-base-${name}`} hint={t("pl.baseHelp")}>
          <ChangeInput
            id={`pc-base-${name}`}
            className={`${TEXT} ${MONO} w-40`}
            value={p.base}
            placeholder="develop"
            spellCheck={false}
            onCommit={v => set({ base: v.trim() })}
          />
        </Field>
        <Field wrap label={t("pl.into")} id={`pc-into-${name}`} hint={t("pl.intoHelp")}>
          <ChangeInput
            id={`pc-into-${name}`}
            className={`${TEXT} ${MONO} w-40`}
            value={p.into ?? ""}
            placeholder={p.base || "main"}
            spellCheck={false}
            onCommit={v => set({ into: v.trim() })}
          />
        </Field>
        {/* per repo: a backend and a frontend repo rarely share one command */}
        {found.length ? (
          found.map(r => (
            <Field wrap key={r.slug} label={<span className={MONO}>{r.slug}</span>} id={`pl-checks-${name}-${r.slug}`}>
              <ChangeInput
                id={`pl-checks-${name}-${r.slug}`}
                className={`${TEXT} ${MONO} w-48 @xl:w-75`}
                value={checksOf(p, r)}
                placeholder="pnpm install && pnpm lint && pnpm test"
                aria-label={t("pl.repoChecks", { repo: r.slug })}
                spellCheck={false}
                onCommit={v => setPipelineRepo(name, r.slug, { checks: v.trim() })}
              />
            </Field>
          ))
        ) : (
          <span className={HELP}>{t("pl.reposNone")}</span>
        )}
      </Section>

      <div className="grid grid-cols-1 items-start gap-5 @2xl:grid-cols-2">
        <Section title={t("pl.build")} rows>
          <Field wrap label={t("pl.skill")} id={`pl-skill-${name}`} hint={t("pl.skillHelp")}>
            <ChangeInput
              id={`pl-skill-${name}`}
              className={`${TEXT} ${MONO} w-40`}
              value={p.skill ?? ""}
              placeholder="ticket-flow:develop"
              spellCheck={false}
              onCommit={v => set({ skill: v.trim().replace(/^\//, "") })}
            />
          </Field>
          {/* with a skill, the skill decides per ticket whether a plan needs approval */}
          {!p.skill && (
            <Field wrap label={t("pl.plan")} id={`pl-plan-${name}`} hint={t("pl.planHelp")}>
              <Switch id={`pl-plan-${name}`} on={!!p.plan} onToggle={plan => set({ plan })} />
            </Field>
          )}
        </Section>

        <Section title={t("pl.reviewSection")} rows>
          <Field wrap label={t("pl.review")} hint={t("pl.reviewHelp")}>
            <Select
              className={`${SELECT} h-7.5 w-36 text-[13px]`}
              aria-label={t("pl.review")}
              options={[
                { id: "", name: t("pl.reviewAny") },
                { id: "claude", name: "Claude Code" },
                { id: "codex", name: "Codex" },
                { id: "off", name: t("pl.reviewOff") },
              ]}
              value={p.reviewer ?? ""}
              onChange={reviewer => set({ reviewer })}
            />
          </Field>
          <Field wrap label={t("pl.rounds")} hint={t("pl.roundsHelp")}>
            <Stepper
              label={t("pl.rounds")}
              fewer={t("pc.fewer")}
              more={t("pc.more")}
              value={p.rounds ?? 3}
              min={1}
              max={10}
              onChange={rounds => set({ rounds })}
            />
          </Field>
          {clients && (
            <Field wrap label={t("pl.hidden")} id={`pl-hidden-${name}`} hint={t("pl.hiddenHelp")}>
              <Switch id={`pl-hidden-${name}`} on={p.hidden !== false} onToggle={hidden => set({ hidden })} />
            </Field>
          )}
        </Section>
      </div>
    </>
  );
}
