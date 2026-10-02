import { useEffect, type ReactNode } from "react";
import type { AgentProvider, Limits, Tally, Tokens } from "../../../domain/agents/types";
import { esc } from "../../../shared/html";
import { agent } from "../../../shared/plugins";
import { usageAgents } from "../../../application/agents/agents";
import { select } from "../../../application/navigation/navigation";
import { useUsageStore } from "../../../application/usage/store";
import { level } from "../../../domain/usage/rules";
import { num, openUsage, resetWhen, usageSession, usd } from "../../../application/usage/usage";
import { Glyph } from "../../components/Glyph";
import { Html } from "../../components/Html";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { UsageMeter } from "./UsageMeter";
import { UsageRow } from "./UsageRow";

// headings: h2 per provider (or the only one), h3 for the parts
const H2 = "text-base font-semibold mb-2.5 flex items-baseline gap-2 not-first:mt-7";
const H3 = "text-sm font-semibold text-secondary mt-4 pb-1.5 border-b border-separator";
const NOTE = "text-sm text-secondary mt-2.5";
const CONVERSATION_LINK = "text-inherit no-underline cursor-default hover:text-accent text-left";
const PROVIDER_GLYPH = "glyph w-4 h-4 self-center stroke-1";
const DETAILS_SUMMARY = "text-sm text-secondary cursor-default py-2 list-outside ml-3.5 hover:text-label";
const MAX_CONVERSATIONS = 12;

type Heading = "h2" | "h3";
type ProviderTokens = Tokens & { provider: string };

/** The usage view: per switched-on agent provider its plan or rate limits and the tokens in its local logs, today and
 *  this week, then the total over all of them. */
