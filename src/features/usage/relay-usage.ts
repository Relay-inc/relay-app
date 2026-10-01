import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement } from "lit/decorators.js";
import { t, th, ath } from "../../core/i18n";
import { glyphSvg } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import {
  agent,
  usageAgents,
  type AgentProvider,
  type Limits,
  type LimitWindow,
  type Tally,
  type Tokens,
} from "../../domain/agents";
import { select } from "../../domain/navigation";
import { usage, openUsage, level, resetWhen, num, usd, usageSession } from "../../domain/usage";
import "./usage-meter";
import "./usage-row";

// headings: h2 per provider (or the only one), h3 for the parts
const H2 = "text-base font-semibold mb-2.5 flex items-baseline gap-2 not-first:mt-7";
const H3 = "text-sm font-semibold text-secondary mt-4 pb-1.5 border-b border-separator";
const NOTE = "text-sm text-secondary mt-2.5";
const CONVERSATION_LINK = "text-inherit no-underline cursor-default hover:text-accent";
const PROVIDER_GLYPH = "glyph w-4 h-4 self-center stroke-1";
const MAX_CONVERSATIONS = 12;

type Heading = "h2" | "h3";
type ProviderTokens = Tokens & { provider: string };

const costText = (tally: Tally) => {
  if (tally.cost > 0) return usd(tally.cost);
  return tally.total ? "–" : "";
};
const splitText = (tally: Tally) =>
  t("usage.split", {
    input: num(tally.input),
    output: num(tally.output),
    read: num(tally.cacheRead),
    write: num(tally.cacheWrite),
  });
const totalText = (tally: Tally) => (tally.total ? num(tally.total) : "–");

// a provider's own wording for a key, the key itself without a provider
const providerText = (provider: AgentProvider | undefined, key: string, values?: Record<string, string | number>) =>
  provider ? ath(provider, key, values) : key;

const usageRow = (label: unknown, today: Tally, week: Tally, title = "") =>
  html`<relay-usage-row
    today=${totalText(today)}
    todayCost=${costText(today)}
    week=${totalText(week)}
    weekCost=${costText(week)}
    title=${ifDefined(title || undefined)}
    >${label}</relay-usage-row
  >`;
const headRow = () => html`<relay-usage-row head today=${t("usage.today")} week=${t("usage.week")}></relay-usage-row>`;
const planBadge = (limits: Limits | undefined) =>
  limits?.ok && limits.plan
    ? html`<span class="text-sm font-normal text-secondary"
        >${limits.plan[0].toUpperCase() + limits.plan.slice(1)}</span
      >`
    : nothing;
const heading = (tag: Heading, content: unknown) =>
  tag === "h2" ? html`<h2 class=${H2}>${content}</h2>` : html`<h3 class=${H3}>${content}</h3>`;
const meter = (label: unknown, window: LimitWindow) => {
  const when = resetWhen(window.resets);
  return html`<relay-usage-meter
    percent=${window.pct}
    level=${level(window.pct)}
    resets=${when ? t("usage.resets", { when }) : ""}
    >${label}</relay-usage-meter
  >`;
};

const limitsOf = (id: string) => usage.limits?.find(x => x.provider === id)?.limits;

