import { useEffect, useState } from "react";
import type { Column } from "../../../domain/board/types";
import { checksOf, EMPTY_PIPELINE } from "../../../domain/pipeline/rules";
import type { Pipeline, PipelineRepo } from "../../../domain/pipeline/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  pickPipelineRepo,
  pipelineColumns,
  pipelineRepos,
  setPipeline,
  setPipelineRepo,
} from "../../../application/settings/pipeline";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ChangeInput } from "./ChangeInput";
import { BUTTON_GLYPH, buttonClass, EMPTY_LIST, ERROR_MESSAGE, FIELD, SELECT } from "./blocks";
import { Field } from "./Field";
import { PathField } from "./PathField";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

type Cols = { groupings: { id: string; label: string }[]; group: string; columns: Column[] };
const COLUMNS = ["pick", "busy", "review", "input", "merged"] as const;

/** A project's board pipeline, in its folded-open row when a board is linked: the project's repos it builds in (each
 *  with its checks, or switched off) and a checkout picked by hand, the branch it starts from and the one its PRs go to, the board's columns it moves tickets
 *  through, a label to pick on, how many run at once, and the switch. */
export function PipelineSettings({ name }: { name: string }) {
  const { t, any } = useT();
  const stored = useSettingsStore(s => s.settings.pipelines?.[name]);
  const p: Pipeline = { ...EMPTY_PIPELINE, ...stored };
  const linked = useSettingsStore(s => !!s.settings.boards?.[name]);
  // only Productive has a client portal to keep comments out of
  const clients = useSettingsStore(s => s.settings.boards?.[name]?.provider === "productive");
  const [cols, setCols] = useState<Cols | null>(null);
  const [err, setErr] = useState("");
  const [repos, setRepos] = useState<PipelineRepo[] | null>(null);
  useEffect(() => {
    if (!linked) return;
    pipelineColumns(name, p.group).then(setCols, e => setErr(String(e?.message ?? e)));
  }, [name, p.group, linked]);
  useEffect(() => {
    if (!linked) return;
    pipelineRepos(name, p.repo).then(setRepos, e => setErr(String(e?.message ?? e)));
  }, [name, p.repo, linked]);
  if (!linked) return null;

  const set = (patch: Partial<Pipeline>) => setPipeline(name, patch);
  const options = (cols?.columns ?? []).map(c => ({ id: c.id, name: c.name }));
  return (
    <>
      <Field label={t("pl.title")} hint={t("pl.help")}>
        <Switch id={`pl-${name}`} on={p.on} onToggle={on => set({ on })} />
      </Field>
      {err && <span className={ERROR_MESSAGE}>{err}</span>}
      <Field label={t("pl.mode")} hint={t(p.mode === "manual" ? "pl.modeManualHelp" : "pl.modeAutoHelp")}>
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
      <Field label={t("pl.repos")} hint={t("pl.reposHelp")}>
        {null}
      </Field>
      {repos && !repos.length && <p className={EMPTY_LIST}>{t("pl.reposNone")}</p>}
      {repos?.map(r => (
        <Field
          key={r.slug}
          label={
            <code className="block truncate font-mono text-xs" title={r.slug}>
              {r.slug}
            </code>
          }
          hint={
            <span className="block truncate" title={r.path}>
              {r.path.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          }
        >
          <ChangeInput
            className={`${FIELD} font-mono text-xs`}
            value={checksOf(p, r)}
            placeholder={t("pl.checks")}
            aria-label={t("pl.repoChecks", { repo: r.slug })}
            title={t("pl.checksHelp")}
            spellCheck={false}
            onCommit={v => setPipelineRepo(name, r.slug, { checks: v.trim() })}
          />
          <Switch
            id={`pl-repo-${name}-${r.slug}`}
            label={t("pl.repoOn", { repo: r.slug })}
            on={!p.repos?.[r.slug]?.off}
            onToggle={on => setPipelineRepo(name, r.slug, { off: !on })}
          />
        </Field>
      ))}
      <Field label={t("pl.repo")} hint={t("pl.repoHelp")}>
        <PathField
          value={p.repo}
          tip={p.repo}
          placeholder={t("pl.repoPh")}
          pickTip={t("pl.repoPick")}
          readOnly
          onPick={() => pickPipelineRepo(name)}
        />
        {p.repo && (
          <button
            className={buttonClass("ghost", true)}
            title={t("int.unlink")}
            aria-label={t("int.unlink")}
            onClick={() => set({ repo: "" })}
          >
            <Icon name="close" className={BUTTON_GLYPH} />
          </button>
        )}
      </Field>
      <Field label={t("pl.base")} hint={t("pl.baseHelp")}>
        <ChangeInput
          className={FIELD}
          value={p.base}
          placeholder="develop"
          spellCheck={false}
          onCommit={v => set({ base: v.trim() })}
        />
      </Field>
      <Field label={t("pl.into")} hint={t("pl.intoHelp")}>
        <ChangeInput
          className={FIELD}
          value={p.into ?? ""}
          placeholder="staging"
          spellCheck={false}
          onCommit={v => set({ into: v.trim() })}
        />
      </Field>
      {(cols?.groupings.length ?? 0) > 1 && (
        <Field label={t("pl.group")}>
          <Select
            className={SELECT}
            aria-label={t("pl.group")}
            options={cols!.groupings.map(g => ({ id: g.id, name: any(g.label) }))}
            value={cols!.group}
            onChange={group => set({ group, pick: "", busy: "", review: "", input: "", merged: "" })}
          />
        </Field>
      )}
      {COLUMNS.filter(k => k !== "pick" || p.mode !== "manual").map(k => (
        <Field key={k} label={t(`pl.col.${k}`)} hint={t(`pl.col.${k}Help`)}>
          <Select
            className={SELECT}
            aria-label={t(`pl.col.${k}`)}
            empty={k === "merged" ? t("pl.none") : t("pl.pickColumn")}
            options={options}
            value={p[k]}
            onChange={v => set({ [k]: v })}
          />
        </Field>
      ))}
      {p.mode !== "manual" && (
        <Field label={t("pl.label")} hint={t("pl.labelHelp")}>
          <ChangeInput
            className={FIELD}
            value={p.label}
            placeholder="agent"
            spellCheck={false}
            onCommit={v => set({ label: v.trim() })}
          />
        </Field>
      )}
      <Field label={t("pl.skill")} hint={t("pl.skillHelp")}>
        <ChangeInput
          className={`${FIELD} font-mono text-xs`}
          value={p.skill ?? ""}
          placeholder="ticket-flow:develop"
          spellCheck={false}
          onCommit={v => set({ skill: v.trim().replace(/^\//, "") })}
        />
      </Field>
      {/* with a skill, the skill decides per ticket whether a plan needs approval */}
      {!p.skill && (
        <Field label={t("pl.plan")} hint={t("pl.planHelp")}>
          <Switch id={`pl-plan-${name}`} on={!!p.plan} onToggle={plan => set({ plan })} />
        </Field>
      )}
      <Field label={t("pl.review")} hint={t("pl.reviewHelp")}>
        <Select
          className={SELECT}
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
      <Field label={t("pl.rounds")} hint={t("pl.roundsHelp")}>
        <ChangeInput
          className={FIELD}
          value={String(p.rounds ?? 3)}
          inputMode="numeric"
          onCommit={v => set({ rounds: Math.min(10, Math.max(1, Number.parseInt(v, 10) || 3)) })}
        />
      </Field>
      {clients && (
        <Field label={t("pl.hidden")} hint={t("pl.hiddenHelp")}>
          <Switch id={`pl-hidden-${name}`} on={p.hidden !== false} onToggle={hidden => set({ hidden })} />
        </Field>
      )}
      <Field label={t("pl.parallel")}>
        <ChangeInput
          className={FIELD}
          value={String(p.parallel)}
          inputMode="numeric"
          onCommit={v => set({ parallel: Math.min(5, Math.max(1, Number.parseInt(v, 10) || 1)) })}
        />
      </Field>
    </>
  );
}
