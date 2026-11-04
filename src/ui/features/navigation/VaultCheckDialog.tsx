import { useEffect, useState } from "react";
import {
  canRepair,
  checkWorkspace,
  gardenWorkspace,
  repairWorkspace,
  tidyApply,
  tidyPreview,
  tidyUndo,
  type TidyPlan,
  type VaultFinding,
} from "../../../application/workspace/check";
import { gardenTotal } from "../../../domain/workspace/garden";
import { openPage } from "../../../application/navigation/pages";
import { toast } from "../../../application/navigation/navigation";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { GardenTab } from "./GardenTab";
import { TidySheet } from "./TidySheet";

// what each kind of finding says; the ones about a context sit under its name, the rest under Workspace
const TEXT = {
  claude_link: "vc.claudeLink",
  missing_file: "vc.missingFile",
  orphan_rule: "vc.orphanRule",
  context_note: "vc.contextNote",
  context_rule: "vc.contextRule",
  context_heading: "vc.contextHeading",
  card_fields: "vc.cardFields",
  row_without_note: "vc.rowWithoutNote",
} as const;

/** The workspace check: what the workspace shown lacks so every member's Claude works in it, grouped by context, each
 *  with Repair when Relay can put it right (an admin's, in a shared workspace), and Repair all. A path opens as a page. */
export function VaultCheckDialog({ workspace, onClose }: { workspace: string; onClose: () => void }) {
  const { t, tn, locale } = useT();
  const [found, setFound] = useState<VaultFinding[] | null>(null);
  const [garden, setGarden] = useState<VaultFinding[] | null>(null);
  const [tab, setTab] = useState<"health" | "garden">("health");
  const [checkedAt, setCheckedAt] = useState("");
  const [busy, setBusy] = useState(false);
  // Tidy structure's dry run: open (`tidying`) with its plan once read
  const [tidying, setTidying] = useState(false);
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const read = () =>
    Promise.all([checkWorkspace(), gardenWorkspace()]).then(
      ([health, garden]) => {
        setFound(health);
        setGarden(garden);
        setCheckedAt(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
      },
      e => {
        toast(String(e));
        onClose();
      },
    );
  useEffect(() => void read(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const admin = canRepair();
  const repair = async (ids: string[]) => {
    setBusy(true);
    try {
      const n = await repairWorkspace(ids);
      toast(tn("vc.repaired", n));
      await read();
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };
  const tidy = () => {
    setTidying(true);
    setPlan(null);
    tidyPreview().then(setPlan, e => {
      toast(String(e));
      setTidying(false);
    });
  };
  const applyTidy = async () => {
    setBusy(true);
    try {
      const done = await tidyApply();
      toast(tn("tidy.done", done.moves.length), () => {
        void tidyUndo()
          .then(() => toast(t("tidy.undone")))
          .catch(e => toast(String(e)));
      });
      setTidying(false);
      await read();
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };
  const fixable = (found ?? []).filter(f => f.fix);
  const groups = [...new Set((found ?? []).map(f => f.context))].sort((a, b) =>
    !a ? -1 : !b ? 1 : a.localeCompare(b),
  );
  const path = (p: string) =>
    /\.md$/i.test(p) ? (
      <button
        className="font-mono text-xs text-accent-text hover:underline cursor-pointer"
        onClick={() => {
          openPage(p);
          onClose();
        }}
      >
        {p}
      </button>
    ) : (
      <code className="font-mono text-xs">{p}</code>
    );
  const says = (f: VaultFinding) =>
    f.kind === "context_mismatch" ? (
      <details>
        <summary className="cursor-pointer">{tn("vc.contextMismatch", f.paths.length)}</summary>
        <ul className="grid gap-0.5 mt-1 pl-4">
          {f.paths.map(p => (
            <li key={p}>{path(p)}</li>
          ))}
        </ul>
      </details>
    ) : (
      <>
        {t(TEXT[f.kind as keyof typeof TEXT] ?? "vc.missingFile", {
          fields: f.paths.join(", "),
          folder: f.paths[0] ?? "",
        })}{" "}
        {path(f.path)}
      </>
    );
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
          if (tidying) setTidying(false);
          else onClose();
        }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">{t("vc.heading")}</h2>
          <span className="flex-1 min-w-0 truncate text-secondary">{workspace}</span>
          <div role="tablist" aria-label={t("vc.tabs")} className="flex p-0.5 rounded-lg bg-fill">
            {(["health", "garden"] as const).map(id => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`h-6 px-3 rounded-md cursor-pointer ${tab === id ? "bg-bg font-medium shadow-sm" : "text-secondary"}`}
                onClick={() => setTab(id)}
              >
                {t(id === "health" ? "vc.tabHealth" : "vc.tabGarden")}
                {id === "garden" && garden ? (
                  <span className="ml-1 text-xs text-secondary tabular-nums">{gardenTotal(garden)}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto grid content-start gap-3">
          {!found || !garden ? (
            <p className="text-secondary">{t("vc.checking")}</p>
          ) : tab === "garden" ? (
            <GardenTab found={garden} admin={admin} tidying={tidying} onTidy={tidy} onClose={onClose} reload={read} />
          ) : !found.length ? (
            <p className="text-secondary">{t("vc.clean")}</p>
          ) : (
            groups.map(group => (
              <section key={group || "-"} className="grid gap-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-tertiary">
                  {group || t("vc.workspace")}
                </h3>
                {found
                  .filter(f => f.context === group)
                  .map(f => (
                    <div key={f.id} data-finding={f.kind} className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 text-secondary break-words">{says(f)}</div>
                      {f.fix ? (
                        admin ? (
                          <button
                            className="btn flex-none cursor-pointer disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void repair([f.id])}
                          >
                            {t("vc.repair")}
                          </button>
                        ) : null
                      ) : (
                        <span className="flex-none text-xs text-tertiary">{t("vc.manual")}</span>
                      )}
                    </div>
                  ))}
              </section>
            ))
          )}
        </div>
        <div className={`flex items-center justify-end gap-2 pt-1 ${tidying ? "invisible" : ""}`}>
          {tab === "garden" ? (
            <p className="flex-1 flex items-center gap-2 text-xs text-secondary">
              <Icon name="lock" className="glyph size-3.5" />
              {t("garden.lock")}
              <span className="flex-1" />
              {t("garden.lastCheck", { time: checkedAt })}
            </p>
          ) : fixable.length && !admin ? (
            <p className="flex-1 text-xs text-tertiary">{t("vc.adminOnly")}</p>
          ) : null}
          <button type="button" className="btn cursor-pointer" onClick={onClose} autoFocus>
            {t("vc.close")}
          </button>
          {tab === "health" && admin && fixable.length ? (
            <button
              className="btn btn-primary cursor-pointer disabled:opacity-50"
              disabled={busy}
              onClick={() => void repair(fixable.map(f => f.id))}
            >
              {t("vc.repairAll", { n: fixable.length })}
            </button>
          ) : null}
        </div>
        {tidying ? (
          <TidySheet plan={plan} busy={busy} onCancel={() => setTidying(false)} onApply={() => void applyTidy()} />
        ) : null}
      </div>
    </div>
  );
}
