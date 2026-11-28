import { homeCards, type HomeRow } from "../../../application/project-home/cards";
import { project, projectName } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";

const DOT = { you: "bg-accent", fail: "bg-late", busy: "bg-soon", ok: "bg-ok" } as const;

function Row({ row }: { row: HomeRow }) {
  return (
    <button
      type="button"
      className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg text-left hover:bg-fill-2"
      onClick={row.open}
    >
      {"dot" in row.lead ? (
        <span className={`size-2 flex-none rounded-full ${DOT[row.lead.dot]}`}></span>
      ) : (
        <span className="w-10 flex-none text-xs text-secondary">{row.lead.text}</span>
      )}
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="truncate">{row.title}</span>
        {row.sub ? <span className="truncate text-xs text-secondary">{row.sub}</span> : null}
      </span>
      {row.trail?.text ? (
        <span
          className={`flex-none max-w-2/5 truncate text-xs ${row.trail.tone === "doing" ? "text-soon" : "text-secondary"}`}
        >
          {row.trail.text}
        </span>
      ) : null}
    </button>
  );
}

/** What a new conversation in a vault project shows before the first message: the project's "Left off" from
 *  work-state, and a card each for what is open in it (application/project-home/cards.ts). Reads stores only. */
export function ProjectHome({ name }: { name: string }) {
  const { t, locale } = useT();
  const cards = useDerived(() => homeCards(name));
  const known = useDerived(() => {
    const found = project(name);
    return { left: found?.summary ?? "", last: found?.last ?? "", label: projectName(name) };
  });
  const [y, m, d] = known.last.split("-").map(Number);
  const last = y && m && d ? new Date(y, m - 1, d).toLocaleDateString(locale, { day: "numeric", month: "short" }) : "";
  return (
    <div className="@container flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-xl font-semibold">{known.label}</h1>
        {known.left ? <p className="m-0 text-base leading-normal text-secondary">{known.left}</p> : null}
        {last ? <p className="m-0 text-xs text-tertiary">{t("home.last", { date: last })}</p> : null}
      </div>
      {cards.length ? (
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
          {cards.map(card => (
            <section key={card.id} className="min-w-0 flex flex-col rounded-xl border border-separator p-1.5">
              <div className="flex items-baseline justify-between px-2 py-1.5">
                <span className="font-semibold">{t(card.title)}</span>
                {card.link ? (
                  <button
                    type="button"
                    className="text-xs text-accent-text hover:underline cursor-pointer"
                    onClick={card.link.open}
                  >
                    {t(card.link.label)}
                  </button>
                ) : card.count ? (
                  <span className="text-secondary">{card.count}</span>
                ) : null}
              </div>
              {card.rows.map(row => (
                <Row key={row.key} row={row} />
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
