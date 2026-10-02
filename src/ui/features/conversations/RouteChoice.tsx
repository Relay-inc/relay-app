import { useT } from "../../hooks/useT";

/** A general message names several projects: pick one, or keep it general (`onRoute`, the project or ""). */
export function RouteChoice({ hits, onRoute }: { hits: string[]; onRoute: (project: string) => void }) {
  const { t } = useT();
  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3">
      <div className="text-sm text-secondary">{t("route.question")}</div>
      <div className="flex flex-wrap gap-2">
        {hits.map(hit => (
          <button key={hit} className="btn" onClick={() => onRoute(hit)}>
            {hit}
          </button>
        ))}
        <button className="btn" onClick={() => onRoute("")}>
          {t("route.keep")}
        </button>
      </div>
    </div>
  );
}