export function UsageView() {
  const { t, th, ath, locale } = useT();
  const agents = useDerived(() => usageAgents());
  const allLimits = useUsageStore(s => s.limits);
  const tokens = useUsageStore(s => s.tokens);
  const tokensError = useUsageStore(s => s.tokensError);
  // the conversations the token lists name, opened on a click
  const sessions = useDerived(() =>
    Object.fromEntries(
      (tokens?.providers ?? []).flatMap(entry => entry.sessions.map(x => [x.sid, usageSession(x.key, x.sid)])),
    ),
  );
  // shown: tokens right away when the last read is older than a minute
  useEffect(() => openUsage(), []);

  const costText = (tally: Tally) => (tally.cost > 0 ? usd(tally.cost, locale) : tally.total ? "–" : "");
  const splitText = (tally: Tally) =>
    t("usage.split", {
      input: num(tally.input, locale),
      output: num(tally.output, locale),
      read: num(tally.cacheRead, locale),
      write: num(tally.cacheWrite, locale),
    });
  const totalText = (tally: Tally) => (tally.total ? num(tally.total, locale) : "–");
  // a provider's own wording for a key (markup), the key itself without a provider
  const providerText = (provider: AgentProvider | undefined, key: string, values?: Record<string, string | number>) =>
    provider ? ath(provider, key, values) : esc(key);
  const limitsOf = (id: string) => allLimits?.find(x => x.provider === id)?.limits;

  const usageRow = (key: string, label: ReactNode, today: Tally, week: Tally, title = "") => (
    <UsageRow
      key={key}
      label={label}
      today={totalText(today)}
      todayCost={costText(today)}
      week={totalText(week)}
      weekCost={costText(week)}
      title={title}
    />
  );
  const headRow = (key: string) => <UsageRow key={key} head today={t("usage.today")} week={t("usage.week")} />;
  const planBadge = (limits: Limits | undefined) =>
    limits?.ok && limits.plan ? (
      <span className="text-sm font-normal text-secondary">{limits.plan[0].toUpperCase() + limits.plan.slice(1)}</span>
    ) : null;
  const heading = (key: string, tag: Heading, content: ReactNode) =>
    tag === "h2" ? (
      <h2 key={key} className={H2}>
        {content}
      </h2>
    ) : (
      <h3 key={key} className={H3}>
        {content}
      </h3>
    );
  const note = (key: string, html: string) => <Html key={key} as="p" className={NOTE} html={html} />;

  // plan limits, or why there are none: never guessed
  const limitsBody = (id: string, provider: AgentProvider | undefined, limits: Limits | undefined) => {
    if (!allLimits) return [note(`${id}-note`, providerText(provider, "limits.loading"))];
    if (!limits) return [note(`${id}-note`, providerText(provider, "off.unavailable"))];
    if (!limits.ok) return [note(`${id}-note`, providerText(provider, `off.${limits.reason}`))];
    return limits.windows.map(limitWindow => {
      const when = resetWhen(limitWindow.resets, locale);
      return (
        <UsageMeter
          key={`${id}-window-${limitWindow.id}`}
          label={provider ? ath(provider, limitWindow.label, { name: limitWindow.name ?? "" }) : esc(limitWindow.label)}
          percent={limitWindow.pct}
          level={level(limitWindow.pct)}
          resets={when ? t("usage.resets", { when }) : ""}
        />
      );
    });
  };
  const renderLimits = (id: string, tag: Heading) => {
    const limits = limitsOf(id);
    const title = (
      <>
        {t("usage.limits")}
        {tag === "h2" && planBadge(limits)}
      </>
    );
    return [heading(`${id}-limits`, tag, title), ...limitsBody(id, agent(id), limits)];
  };

  const modelRows = (provider: AgentProvider | undefined, entry: ProviderTokens) => {
    if (!entry.models.length) return [];
    const modelName = (model: string) => (provider?.modelName ? provider.modelName(model) : model);
    return [
      heading(`${entry.provider}-models`, "h3", t("usage.byModel")),
      ...entry.models.map(x =>
        usageRow(`${entry.provider}-model-${x.model}`, modelName(x.model), x.today, x.week, splitText(x.week)),
      ),
    ];
  };
  const conversationRows = (entry: ProviderTokens) => {
    const shown = entry.sessions.filter(x => x.week.total).slice(0, MAX_CONVERSATIONS);
    if (!shown.length) return [];
    return [
      heading(`${entry.provider}-conversations`, "h3", t("usage.byConversation")),
      ...shown.map(x => {
        const session = sessions[x.sid];
        const label = session ? (
          <button className={CONVERSATION_LINK} onClick={() => select(session.key)}>
            {session.label}
          </button>
        ) : (
          t("usage.otherSession", { id: x.sid.slice(0, 8) })
        );
        return usageRow(`${entry.provider}-session-${x.sid}`, label, x.today, x.week, splitText(x.week));
      }),
    ];
  };
  // the breakdowns per model and per conversation: folded until asked for
  const details = (id: string, rows: ReactNode[]) =>
    rows.length
      ? [
          <details key={`${id}-details`}>
            <summary className={DETAILS_SUMMARY}>{t("usage.details")}</summary>
            {rows}
          </details>,
        ]
      : [];
  const renderTokens = (id: string, tag: Heading) => {
    const provider = agent(id);
    const name = provider?.name ?? id;
    const entry = tokens?.providers.find(x => x.provider === id);
    const title = heading(`${id}-tokens`, tag, t("usage.tokens"));
    if (!entry)
      return [title, note(`${id}-reading`, tokensError ? esc(tokensError) : providerText(provider, "tokens.reading"))];
    return [
      title,
      headRow(`${id}-head`),
      usageRow(`${id}-all`, t("usage.all", { name }), entry.today, entry.week, splitText(entry.week)),
      usageRow(`${id}-vault`, t("usage.vault"), entry.vaultToday, entry.vaultWeek, splitText(entry.vaultWeek)),
      ...details(id, [...modelRows(provider, entry), ...conversationRows(entry)]),
    ];
  };
  // one provider's limits and tokens. `tag`: the heading level, h2 for a single provider, h3 under its name
  const renderSection = (id: string, hasLimits: boolean, tag: Heading) => [
    ...(hasLimits ? renderLimits(id, tag) : []),
    ...renderTokens(id, tag),
  ];
  const renderProviderSection = (id: string, hasLimits: boolean) => {
    const provider = agent(id);
    return [
      <h2 key={`${id}-name`} className={H2}>
        {provider && <Glyph svg={provider.glyph} className={PROVIDER_GLYPH} />}
        {provider?.name ?? id}
        {planBadge(limitsOf(id))}
      </h2>,
      ...renderSection(id, hasLimits, "h3"),
    ];
  };

  if (!agents.length)
    return (
      <div className="max-w-2xl">
        <Html as="p" className={NOTE} html={th("usage.none")} />
      </div>
    );
  // one provider: its limits and tokens; several: a section per provider, then the total
  const sections =
    agents.length === 1
      ? renderSection(agents[0].id, agents[0].limits, "h2")
      : [
          ...agents.flatMap(entry => renderProviderSection(entry.id, entry.limits)),
          ...(tokens
            ? [
                heading("combined", "h2", t("usage.combined")),
                headRow("combined-head"),
                usageRow("combined-row", t("usage.combined"), tokens.today, tokens.week, splitText(tokens.week)),
              ]
            : []),
        ];
  const unpriced = tokens?.week.unpriced ? " " + t("usage.unpriced", { n: num(tokens.week.unpriced, locale) }) : "";
  return (
    <div className="max-w-2xl">
      {sections}
      {tokens && note("estimate", th("usage.estimate") + esc(unpriced))}
    </div>
  );
}
