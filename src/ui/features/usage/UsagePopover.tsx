import { useRef, useState } from "react";
import type { Tally } from "../../../domain/agents/types";
import { esc } from "../../../shared/html";
import { agent } from "../../../shared/plugins";
import { useUsageStore } from "../../../application/usage/store";
import { level } from "../../../domain/usage/rules";
import { num, openUsage, resetWhen, usd } from "../../../application/usage/usage";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { DOT, UsageMeter } from "./UsageMeter";

const BTN =
  "relative flex size-7 flex-none items-center justify-center rounded-md text-secondary hover:bg-fill-2 hover:text-label transition-colors duration-150 ease-out";
const LABEL = "text-[11px] font-semibold tracking-wider uppercase text-tertiary";

/** The footer's usage button, with its status dot: a click opens a summary above it (each agent's plan limits, and
 *  the tokens today and this week over every agent), whose View details opens the usage view. The popover sits on
 *  the footer row (its positioned parent), so it lines up with the workspace menu. */
export function UsagePopover({
  selected,
  tip,
  level: dot,
  onDetails,
}: {
  selected: boolean; // the usage view is open
  tip: string; // the button's tooltip
  level: "" | "soon" | "late"; // "" shows no dot
  onDetails: () => void;
}) {
  const { t, ath, locale } = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const limits = useUsageStore(s => s.limits);
  const tokens = useUsageStore(s => s.tokens);
  const tokensLine = (label: string, tally: Tally) => (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="flex-1 min-w-0 truncate text-secondary">{label}</span>
      <span className="tabular-nums font-medium">
        {tally.total ? `${num(tally.total, locale)} ${t("usage.tokensUnit")}` : "–"}
        {tally.cost > 0 ? <span className="font-normal text-secondary"> · {usd(tally.cost, locale)}</span> : null}
      </span>
    </div>
  );
  const answered = (limits ?? []).filter(x => x.limits.ok && x.limits.windows.length);
  return (
    <div ref={root}>
      <button
        className={`${BTN} ${selected || open ? "bg-accent-soft text-accent-text!" : ""}`}
        title={tip}
        aria-label={tip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // tokens are only read while someone looks: now, when the last read is older than a minute
          if (!open) openUsage();
          setOpen(!open);
        }}
      >
        <Icon name="gauge" className="glyph size-4 flex-none" />
        <span
          className={`absolute bottom-1.25 right-1.25 size-1.5 rounded-full ring-[1.5px] ring-sidebar ${dot ? "opacity-100" : "opacity-0"} ${DOT[dot]}`}
        />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t("nav.usage")}
          className="absolute z-20 bottom-full left-2 mb-2 w-80 flex flex-col gap-3 p-3 bg-bg border border-separator rounded-xl shadow-lg"
        >
          <span className={LABEL}>{t("nav.usage")}</span>
          {answered.map(({ provider: id, limits }) => {
            const provider = agent(id);
            return limits.ok ? (
              <div key={id} className="flex flex-col gap-2.5">
                <span className="text-xs font-semibold text-secondary">{provider?.name ?? id}</span>
                {limits.windows.map(w => {
                  const when = resetWhen(w.resets, locale);
                  return (
                    <UsageMeter
                      key={w.id}
                      label={provider ? ath(provider, w.label, { name: w.name ?? "" }) : esc(w.label)}
                      percent={w.pct}
                      level={level(w.pct)}
                      resets={when ? t("usage.resets", { when }) : ""}
                    />
                  );
                })}
              </div>
            ) : null;
          })}
          {tokens ? (
            <div className={`flex flex-col gap-1 ${answered.length ? "pt-3 border-t border-separator" : ""}`}>
              {tokensLine(t("usage.today"), tokens.today)}
              {tokensLine(t("usage.week"), tokens.week)}
            </div>
          ) : null}
          <button
            className="h-7 rounded-md bg-fill-2 text-[13px] font-medium text-label hover:bg-accent hover:text-on-accent cursor-default"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            {t("usage.viewDetails")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