/** The usage view: per switched-on agent provider its plan or rate limits and the tokens in its local logs, today and this week, then the total over all of them. */
@customElement("relay-usage")
export class RelayUsage extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);
  // shown: tokens right away when the last read is older than a minute (renderChat did this on every draw)
  override updated() {
    openUsage();
  }

  // plan limits, or why there are none: never guessed
  private limitsBody(provider: AgentProvider | undefined, limits: Limits | undefined): TemplateResult[] {
    if (!usage.limits) return [html`<p class=${NOTE}>${providerText(provider, "limits.loading")}</p>`];
    if (!limits) return [html`<p class=${NOTE}>${providerText(provider, "off.unavailable")}</p>`];
    if (!limits.ok) return [html`<p class=${NOTE}>${providerText(provider, `off.${limits.reason}`)}</p>`];
    return limits.windows.map(window => {
      const label = provider ? ath(provider, window.label, { name: window.name ?? "" }) : window.label;
      return meter(label, window);
    });
  }

  private renderLimits(id: string, tag: Heading): TemplateResult[] {
    const provider = agent(id);
    const limits = limitsOf(id);
    const title = html`${t("usage.limits")}${tag === "h2" ? planBadge(limits) : nothing}`;
    return [heading(tag, title), ...this.limitsBody(provider, limits)];
  }

  private modelRows(provider: AgentProvider | undefined, tokens: ProviderTokens): TemplateResult[] {
    if (!tokens.models.length) return [];
    const modelName = (model: string) => (provider?.modelName ? provider.modelName(model) : model);
    return [
      html`<h3 class=${H3}>${t("usage.byModel")}</h3>`,
      ...tokens.models.map(entry => usageRow(modelName(entry.model), entry.today, entry.week, splitText(entry.week))),
    ];
  }

  private conversationRows(tokens: ProviderTokens): TemplateResult[] {
    const sessions = tokens.sessions.filter(x => x.week.total).slice(0, MAX_CONVERSATIONS);
    if (!sessions.length) return [];
    return [
      html`<h3 class=${H3}>${t("usage.byConversation")}</h3>`,
      ...sessions.map(entry => {
        const session = usageSession(entry.key, entry.sid);
        const label = session ? session.label : t("usage.otherSession", { id: entry.sid.slice(0, 8) });
        const shown = session
          ? html`<a class=${CONVERSATION_LINK} @click=${() => select(session.key)}>${label}</a>`
          : label;
        return usageRow(shown, entry.today, entry.week, splitText(entry.week));
      }),
    ];
  }

  private renderTokens(id: string, tag: Heading): TemplateResult[] {
    const provider = agent(id);
    const name = provider?.name ?? id;
    const tokens = usage.tokens?.providers.find(x => x.provider === id);
    const title = heading(tag, t("usage.tokens"));
    if (!tokens) return [title, html`<p class=${NOTE}>${usage.tokErr || providerText(provider, "tokens.reading")}</p>`];
    return [
      title,
      headRow(),
      usageRow(t("usage.all", { name }), tokens.today, tokens.week, splitText(tokens.week)),
      usageRow(t("usage.vault"), tokens.vaultToday, tokens.vaultWeek, splitText(tokens.vaultWeek)),
      ...this.modelRows(provider, tokens),
      ...this.conversationRows(tokens),
    ];
  }

  // one provider's limits and tokens. `tag`: the heading level, h2 alone (as before the providers), h3 under its name
  private renderSection(id: string, hasLimits: boolean, tag: Heading): TemplateResult[] {
    return [...(hasLimits ? this.renderLimits(id, tag) : []), ...this.renderTokens(id, tag)];
  }

  private renderProviderSection(id: string, hasLimits: boolean): TemplateResult[] {
    const provider = agent(id);
    const glyph = provider ? glyphSvg(provider.glyph, PROVIDER_GLYPH) : nothing;
    return [
      html`<h2 class=${H2}>${glyph}${provider?.name ?? id}${planBadge(limitsOf(id))}</h2>`,
      ...this.renderSection(id, hasLimits, "h3"),
    ];
  }

  private renderCombined(tokens: NonNullable<typeof usage.tokens>): TemplateResult[] {
    return [
      html`<h2 class=${H2}>${t("usage.combined")}</h2>`,
      headRow(),
      usageRow(t("usage.combined"), tokens.today, tokens.week, splitText(tokens.week)),
    ];
  }

  private renderEstimateNote(tokens: NonNullable<typeof usage.tokens>) {
    const unpricedCount = tokens.week.unpriced;
    const unpriced = unpricedCount ? " " + t("usage.unpriced", { n: num(unpricedCount) }) : "";
    return html`<p class=${NOTE}>${th("usage.estimate")}${unpriced}</p>`;
  }

  override render() {
    const agents = usageAgents();
    if (!agents.length) return html`<div class="max-w-2xl"><p class=${NOTE}>${th("usage.none")}</p></div>`;
    const tokens = usage.tokens;
    // one provider: the view as it always was; several: a section per provider, then the total
    const sections =
      agents.length === 1
        ? this.renderSection(agents[0].id, agents[0].limits, "h2")
        : [
            ...agents.flatMap(entry => this.renderProviderSection(entry.id, entry.limits)),
            ...(tokens ? this.renderCombined(tokens) : []),
          ];
    return html`<div class="max-w-2xl">${sections}${tokens ? this.renderEstimateNote(tokens) : nothing}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-usage": RelayUsage;
  }
}
