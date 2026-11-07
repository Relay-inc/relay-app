import { tidySample, type TidyPlan } from "../../../domain/workspace/tidy";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";

const SAMPLE = 6;

/** The dry run of Tidy structure over the workspace check: what it would move and rewrite, a sample of from → to, and
 *  Cancel / Apply. `plan` null while it is read. Nothing is written until Apply. */
export function TidySheet({
  plan,
  busy,
  onCancel,
  onApply,
}: {
  plan: TidyPlan | null;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t, th, tn } = useT();
  const total = plan?.moves.length ?? 0;
  const renamed = plan?.moves.filter(m => m.renamed).length ?? 0;
  const sample = plan ? tidySample(plan.moves, SAMPLE) : [];
  const rest = [
    total > sample.length ? t("tidy.more", { n: total - sample.length }) : "",
    plan?.stay ? tn("tidy.stay", plan.stay) : "",
  ].filter(Boolean);
  return (
    <div
      role="dialog"
      aria-label={t("vc.tidy")}
      className="absolute top-13 inset-x-5 grid gap-3 px-5 py-4 bg-bg rounded-b-xl shadow-lg border border-separator text-sm text-label"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">{t("vc.tidy")}</h3>
        <span className="h-5 inline-flex items-center px-2 rounded-md border border-dashed border-soon text-soon text-xs font-semibold uppercase tracking-wider">
          {t("tidy.dryRun")}
        </span>
      </div>
      {!plan ? (
        <p className="text-secondary">{t("tidy.reading")}</p>
      ) : (
        <>
          <Html
            as="p"
            html={th("tidy.summary", {
              moves: tn("tidy.notes", total),
              links: tn("tidy.links", plan.links),
              inNotes: tn("tidy.notes", plan.notes),
            })}
          />
          <div className="border border-separator rounded-lg overflow-hidden font-mono text-xs">
            {sample.map(m => (
              <div
                key={m.from}
                className="flex items-center gap-2 h-7.5 px-3 border-t border-separator first:border-t-0"
              >
                <span className="flex-1 min-w-0 truncate text-secondary">{m.from}</span>
                <span className="text-tertiary">→</span>
                <span className="flex-1 min-w-0 truncate">{m.to}</span>
              </div>
            ))}
            {rest.length || renamed ? (
              <div className="grid gap-0.5 px-3 py-1.5 border-t border-separator font-sans text-secondary">
                {rest.length ? <span>{rest.join(" · ")}</span> : null}
                {renamed ? <span>{tn("tidy.renamed", renamed)}</span> : null}
              </div>
            ) : null}
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-secondary">{t("tidy.note")}</p>
        <button type="button" className="btn cursor-pointer" onClick={onCancel}>
          {t("pages.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary cursor-pointer disabled:opacity-50"
          disabled={busy || !plan || !total}
          onClick={onApply}
        >
          {tn("tidy.apply", total)}
        </button>
      </div>
    </div>
  );
}
