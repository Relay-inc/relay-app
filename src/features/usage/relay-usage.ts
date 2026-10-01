import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement } from "lit/decorators.js";
import { t, th, ath } from "../../core/i18n";
import { glyphSvg } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { agent, usageAgents, type AgentProvider, type Limits, type LimitWindow, type Tally } from "../../domain/agents";
import { select } from "../../domain/navigation";
import { usage, openUsage, level, resetWhen, num, usd, usageSession } from "../../domain/usage";
import "./usage-meter";
import "./usage-row";

// headings: h2 per provider (or the only one), h3 for the parts
const H2 = "text-base font-semibold mb-2.5 flex items-baseline gap-2 not-first:mt-7";
const H3 = "text-sm font-semibold text-secondary mt-4 pb-1.5 border-b border-separator";
const NOTE = "text-sm text-secondary mt-2.5";

const cost = (x: Tally) => (x.cost > 0 ? usd(x.cost) : x.total ? "–" : "");
const split = (x: Tally) =>
  t("usage.split", { input: num(x.input), output: num(x.output), read: num(x.cacheRead), write: num(x.cacheWrite) });
const tok = (x: Tally) => (x.total ? num(x.total) : "–");
const pair = (label: unknown, a: Tally, b: Tally, title = "") =>
  html`<relay-usage-row
    today=${tok(a)}
    todayCost=${cost(a)}
    week=${tok(b)}
    weekCost=${cost(b)}
    title=${ifDefined(title || undefined)}
    >${label}</relay-usage-row
  >`;
const headRow = () => html`<relay-usage-row head today=${t("usage.today")} week=${t("usage.week")}></relay-usage-row>`;
const plan = (l: Limits | undefined) =>
  l?.ok && l.plan
    ? html`<span class="text-sm font-normal text-secondary">${l.plan[0].toUpperCase() + l.plan.slice(1)}</span>`
    : nothing;
const head = (hd: "h2" | "h3", c: unknown) =>
  hd === "h2" ? html`<h2 class=${H2}>${c}</h2>` : html`<h3 class=${H3}>${c}</h3>`;
const meter = (label: unknown, w: LimitWindow) => {
  const when = resetWhen(w.resets);
  return html`<relay-usage-meter pct=${w.pct} level=${level(w.pct)} resets=${when ? t("usage.resets", { when }) : ""}
    >${label}</relay-usage-meter
  >`;
};

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

  // one provider's limits and tokens. `hd`: the heading level, h2 alone (as before the providers), h3 under its name
  private section(id: string, hasLimits: boolean, hd: "h2" | "h3"): TemplateResult[] {
    const { limits, tokens, tokErr } = usage;
    const p: AgentProvider | undefined = agent(id),
      lim = limits?.find(l => l.provider === id)?.limits,
      tk = tokens?.providers.find(x => x.provider === id);
    const name = p?.name ?? id,
      pt = (k: string, x?: Record<string, string | number>) => (p ? ath(p, k, x) : k);
    const out: TemplateResult[] = [];
    // plan limits, or why there are none: never guessed
    if (hasLimits) {
      out.push(head(hd, html`${t("usage.limits")}${hd === "h2" ? plan(lim) : nothing}`));
      if (!limits) out.push(html`<p class=${NOTE}>${pt("limits.loading")}</p>`);
      else if (!lim) out.push(html`<p class=${NOTE}>${pt("off.unavailable")}</p>`);
      else if (!lim.ok) out.push(html`<p class=${NOTE}>${pt(`off.${lim.reason}`)}</p>`);
      else for (const w of lim.windows) out.push(meter(p ? ath(p, w.label, { name: w.name ?? "" }) : w.label, w));
    }
    out.push(head(hd, t("usage.tokens")));
    if (!tk) return [...out, html`<p class=${NOTE}>${tokErr || pt("tokens.reading")}</p>`];
    out.push(
      headRow(),
      pair(t("usage.all", { name }), tk.today, tk.week, split(tk.week)),
      pair(t("usage.vault"), tk.vaultToday, tk.vaultWeek, split(tk.vaultWeek)),
    );
    const mn = (m: string) => (p?.modelName ? p.modelName(m) : m);
    if (tk.models.length)
      out.push(
        html`<h3 class=${H3}>${t("usage.byModel")}</h3>`,
        ...tk.models.map(m => pair(mn(m.model), m.today, m.week, split(m.week))),
      );
    const conv = tk.sessions.filter(x => x.week.total).slice(0, 12);
    if (conv.length)
      out.push(
        html`<h3 class=${H3}>${t("usage.byConversation")}</h3>`,
        ...conv.map(x => {
          const c = usageSession(x.key, x.sid);
          const label = c ? c.label : t("usage.otherSession", { id: x.sid.slice(0, 8) });
          return pair(
            c
              ? html`<a class="text-inherit no-underline cursor-default hover:text-accent" @click=${() => select(c.key)}
                  >${label}</a
                >`
              : label,
            x.today,
            x.week,
            split(x.week),
          );
        }),
      );
    return out;
  }

  override render() {
    const on = usageAgents();
    if (!on.length) return html`<div class="max-w-2xl"><p class=${NOTE}>${th("usage.none")}</p></div>`;
    // one provider: the view as it always was; several: a section per provider, then the total
    const body: unknown[] = [],
      { limits, tokens } = usage;
    if (on.length === 1) body.push(...this.section(on[0].id, on[0].limits, "h2"));
    else {
      for (const a of on) {
        const p = agent(a.id),
          lim = limits?.find(l => l.provider === a.id)?.limits;
        body.push(
          html`<h2 class=${H2}>
            ${p ? glyphSvg(p.glyph, "glyph w-4 h-4 self-center stroke-1") : nothing}${p?.name ?? a.id}${plan(lim)}
          </h2>`,
          ...this.section(a.id, a.limits, "h3"),
        );
      }
      if (tokens)
        body.push(
          html`<h2 class=${H2}>${t("usage.combined")}</h2>`,
          headRow(),
          pair(t("usage.combined"), tokens.today, tokens.week, split(tokens.week)),
        );
    }
    if (tokens) {
      const unpricedN = tokens.week.unpriced,
        unpriced = unpricedN ? " " + t("usage.unpriced", { n: num(unpricedN) }) : "";
      body.push(html`<p class=${NOTE}>${th("usage.estimate")}${unpriced}</p>`);
    }
    return html`<div class="max-w-2xl">${body}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-usage": RelayUsage;
  }
}
