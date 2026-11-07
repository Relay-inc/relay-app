import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  askClaude,
  canRepair,
  checkWorkspace,
  gardenWorkspace,
  repairWorkspace,
  setAbout,
  tidyApply,
  tidyPreview,
  tidyUndo,
  workspaceProjects,
  type TidyPlan,
  type VaultFinding,
} from "../../../application/workspace/check";
import { brokenLink, bytes, commonFolder, findingGroups, isGarden, type Group } from "../../../domain/workspace/garden";
import { outsideKinds, tidySample } from "../../../domain/workspace/tidy";
import { openPageAtLine, trashPages } from "../../../application/navigation/pages";
import { activeFolder } from "../../../application/navigation/workspaces";
import { toast } from "../../../application/navigation/navigation";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { DryRunSheet } from "./DryRunSheet";

// each kind's name in the list
const TITLE = {
  claude_link: "vc.claudeLink",
  missing_file: "vc.missingFile",
  context_note: "vc.contextNote",
  context_rule: "vc.contextRule",
  context_heading: "vc.contextHeading",
  context_mismatch: "vc.contextMismatchTitle",
  card_fields: "vc.cardFields",
  orphan_rule: "vc.orphanRule",
  row_without_note: "vc.rowWithoutNote",
  outside_home: "vc.outsideTitle",
  no_project: "garden.noProjectTitle",
  broken_link: "garden.brokenTitle",
  orphan: "garden.orphanTitle",
  unused_attachment: "garden.unusedTitle",
  no_type: "garden.noTypeTitle",
} as const;
// what Ask Claude takes in one run (garden_ask in lib.rs)
const ASK = 20;
// the entries a group lists before it is expanded
const PEEK = 3;
type Sheet = "tidy" | "trash" | "properties" | "about";

/** The vault check: one list of what the workspace shown lacks or where its notes decay, grouped by kind (the health
 *  check's first, then the garden's), each group with its count, its action and its first entries; a path opens as a
 *  page. Repair, Tidy structure and Move to trash are an admin's in a shared workspace. Tidy, Ask Claude and Move to
 *  trash show a dry run first. `kind` opens the dialog scrolled to that group, expanded. */
