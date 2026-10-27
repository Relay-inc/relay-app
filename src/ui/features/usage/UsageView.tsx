import { useEffect, useState, type ReactNode } from "react";
import type { Limits, Tally, Tokens } from "../../../domain/agents/types";
import { esc } from "../../../shared/html";
import { agent } from "../../../shared/plugins";
import { usageAgents } from "../../../application/agents/agents";
import { select } from "../../../application/navigation/navigation";
import { useUsageStore } from "../../../application/usage/store";
import { level, mostConstrained } from "../../../domain/usage/rules";
import { num, openUsage, resetWhen, usageSession, usd } from "../../../application/usage/usage";
import { Glyph } from "../../components/Glyph";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { DOT, UsageBar, UsageMeter } from "./UsageMeter";
import { UsageRow } from "./UsageRow";
import { VaultUsage } from "./VaultUsage";
import { Segmented } from "../settings/Segmented";

const CARD = "flex flex-col rounded-xl border border-separator bg-raised";
const LABEL = "m-0 text-[11px] font-semibold tracking-wider uppercase text-tertiary";
const BIG = "text-2xl font-semibold tracking-tight tabular-nums";
const H4 = "text-xs font-semibold text-secondary mb-1.5";
const NOTE = "text-sm text-secondary";
const CONVERSATION_LINK = "text-inherit no-underline cursor-default hover:text-accent-text text-left truncate";
// a colour per provider in the totals' split bar, and per model in the details
const SWATCH = ["bg-accent", "bg-ctx-p", "bg-ctx-m", "bg-ctx-a"];
const MAX_CONVERSATIONS = 12;

type Format = {
  row: (key: string, label: ReactNode, today: Tally, week: Tally, strong?: boolean) => ReactNode;
  head: ReactNode;
};

/** The usage view: AI usage (the agents' limits and tokens) and Vault usage (what their tool calls did in the vault)
 *  as two tabs. */
export function UsageView() {
  const { t } = useT();
  const [tab, setTab] = useState<"ai" | "vault">("ai");
  // shown: tokens (and the vault's numbers with them) right away when the last read is older than a minute
  useEffect(() => openUsage(), []);
  return (
    <div className="flex flex-col gap-5">
      <Segmented
        className="self-start"
        label={t("nav.usage")}
        options={[
          ["ai", t("usage.tabAi")],
          ["vault", t("usage.tabVault")],
        ]}
        value={tab}
        onPick={setTab}
      />
      {tab === "ai" ? <AiUsage /> : <VaultUsage />}
    </div>
  );
}

/** AI usage: a summary (the tightest limit, tokens today and this week over every agent), then a card per
 *  switched-on agent provider with its plan or rate limits and the tokens in its local logs, then the total. */
