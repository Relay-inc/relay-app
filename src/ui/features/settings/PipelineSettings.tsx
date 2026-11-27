import { useEffect, useState, type ReactNode } from "react";
import type { Column } from "../../../domain/board/types";
import { checksOf, EMPTY_PIPELINE } from "../../../domain/pipeline/rules";
import type { Pipeline } from "../../../domain/pipeline/types";
import { useSettingsStore } from "../../../application/settings/store";
import { pipelineColumns, setPipeline, setPipelineRepo } from "../../../application/settings/pipeline";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { HELP, MONO, TEXT } from "./ProjectSettings";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { Stepper } from "./Stepper";
import { Switch } from "./Switch";

type Cols = { groupings: { id: string; label: string }[]; group: string; columns: Column[] };
type Step = "pick" | "busy" | "review" | "merged";

// a cell of a card: label, control, help
const CELL = "flex flex-col gap-1.5 px-4 py-3.5";
// a row of a card: label and help on the left, the control on the right
const ROW = "flex items-center gap-3 px-4 py-3.5";
// the stack of cells in a card, a hairline between them
const STACK = "p-0 [&>*+*]:border-t [&>*+*]:border-s-border";
const FIELD_SELECT = `${SELECT} h-7.5 w-full text-[13px]`;

/** The Pipeline tab of a project: the switch with how it picks up, the board's columns a ticket moves through, how the
 *  agent builds (skill, plan first, checks per repo) and the review after it. */