export function VaultCheckDialog({
  workspace,
  onClose,
  kind,
}: {
  workspace: string;
  onClose: () => void;
  kind?: string;
}) {
  const { t, th, tn, locale } = useT();
  const [found, setFound] = useState<VaultFinding[] | null>(null);
  const [checkedAt, setCheckedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(kind ? { [kind]: true } : {});
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // Tidy structure's plan, once read
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const read = () =>
    Promise.all([checkWorkspace(), gardenWorkspace()]).then(
      ([health, garden]) => {
        setFound([...health, ...garden]);
        setCheckedAt(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
      },
      e => {
        toast(String(e));
        onClose();
      },
    );
  useEffect(() => void read(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = !!found;
  useEffect(() => {
    if (kind && loaded) list.current?.querySelector(`[data-kind="${kind}"]`)?.scrollIntoView({ block: "start" });
  }, [kind, loaded]);
  const admin = canRepair();
  const projects = workspaceProjects();
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
      await read();
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };
  const repair = (ids: string[]) => run(async () => toast(tn("vc.repaired", await repairWorkspace(ids))));
  const tidy = () => {
    setSheet("tidy");
    setPlan(null);
    tidyPreview().then(setPlan, e => {
      toast(String(e));
      setSheet(null);
    });
  };
  const applyTidy = () =>
    run(async () => {
      const done = await tidyApply();
      toast(tn("tidy.done", done.moves.length), () => {
        void tidyUndo()
          .then(() => {
            toast(t("tidy.undone"));
            return read();
          })
          .catch(e => toast(String(e)));
      });
      setSheet(null);
    });
  const groups = findingGroups(found ?? []);
  const paths = (kind: string) => groups.find(g => g.kind === kind)?.paths ?? [];
  const fixable = (found ?? []).filter(f => f.fix);
  // one filled button: Repair all, else Tidy structure, and neither while a sheet is open (its Apply is)
  const repairAll = admin && fixable.length > 0;
  const flip = (kind: string) => setOpen(o => ({ ...o, [kind]: !o[kind] }));
  const name = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");
  const page = (p: string, line = 1, label = p) =>
    /\.md$/i.test(p) ? (
      <button
        className="min-w-0 truncate text-left font-mono text-xs text-accent-text hover:underline cursor-pointer"
        title={p}
        onClick={() => {
          void openPageAtLine(activeFolder(), p, line);
          onClose();
        }}
      >
        {label}
      </button>
    ) : (
      <code className="min-w-0 truncate font-mono text-xs" title={p}>
        {label}
      </code>
    );
  const act = (label: string, onClick: () => void, filled = false) => (
    <button
      className={`btn flex-none cursor-pointer disabled:opacity-50 ${filled ? "btn-primary" : ""}`}
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const lock = (text: string) => <span className="flex-none text-xs text-tertiary">{text}</span>;
  const review = (g: Group) => act(open[g.kind] ? t("garden.hide") : t("garden.review"), () => flip(g.kind));
  // a group's line under its name, and its action
  const head = (g: Group<VaultFinding>): [string, ReactNode] => {
    switch (g.kind) {
      case "outside_home":
        return [
          t("vc.outsideSub", { kinds: outsideKinds(g.findings) }),
          admin ? act(t("vc.tidy"), tidy, !repairAll && !sheet) : lock(t("vc.outsideAdmin")),
        ];
      case "no_project":
        return [t("garden.noProjectSub"), act(t("garden.noProjectAsk"), () => setSheet("about"))];
      case "broken_link":
        return [tn("garden.brokenSub", g.n, { first: brokenLink(g.paths[0]).target, more: g.n - 1 }), review(g)];
      case "orphan":
        return [t("garden.orphanSub"), review(g)];
      case "unused_attachment":
        return [
          t("garden.unusedSub", {
            size: bytes(Number(g.findings[0]?.context) || 0, locale),
            folder: commonFolder(g.paths) || "/",
          }),
          admin ? act(t("garden.trash"), () => setSheet("trash")) : lock(t("garden.trashAdmin")),
        ];
      case "no_type":
        return [t("garden.noTypeSub"), act(t("garden.fixProps"), () => setSheet("properties"))];
      default:
        return ["", null];
    }
  };
  // a health finding's row: its path, its context (and what it names) under it, then Repair or Needs you
  const finding = (f: VaultFinding) => {
    const sub = [f.context, f.kind === "card_fields" ? f.paths.join(", ") : f.kind === "orphan_rule" ? f.paths[0] : ""]
      .filter(Boolean)
      .join(" · ");
    return (
      <div key={f.id} className="flex items-center gap-3 min-h-7 py-0.5 text-xs">
        <div className="flex-1 min-w-0 grid justify-items-start">
          {page(f.path)}
          {sub ? <span className="max-w-full truncate text-tertiary">{sub}</span> : null}
          {f.kind === "context_mismatch" ? (
            <details className="text-secondary">
              <summary className="cursor-pointer">{tn("vc.contextMismatch", f.paths.length)}</summary>
              <ul className="grid gap-0.5 mt-1 pl-4">
                {f.paths.map(p => (
                  <li key={p} className="flex min-w-0">
                    {page(p)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        {f.fix ? (
          admin ? (
            act(t("vc.repair"), () => void repair([f.id]))
          ) : null
        ) : (
          <span className="flex-none text-tertiary">{t("vc.manual")}</span>
        )}
      </div>
    );
  };
  // a garden path's row: the note (a broken link at its line, with its target), a project pick for a meeting
  const entry = (kind: string, p: string) => {
    const b = kind === "broken_link" ? brokenLink(p) : null;
    return (
      <div key={p} className="flex items-center gap-2.5 min-h-7 text-xs">
        <span className="flex-1 min-w-0 flex items-center gap-2">
          {b ? page(b.note, b.line, `${b.note}:${b.line}`) : page(p)}
          {b ? <span className="flex-none text-secondary">[[{b.target}]]</span> : null}
        </span>
        {kind === "no_project" ? (
          <Select
            className="h-6 px-2 rounded-md border border-separator bg-bg text-xs text-secondary cursor-pointer"
            aria-label={`${t("garden.pick")}: ${name(p)}`}
            options={projects}
            value=""
            empty={t("garden.pick")}
            disabled={busy}
            onChange={project =>
              project &&
              void run(async () => {
                await setAbout(p, project);
                toast(t("garden.picked", { name: name(p), project }));
              })
            }
          />
        ) : null}
      </div>
    );
  };
  const group = (g: Group<VaultFinding>) => {
    const [sub, action] = head(g);
    // Review is how broken links and unlinked notes expand, so they list nothing until it is clicked
    const reviewed = g.kind === "broken_link" || g.kind === "orphan";
    const all = open[g.kind];
    const n = all ? g.n : reviewed ? 0 : PEEK;
    return (
      <section key={g.kind} data-kind={g.kind} className="border-b border-separator last:border-b-0">
        <div className="flex items-center gap-3 min-h-11 px-2 py-1">
          <span
            className={`flex-none h-6 min-w-8 px-2 grid place-items-center rounded-full text-xs font-semibold tabular-nums ${g.kind === "outside_home" ? "bg-accent-soft text-accent-text" : "bg-fill text-label"}`}
          >
            {g.n}
          </span>
          <div className="flex-1 min-w-0 grid break-words">
            <span className="font-semibold">{g.kind in TITLE ? t(TITLE[g.kind as keyof typeof TITLE]) : g.kind}</span>
            {sub ? <span className="text-xs text-secondary">{sub}</span> : null}
          </div>
          {action}
        </div>
        {n ? (
          <div className="grid pl-14 pr-2 pb-2 -mt-1">
            {isGarden(g.kind) ? g.paths.slice(0, n).map(p => entry(g.kind, p)) : g.findings.slice(0, n).map(finding)}
            {!reviewed && g.n > PEEK ? (
              <button
                className="justify-self-start mt-1 text-xs text-secondary hover:underline cursor-pointer"
                onClick={() => flip(g.kind)}
              >
                {all ? t("garden.hide") : t("tidy.more", { n: g.n - PEEK })}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  };
  const askPaths = sheet === "about" ? paths("no_project") : sheet === "properties" ? paths("no_type") : [];
  const moves = plan ? tidySample(plan.moves, plan.moves.length) : [];
  const renamed = moves.filter(m => m.renamed).length;
  const trash = paths("unused_attachment");
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={t("vc.title", { workspace })}
        className="relative w-180 max-h-[80vh] grid grid-rows-[auto_1fr_auto] gap-3 p-5 bg-bg border border-separator rounded-xl shadow-lg text-sm text-label"
        onKeyDown={e => {
          if (e.key !== "Escape") return;
          if (sheet) setSheet(null);
          else onClose();
        }}
      >
        <div className="flex items-center gap-3 h-7">
          <h2 className="text-base font-semibold">{t("vc.heading")}</h2>
          <span className="flex-1 min-w-0 truncate text-secondary">{workspace}</span>
          {checkedAt ? (
            <span className="text-xs text-secondary">{t("garden.lastCheck", { time: checkedAt })}</span>
          ) : null}
        </div>
        <div
          ref={list}
          className={`min-h-0 overflow-y-auto grid content-start ${sheet ? "opacity-50 pointer-events-none" : ""}`}
        >
          {!found ? (
            <p className="text-secondary">{t("vc.checking")}</p>
          ) : groups.length ? (
            groups.map(group)
          ) : (
            <p className="text-secondary px-2 py-1.5">{t("vc.clean")}</p>
          )}
        </div>
        <div className={`flex items-center gap-2 pt-1 ${sheet ? "invisible" : ""}`}>
          <p className="flex-1 flex items-center gap-2 text-xs text-secondary">
            <Icon name="lock" className="glyph size-3.5" />
            {fixable.length && !admin ? t("vc.adminOnly") : t("garden.lock")}
          </p>
          <button type="button" className="btn cursor-pointer" onClick={onClose} autoFocus>
            {t("vc.close")}
          </button>
          {repairAll ? (
            <button
              className="btn btn-primary cursor-pointer disabled:opacity-50"
              disabled={busy}
              onClick={() => void repair(fixable.map(f => f.id))}
            >
              {t("vc.repairAll", { n: fixable.length })}
            </button>
          ) : null}
        </div>
        {sheet === "tidy" ? (
          <DryRunSheet
            title={t("vc.tidy")}
            summary={
              plan &&
              th("tidy.summary", {
                moves: tn("tidy.notes", plan.moves.length),
                links: tn("tidy.links", plan.links),
                inNotes: tn("tidy.notes", plan.notes),
              })
            }
            rows={moves.map(m => (
              <>
                <span className="flex-1 min-w-0 truncate text-secondary">{m.from}</span>
                <span className="text-tertiary">→</span>
                <span className="flex-1 min-w-0 truncate">{m.to}</span>
              </>
            ))}
            foot={[plan?.stay ? tn("tidy.stay", plan.stay) : "", renamed ? tn("tidy.renamed", renamed) : ""]}
            note={t("tidy.note")}
            apply={tn("tidy.apply", moves.length)}
            busy={busy}
            onCancel={() => setSheet(null)}
            onApply={() => void applyTidy()}
          />
        ) : sheet === "trash" ? (
          <DryRunSheet
            title={t("garden.trash")}
            summary={t("garden.trashSummary", { files: tn("garden.files", trash.length) })}
            rows={trash.map(p => (
              <span className="min-w-0 truncate">{p}</span>
            ))}
            note={t("garden.trashNote")}
            apply={tn("garden.trashApply", trash.length)}
            busy={busy}
            onCancel={() => setSheet(null)}
            onApply={() =>
              void run(async () => {
                await trashPages(trash, read);
                setSheet(null);
              })
            }
          />
        ) : sheet ? (
          <DryRunSheet
            title={t(`page.action.${sheet}`)}
            summary={t("garden.askSummary", { notes: tn("tidy.notes", Math.min(askPaths.length, ASK)) })}
            rows={askPaths.slice(0, ASK).map(p => (
              <span className="min-w-0 truncate">{p}</span>
            ))}
            extra={
              askPaths.length > ASK ? (
                <p className="text-xs text-secondary">{t("garden.askFirst", { n: ASK })}</p>
              ) : null
            }
            note={t("garden.askNote")}
            apply={t("garden.askApply")}
            busy={busy}
            onCancel={() => setSheet(null)}
            onApply={() => {
              setSheet(null);
              void askClaude(sheet, askPaths).then(read);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
