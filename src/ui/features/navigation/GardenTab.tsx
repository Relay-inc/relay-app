import { useState } from "react";
import { askClaude, setAbout, workspaceProjects, type VaultFinding } from "../../../application/workspace/check";
import { toast } from "../../../application/navigation/navigation";
import { openPageAtLine, trashPages } from "../../../application/navigation/pages";
import { activeFolder } from "../../../application/navigation/workspaces";
import { brokenLink, bytes, commonFolder, gardenRows, type GardenRow } from "../../../domain/workspace/garden";
import { outsideKinds } from "../../../domain/workspace/tidy";
import { useT } from "../../hooks/useT";
import { Select } from "../../components/Select";
import { GardenSheet } from "./GardenSheet";

// what Ask Claude takes in one run (garden_ask in lib.rs)
const ASK = 20;
// the meetings listed under their row before Show all
const PEEK = 3;
const Lock = ({ text }: { text: string }) => <span className="flex-none text-xs text-tertiary">{text}</span>;
const Act = ({
  label,
  onClick,
  filled = false,
  busy,
}: {
  label: string;
  onClick: () => void;
  filled?: boolean;
  busy: boolean;
}) => (
  <button
    className={`btn flex-none cursor-pointer disabled:opacity-50 ${filled ? "btn-primary" : ""}`}
    disabled={busy}
    onClick={onClick}
  >
    {label}
  </button>
);
type Sheet = { kind: "trash" } | { kind: "ask"; action: "properties" | "about" };

/** The Garden tab of the vault check: where the notes decay, a count and one action per finding. Tidy structure is the
 *  dialog's (its own dry run); Move to trash and Ask Claude have theirs here. The one filled button is the first row's
 *  action, and only while no sheet is open on top. `reload` reads the findings again after an action. */