function AiUsage() {
  const { t, th, ath, locale } = useT();
  const agents = useDerived(() => usageAgents());
  const allLimits = useUsageStore(s => s.limits);
  const tokens = useUsageStore(s => s.tokens);

  if (!agents.length) return <Html as="p" className={NOTE} html={th("usage.none")} />;

  const costText = (tally: Tally) => (tally.cost > 0 ? usd(tally.cost, locale) : tally.total ? "–" : "");
  const totalText = (tally: Tally) => (tally.total ? num(tally.total, locale) : "–");
  const splitText = (tally: Tally) =>
    t("usage.split", {
      input: num(tally.input, locale),
      output: num(tally.output, locale),
      read: num(tally.cacheRead, locale),
      write: num(tally.cacheWrite, locale),
    });
  const format: Format = {
    row: (key, label, today, week, strong) => (
      <UsageRow
        key={key}
        label={label}
        today={totalText(today)}
        todayCost={costText(today)}
        week={totalText(week)}
        weekCost={costText(week)}
        title={splitText(week)}
        strong={strong}
      />
    ),
    head: <UsageRow head today={t("usage.today")} week={t("usage.week")} />,
  };

  // the tightest limit over every provider, and the totals with each provider's share
  const top = mostConstrained(allLimits);
  const topProvider = top ? agent(top.id) : undefined;
  const ids = agents.map(x => x.id);
  const total = (label: string, pick: "today" | "week") => {
    if (!tokens) return null;
    const sum = tokens[pick];
    const vault = tokens.providers.reduce((n, x) => n + x[pick === "today" ? "vaultToday" : "vaultWeek"].total, 0);
    return (
      <div className={`${CARD} gap-1.5 px-4 py-3.5`}>
        <span className={LABEL}>{label}</span>
        <span className="flex items-baseline gap-2">
          <span className={BIG}>{totalText(sum)}</span>
          <span className="text-sm text-secondary">{t("usage.tokensUnit")}</span>
        </span>
        <span className="text-xs text-secondary tabular-nums">
          {t("usage.totalNote", { cost: costText(sum) || "–", vault: totalText({ ...sum, total: vault }) })}
        </span>
        <div className="flex h-1.5 gap-0.5 rounded-xs overflow-hidden mt-auto">
          {sum.total > 0 &&
            tokens.providers.map(x => {
              const share = (x[pick].total / sum.total) * 100;
              return share > 0 ? (
                <span
                  key={x.provider}
                  className={`h-full ${SWATCH[ids.indexOf(x.provider) % SWATCH.length]}`}
                  style={{ width: `${share}%` }}
                  title={`${agent(x.provider)?.name ?? x.provider} ${Math.round(share)}%`}
                ></span>
              ) : null;
            })}
        </div>
      </div>
    );
  };
  const unpriced = tokens?.week.unpriced ? " " + t("usage.unpriced", { n: num(tokens.week.unpriced, locale) }) : "";

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {top && (
          <div className={`${CARD} gap-1.5 px-4 py-3.5`}>
            <span className={LABEL}>{t("usage.tightest")}</span>
            <span className="flex items-baseline gap-2">
              <span
                className={`${BIG} ${{ "": "", soon: "text-soon", late: "text-late" }[level(top.limitWindow.pct)]}`}
              >
                {Math.round(top.limitWindow.pct)}%
              </span>
              <span className="text-sm text-secondary">{t("usage.usedWord")}</span>
            </span>
            <UsageBar percent={top.limitWindow.pct} level={level(top.limitWindow.pct)} />
            <span className="flex items-center gap-1.5 text-xs text-secondary min-w-0">
              {topProvider && <Glyph svg={topProvider.glyph} className="glyph size-3 flex-none stroke-1" />}
              <Html
                className="min-w-0 truncate"
                html={`${esc(topProvider?.name ?? top.id)} · ${
                  topProvider
                    ? ath(topProvider, top.limitWindow.label, { name: top.limitWindow.name ?? "" })
                    : esc(top.limitWindow.label)
                }`}
              />
            </span>
          </div>
        )}
        {total(t("usage.todayAll"), "today")}
        {total(t("usage.weekAll"), "week")}
      </div>
      <div className={`grid gap-3 items-start ${agents.length > 1 ? "grid-cols-2" : ""}`}>
        {agents.map(x => (
          <ProviderCard key={x.id} id={x.id} hasLimits={x.limits} format={format} />
        ))}
      </div>
      {agents.length > 1 && tokens && (
        <div className={`${CARD} px-4 pt-3 pb-1`}>
          <UsageRow
            head
            label={<span className={LABEL}>{t("usage.combined")}</span>}
            today={t("usage.today")}
            week={t("usage.week")}
          />
          {format.row("combined", t("usage.combinedRow"), tokens.today, tokens.week, true)}
        </div>
      )}
      {tokens && <Html as="p" className={`${NOTE} text-xs max-w-160`} html={th("usage.estimate") + esc(unpriced)} />}
    </div>
  );
}

/** One provider: its name, plan and status dot, its limits, its tokens, and the breakdowns per model and per
 *  conversation folded under Details. */