export function PipelineSettings({ name, onGeneral }: { name: string; onGeneral: () => void }) {
  const { t, any } = useT();
  const stored = useSettingsStore(s => s.settings.pipelines?.[name]);
  const p: Pipeline = { ...EMPTY_PIPELINE, ...stored };
  const linked = useSettingsStore(s => !!s.settings.boards?.[name]);
  // only Productive has a client portal to keep comments out of
  const clients = useSettingsStore(s => s.settings.boards?.[name]?.provider === "productive");
  const found = useSettingsStore(s => s.projectsPage.checkouts[name]) ?? [];
  const [cols, setCols] = useState<Cols | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!linked) return;
    pipelineColumns(name, p.group).then(setCols, e => setErr(String(e?.message ?? e)));
  }, [name, p.group, linked]);

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
  const card = (k: Step, i: number): ReactNode => (
    <div
      key={k}
      className="flex flex-col gap-2 rounded-lg border border-s-border bg-raised p-3 shadow-[0_1px_2px_rgba(0,0,0,.06)]"
    >
      <span
        className={`text-xs font-semibold tracking-wider uppercase ${i === 0 ? "text-accent-text" : "text-s-muted"}`}
      >
        {i + 1} · {t(`pl.col.${k}`)}
      </span>
      {column(k)}
      <span className={HELP}>{t(`pl.col.${k}Help`)}</span>
    </div>
  );
  const arrow = (key: string) => (
    <span key={key} aria-hidden="true" className="hidden place-items-center text-s-faint @2xl:grid">
      <Icon name="right" className="size-4 fill-none stroke-current stroke-2" />
    </span>
  );

  return (
    <>
      <section className="grid rounded-xl border border-s-border">
        <div className="flex flex-wrap items-center gap-4 border-b border-s-border p-4">
          <div className="min-w-64 flex-1">
            <h2 className="text-[13px] font-semibold">{t("pl.title")}</h2>
            <p className={`${HELP} mt-0.5`}>{t("pl.help")}</p>
          </div>
          <span className={HELP}>
            {t(linked ? "pl.linkedIn" : "pl.linkFirst")} {general}
          </span>
          <Switch id={`pl-${name}`} label={t("pl.title")} on={p.on} disabled={!linked} onToggle={on => set({ on })} />
        </div>
        <div className="grid grid-cols-1 @xl:grid-cols-3 [&>*+*]:border-t [&>*+*]:border-s-border @xl:[&>*+*]:border-t-0 @xl:[&>*+*]:border-l">
          <div className={CELL}>
            <span className="font-medium">{t("pl.mode")}</span>
            <Segmented
              label={t("pl.mode")}
              className="self-start"
              options={[
                ["auto", t("pl.modeAuto")],
                ["manual", t("pl.modeManual")],
              ]}
              value={p.mode ?? "auto"}
              onPick={mode => set({ mode })}
            />
            <span className={HELP}>{t(manual ? "pl.modeManualHelp" : "pl.modeAutoHelp")}</span>
          </div>
          <div className={CELL}>
            <label htmlFor={`pl-label-${name}`} className="font-medium">
              {t("pl.label")}
            </label>
            <ChangeInput
              id={`pl-label-${name}`}
              className={`${TEXT} w-full`}
              value={p.label}
              placeholder="agent"
              spellCheck={false}
              disabled={manual}
              onCommit={v => set({ label: v.trim() })}
            />
            <span className={HELP}>{t(manual ? "pl.labelManual" : "pl.labelHelp")}</span>
          </div>
          <div className={CELL}>
            <span className="font-medium">{t("pl.parallel")}</span>
            <Stepper
              label={t("pl.parallel")}
              fewer={t("pc.fewer")}
              more={t("pc.more")}
              value={p.parallel}
              min={1}
              max={5}
              onChange={parallel => set({ parallel })}
            />
            <span className={HELP}>{t("pl.parallelHelp")}</span>
          </div>
        </div>
        <div className={`${ROW} border-t border-s-border`}>
          <div className="flex-1">
            <label htmlFor={`pl-mine-${name}`} className="block font-medium">
              {t("pl.mine")}
            </label>
            <span className={HELP}>{t(manual ? "pl.labelManual" : "pl.mineHelp")}</span>
          </div>
          <Switch id={`pl-mine-${name}`} on={!!p.mine} disabled={manual} onToggle={mine => set({ mine })} />
        </div>
      </section>
      {err && <span className={ERROR_MESSAGE}>{err}</span>}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">{t("pl.flow")}</h2>
            <p className={`${HELP} mt-0.5`}>{t("pl.flowHelp")}</p>
          </div>
          {(cols?.groupings.length ?? 0) > 1 && (
            <label className="flex items-center gap-2">
              <span className={HELP}>{t("pl.group")}</span>
              <Select
                className={`${SELECT} h-7.5 w-40 text-[13px]`}
                options={cols!.groupings.map(g => ({ id: g.id, name: any(g.label) }))}
                value={cols!.group}
                onChange={group => set({ group, pick: "", busy: "", review: "", input: "", merged: "" })}
              />
            </label>
          )}
        </div>
        <div className="grid gap-3.5 rounded-xl bg-s-hover p-4">
          <div
            className={`grid grid-cols-1 items-stretch gap-1.5 @md:grid-cols-2 ${manual ? "@2xl:grid-cols-[1fr_1.25rem_1fr_1.25rem_1fr]" : "@2xl:grid-cols-[1fr_1.25rem_1fr_1.25rem_1fr_1.25rem_1fr]"}`}
          >
            {steps.flatMap((k, i) => (i ? [arrow(`a${i}`), card(k, i)] : [card(k, i)]))}
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-s-input bg-raised p-3">
            <Icon name="alert" className="size-4 flex-none fill-none stroke-s-warn stroke-2" />
            <div className="min-w-56 flex-1">
              <span className="block font-medium">{t("pl.col.inputAny")}</span>
              <span className={HELP}>{t("pl.col.inputHelp")}</span>
            </div>
            {column("input", `${SELECT} h-7.5 w-56 text-[13px]`)}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 @2xl:grid-cols-2">
        <Section title={t("pl.build")} list>
          <div className={STACK}>
            <div className={CELL}>
              <label htmlFor={`pl-skill-${name}`} className="font-medium">
                {t("pl.skill")}
              </label>
              <ChangeInput
                id={`pl-skill-${name}`}
                className={`${TEXT} ${MONO} w-full`}
                value={p.skill ?? ""}
                placeholder="ticket-flow:develop"
                spellCheck={false}
                onCommit={v => set({ skill: v.trim().replace(/^\//, "") })}
              />
              <span className={HELP}>{t("pl.skillHelp")}</span>
            </div>
            {/* with a skill, the skill decides per ticket whether a plan needs approval */}
            {!p.skill && (
              <div className={ROW}>
                <div className="flex-1">
                  <span className="block font-medium">{t("pl.plan")}</span>
                  <span className={HELP}>{t("pl.planHelp")}</span>
                </div>
                <Switch id={`pl-plan-${name}`} label={t("pl.plan")} on={!!p.plan} onToggle={plan => set({ plan })} />
              </div>
            )}
            <div className={CELL}>
              <span className="font-medium">{t("pl.checks")}</span>
              {/* per repo: a backend and a frontend repo rarely share one command */}
              {found.length ? (
                found.map(r => (
                  <label key={r.slug} className="grid gap-1">
                    {found.length > 1 && <span className={`${MONO} text-s-muted`}>{r.slug}</span>}
                    <ChangeInput
                      className={`${TEXT} ${MONO} w-full`}
                      value={checksOf(p, r)}
                      placeholder="pnpm install && pnpm lint && pnpm test"
                      aria-label={t("pl.repoChecks", { repo: r.slug })}
                      spellCheck={false}
                      onCommit={v => setPipelineRepo(name, r.slug, { checks: v.trim() })}
                    />
                  </label>
                ))
              ) : (
                <span className={HELP}>{t("pl.reposNone")}</span>
              )}
              <span className={HELP}>{t("pl.checksHelp")}</span>
            </div>
          </div>
        </Section>

        <Section title={t("pl.reviewSection")} list>
          <div className={STACK}>
            <div className={CELL}>
              <span className="font-medium">{t("pl.review")}</span>
              <Select
                className={FIELD_SELECT}
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
              <span className={HELP}>{t("pl.reviewHelp")}</span>
            </div>
            <div className={ROW}>
              <div className="flex-1">
                <span className="block font-medium">{t("pl.rounds")}</span>
                <span className={HELP}>{t("pl.roundsHelp")}</span>
              </div>
              <Stepper
                label={t("pl.rounds")}
                fewer={t("pc.fewer")}
                more={t("pc.more")}
                value={p.rounds ?? 3}
                min={1}
                max={10}
                onChange={rounds => set({ rounds })}
              />
            </div>
            {clients && (
              <div className={ROW}>
                <div className="flex-1">
                  <span className="block font-medium">{t("pl.hidden")}</span>
                  <span className={HELP}>{t("pl.hiddenHelp")}</span>
                </div>
                <Switch
                  id={`pl-hidden-${name}`}
                  label={t("pl.hidden")}
                  on={p.hidden !== false}
                  onToggle={hidden => set({ hidden })}
                />
              </div>
            )}
          </div>
        </Section>
      </div>
    </>
  );
}