export function GardenTab({
  found,
  admin,
  tidying,
  onTidy,
  onClose,
  reload,
}: {
  found: VaultFinding[];
  admin: boolean;
  tidying: boolean;
  onTidy: () => void;
  onClose: () => void;
  reload: () => Promise<unknown>;
}) {
  const { t, tn, locale } = useT();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const rows = gardenRows(found);
  const primary = !tidying && !sheet;
  const flip = (kind: string) => setOpen(o => ({ ...o, [kind]: !o[kind] }));
  const projects = workspaceProjects();
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
      await reload();
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };
  const name = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");
  const note = (p: string, line = 1, label = p) => (
    <button
      className="min-w-0 truncate text-left font-mono text-xs text-accent-text hover:underline cursor-pointer"
      onClick={() => {
        void openPageAtLine(activeFolder(), p, line);
        onClose();
      }}
    >
      {label}
    </button>
  );
  const row = (r: GardenRow<VaultFinding>) => {
    const first = r.paths[0] ?? "";
    switch (r.kind) {
      case "outside_home":
        return [
          t("vc.outsideTitle"),
          t("vc.outsideSub", { kinds: outsideKinds(r.findings) }),
          admin ? (
            <Act label={t("vc.tidy")} onClick={onTidy} filled={primary} busy={busy} />
          ) : (
            <Lock text={t("vc.outsideAdmin")} />
          ),
        ] as const;
      case "no_project":
        return [
          t("garden.noProjectTitle"),
          t("garden.noProjectSub"),
          <Act
            label={t("garden.noProjectAsk")}
            onClick={() => setSheet({ kind: "ask", action: "about" })}
            busy={busy}
          />,
        ] as const;
      case "broken_link":
        return [
          t("garden.brokenTitle"),
          tn("garden.brokenSub", r.n, { first: brokenLink(first).target, more: r.n - 1 }),
          <Act label={open[r.kind] ? t("garden.hide") : t("garden.review")} onClick={() => flip(r.kind)} busy={busy} />,
        ] as const;
      case "orphan":
        return [
          t("garden.orphanTitle"),
          t("garden.orphanSub"),
          <Act label={open[r.kind] ? t("garden.hide") : t("garden.review")} onClick={() => flip(r.kind)} busy={busy} />,
        ] as const;
      case "unused_attachment":
        return [
          t("garden.unusedTitle"),
          t("garden.unusedSub", {
            size: bytes(Number(r.findings[0]?.context) || 0, locale),
            folder: commonFolder(r.paths) || "/",
          }),
          admin ? (
            <Act label={t("garden.trash")} onClick={() => setSheet({ kind: "trash" })} busy={busy} />
          ) : (
            <Lock text={t("garden.trashAdmin")} />
          ),
        ] as const;
      case "no_type":
        return [
          t("garden.noTypeTitle"),
          t("garden.noTypeSub"),
          <Act
            label={t("garden.fixProps")}
            onClick={() => setSheet({ kind: "ask", action: "properties" })}
            busy={busy}
          />,
        ] as const;
    }
  };
  const items = (r: GardenRow<VaultFinding>) => {
    if (r.kind === "no_project") {
      const shown = open[r.kind] ? r.paths : r.paths.slice(0, PEEK);
      return (
        <div className="grid gap-1 pl-14 pr-2 pb-2">
          {shown.map(p => (
            <div key={p} className="flex items-center gap-2.5 h-7.5 text-xs">
              <span className="flex-1 min-w-0 flex">{note(p, 1, name(p))}</span>
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
            </div>
          ))}
          {r.paths.length > PEEK ? (
            <button
              className="justify-self-start text-xs text-secondary hover:underline cursor-pointer"
              onClick={() => flip(r.kind)}
            >
              {open[r.kind] ? t("garden.hide") : t("tidy.more", { n: r.paths.length - PEEK })}
            </button>
          ) : null}
        </div>
      );
    }
    if (!open[r.kind] || (r.kind !== "broken_link" && r.kind !== "orphan")) return null;
    return (
      <ul className="grid gap-0.5 pl-14 pr-2 pb-2">
        {r.paths.map(p => {
          const b = r.kind === "broken_link" ? brokenLink(p) : null;
          return (
            <li key={p} className="flex items-center gap-2 min-w-0">
              {b ? note(b.note, b.line, `${b.note}:${b.line}`) : note(p)}
              {b ? <span className="flex-none text-xs text-secondary">[[{b.target}]]</span> : null}
            </li>
          );
        })}
      </ul>
    );
  };
  const paths = (kind: string) => rows.find(r => r.kind === kind)?.paths ?? [];
  const askPaths = sheet?.kind === "ask" ? paths(sheet.action === "about" ? "no_project" : "no_type") : [];
  return (
    <>
      <div className={`grid content-start ${sheet || tidying ? "opacity-50 pointer-events-none" : ""}`}>
        {rows.length ? (
          rows.map(r => {
            const [title, sub, action] = row(r)!;
            return (
              <div key={r.kind} data-garden={r.kind} className="border-b border-separator last:border-b-0">
                <div className="flex items-center gap-3 min-h-13 px-2 py-1.5">
                  <span
                    className={`flex-none h-6 min-w-8 px-2 grid place-items-center rounded-full text-xs font-semibold tabular-nums ${r.kind === "outside_home" ? "bg-accent-soft text-accent-text" : "bg-fill text-label"}`}
                  >
                    {r.n}
                  </span>
                  <div className="flex-1 min-w-0 grid break-words">
                    <span className="font-semibold">{title}</span>
                    <span className="text-xs text-secondary">{sub}</span>
                  </div>
                  {action}
                </div>
                {items(r)}
              </div>
            );
          })
        ) : (
          <p className="text-secondary px-2 py-1.5">{t("garden.clean")}</p>
        )}
      </div>
      {sheet?.kind === "trash" ? (
        <GardenSheet
          title={t("garden.trash")}
          summary={t("garden.trashSummary", { files: tn("garden.files", paths("unused_attachment").length) })}
          rows={paths("unused_attachment")}
          note={t("garden.trashNote")}
          apply={tn("garden.trashApply", paths("unused_attachment").length)}
          busy={busy}
          onCancel={() => setSheet(null)}
          onApply={() =>
            void run(async () => {
              await trashPages(paths("unused_attachment"));
              // the toast with Undo sits under this dialog: close it to reach it
              onClose();
            })
          }
        />
      ) : null}
      {sheet?.kind === "ask" ? (
        <GardenSheet
          title={t(`page.action.${sheet.action}`)}
          summary={t("garden.askSummary", { notes: tn("tidy.notes", Math.min(askPaths.length, ASK)) })}
          rows={askPaths.slice(0, ASK)}
          extra={
            askPaths.length > ASK ? <p className="text-xs text-secondary">{t("garden.askFirst", { n: ASK })}</p> : null
          }
          note={t("garden.askNote")}
          apply={t("garden.askApply")}
          busy={busy}
          onCancel={() => setSheet(null)}
          onApply={() => {
            const action = sheet.action;
            setSheet(null);
            void askClaude(action, askPaths).then(reload);
          }}
        />
      ) : null}
    </>
  );
}