function ProviderCard({ id, hasLimits, format }: { id: string; hasLimits: boolean; format: Format }) {
  const { t, tn, ath, locale } = useT();
  const [open, setOpen] = useState(false);
  const provider = agent(id);
  const name = provider?.name ?? id;
  const allLimits = useUsageStore(s => s.limits);
  const tokensError = useUsageStore(s => s.tokensError);
  const entry = useUsageStore(s => s.tokens?.providers.find(x => x.provider === id));
  const limits = allLimits?.find(x => x.provider === id)?.limits;
  // the conversations the token list names, opened on a click
  const sessions = useDerived(() =>
    Object.fromEntries((entry?.sessions ?? []).map(x => [x.sid, usageSession(x.key, x.sid)])),
  );
  // a provider's own wording for a key (markup), the key itself without a provider
  const providerText = (key: string) => (provider ? ath(provider, key) : esc(key));
  const note = (html: string) => <Html as="p" className={NOTE} html={html} />;
  const worst = limits?.ok && limits.windows.length ? level(Math.max(...limits.windows.map(w => w.pct))) : null;

  // plan limits, or why there are none: never guessed
  const limitsBody = (limits: Limits | undefined) => {
    if (!allLimits) return note(providerText("limits.loading"));
    if (!limits) return note(providerText("off.unavailable"));
    if (!limits.ok) return note(providerText(`off.${limits.reason}`));
    return limits.windows.map(w => {
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
    });
  };
  const shown = (entry?.sessions ?? []).filter(x => x.week.total).slice(0, MAX_CONVERSATIONS);
  const details = (entry: Tokens) => (
    <div className="flex flex-col gap-3.5 px-4 pt-1 pb-3.5">
      {entry.models.length > 0 && (
        <div className="flex flex-col">
          <span className={H4}>{t("usage.byModel")}</span>
          {entry.models.map((x, i) =>
            format.row(
              x.model,
              <span className="flex items-center gap-2 min-w-0">
                <span className={`size-2 rounded-xs flex-none ${SWATCH[i % SWATCH.length]}`}></span>
                <span className="truncate">{provider?.modelName ? provider.modelName(x.model) : x.model}</span>
              </span>,
              x.today,
              x.week,
            ),
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="flex flex-col">
          <span className={H4}>{t("usage.byConversation")}</span>
          {shown.map(x => {
            const session = sessions[x.sid];
            const label = (
              <span className="flex items-center gap-2 min-w-0">
                <Icon name={session ? "chat" : "term"} className="glyph size-3.5 flex-none text-tertiary" />
                {session ? (
                  <button className={CONVERSATION_LINK} onClick={() => select(session.key)}>
                    {session.label}
                  </button>
                ) : (
                  <span className="truncate text-secondary">{t("usage.otherSession", { id: x.sid.slice(0, 8) })}</span>
                )}
              </span>
            );
            return format.row(x.sid, label, x.today, x.week);
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <span className="size-6.5 rounded-md bg-fill-2 grid place-items-center text-label">
          {provider && <Glyph svg={provider.glyph} className="glyph size-4 stroke-1" />}
        </span>
        <span className="text-sm font-semibold">{name}</span>
        {limits?.ok && limits.plan && (
          <span className="h-5 px-1.5 rounded-md bg-fill-2 text-secondary text-[11px] font-medium inline-flex items-center">
            {limits.plan[0].toUpperCase() + limits.plan.slice(1)}
          </span>
        )}
        <span className="flex-1"></span>
        {worst !== null && (
          <span
            className={`size-2.5 rounded-full ${DOT[worst]}`}
            title={t(worst ? "usage.nearLimit" : "usage.withinLimits")}
          ></span>
        )}
      </div>
      {hasLimits && (
        <div className="flex flex-col gap-3 px-4 pt-3 pb-3.5">
          <span className={LABEL}>{t("usage.limits")}</span>
          {limitsBody(limits)}
        </div>
      )}
      <div className="flex flex-col px-4 pt-3 pb-1 border-t border-separator">
        <span className={`${LABEL} mb-2`}>{t("usage.tokens")}</span>
        {entry ? (
          <>
            {format.head}
            {format.row("all", t("usage.all", { name }), entry.today, entry.week)}
            {format.row("vault", t("usage.vault"), entry.vaultToday, entry.vaultWeek)}
          </>
        ) : (
          <div className="pb-3">{note(tokensError ? esc(tokensError) : providerText("tokens.reading"))}</div>
        )}
      </div>
      {entry && (entry.models.length > 0 || shown.length > 0) && (
        <>
          <button
            className="flex items-center gap-1.5 h-9 mx-2 mb-1.5 px-2 rounded-md text-xs font-medium text-secondary hover:bg-fill hover:text-label"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon
              name="right"
              className={`glyph size-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            />
            {t("usage.details")}
            <span className="font-normal text-tertiary">
              · {tn("usage.models", entry.models.length)}, {tn("usage.conversations", shown.length)}
            </span>
          </button>
          {open && details(entry)}
        </>
      )}
    </div>
  );
}
