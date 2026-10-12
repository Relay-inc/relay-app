import { useState, type ReactNode } from "react";
import type { PluginCard as Card } from "../../../domain/plugins/types";
import type { Message } from "../../../domain/settings/types";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, CODE } from "./blocks";
import { Footer } from "./Footer";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";
import { Switch } from "./Switch";

const LABEL = "block text-[13px] leading-snug text-s-fg";
const HINT = `mt-px text-xs leading-[1.45] text-s-muted ${CODE}`;
const MONO = "mt-1 block break-all rounded-md bg-s-mutedbg px-2 py-1 font-mono text-xs leading-snug text-s-fg";

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      {hint && <p className={HINT}>{hint}</p>}
      {children}
    </div>
  );
}

/** The confirmation card of a plugin from GitHub, before anything runs: where it came from, the exact command, the install
 *  command, the secrets it asks for, whether to add it to Claude Code, and the plain warning. `update` is the card of a
 *  newer commit of an installed plugin (what changed is marked). Confirm gets the Claude Code choice. */
export function PluginCard({
  card,
  update = false,
  busy,
  message,
  onConfirm,
  onCancel,
}: {
  card: Card;
  update?: boolean;
  busy: boolean;
  message?: Message | null;
  onConfirm: (sync: boolean) => void;
  onCancel: () => void;
}) {
  const { t, th, locale } = useT();
  const [sync, setSync] = useState(false);
  const changed = (field: string) => update && card.changed.includes(field);
  const labels: Record<string, string> = {
    command: t("plug.command"),
    args: t("plug.args"),
    env: t("plug.env"),
    secrets: t("plug.secrets"),
    install: t("plug.cardInstall"),
  };
  const when = card.date ? new Date(card.date).toLocaleDateString(locale, { dateStyle: "medium" }) : "";
  const env = Object.entries(card.env).map(([name, value]) => `${name}=${value}`);
  return (
    <Section
      title={t(update ? "plug.cardUpdateH" : "plug.cardInstallH", { name: card.name })}
      desc={card.description ?? undefined}
      rows
      footer={
        <Footer message={message}>
          <button className={buttonClass()} disabled={busy} onClick={onCancel}>
            {t("plug.cancel")}
          </button>
          <button className={buttonClass("primary")} disabled={busy} onClick={() => onConfirm(sync)}>
            {busy ? t("plug.installing") : t(update ? "plug.cardUpdateBtn" : "plug.cardInstallBtn")}
          </button>
        </Footer>
      }
    >
      <Row label={t("plug.cardRepo")}>
        <code className={MONO}>
          {card.repo}
          {card.ref ? `@${card.ref}` : ""}
        </code>
      </Row>
      <Row label={t("plug.cardCommit")}>
        <code className={MONO}>
          {card.sha.slice(0, 7)}
          {when ? `, ${when}` : ""}
          {card.message ? `: ${card.message}` : ""}
        </code>
      </Row>
      {update && card.changed.length > 0 && (
        <p className="text-xs text-s-muted">
          {t("plug.cardChanged", { what: card.changed.map(field => labels[field] ?? field).join(", ") })}
        </p>
      )}
      <Row
        label={changed("command") || changed("args") ? `${t("plug.cardRuns")} *` : t("plug.cardRuns")}
        hint={t("plug.cardRunsHint")}
      >
        <code className={MONO}>{[card.command, ...card.args].join(" ")}</code>
        {env.length > 0 && <code className={MONO}>{env.join("\n")}</code>}
      </Row>
      {card.install && (
        <Row
          label={changed("install") ? `${t("plug.cardInstall")} *` : t("plug.cardInstall")}
          hint={t("plug.cardInstallHint")}
        >
          <code className={MONO}>{card.install}</code>
        </Row>
      )}
      <Row label={t("plug.secrets")}>
        {card.secrets.length ? (
          <code className={MONO}>{card.secrets.join(", ")}</code>
        ) : (
          <p className={HINT}>{t("plug.secretsNone")}</p>
        )}
      </Row>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="plugsync" className={LABEL}>
            {t("plug.cardClaude")}
          </label>
          <p className={HINT}>
            <Html html={th("plug.cardClaudeHint", { name: card.claude })} />
          </p>
          {card.claudeExists && (
            <p className="mt-1">
              <StatusLine level="warn">{t("plug.cardClaudeExists", { name: card.claude })}</StatusLine>
            </p>
          )}
        </div>
        <Switch id="plugsync" on={sync} onToggle={setSync} />
      </div>
      <p className="text-xs leading-[1.45] text-s-err">{t("plug.cardWarn")}</p>
    </Section>
  );
}
