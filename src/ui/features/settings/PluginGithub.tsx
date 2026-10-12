import { useEffect, useRef, useState } from "react";
import { dropDownload, fetchPlugin, installPlugin } from "../../../application/settings/plugins";
import { useSettingsStore } from "../../../application/settings/store";
import type { PluginCard as Card } from "../../../domain/plugins/types";
import type { Message } from "../../../domain/settings/types";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { PluginCard } from "./PluginCard";
import { Section } from "./Section";

/** Add from GitHub: the repo as typed, then the card of what was downloaded; only its Install runs anything. Leaving the
 *  page with a card open throws the download away. */
export function PluginGithub({ onInstalled }: { onInstalled: (id: string) => void }) {
  const { t, th } = useT();
  const [spec, setSpec] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState<"fetch" | "install" | null>(null);
  const [error, setError] = useState<Message | null>(null);
  // an install's own failure is said under the plugin's id, like any save
  const said = useSettingsStore(s => (card ? s.pluginsPage.messages[card.id] : null));
  const open = useRef<Card | null>(null);
  useEffect(() => {
    open.current = card;
  }, [card]);
  useEffect(
    () => () => {
      if (open.current) void dropDownload(open.current);
    },
    [],
  );

  const fetch = async () => {
    setBusy("fetch");
    setError(null);
    try {
      setCard(await fetchPlugin(spec));
    } catch (e) {
      setError({ text: String(e), ok: false });
    }
    setBusy(null);
  };
  const cancel = async () => {
    if (card) await dropDownload(card);
    setCard(null);
  };
  const install = async (sync: boolean) => {
    if (!card) return;
    setBusy("install");
    const id = await installPlugin(card, sync);
    setBusy(null);
    if (id) {
      setCard(null);
      onInstalled(id);
    }
  };

  return (
    <>
      <Section
        title={t("plug.githubH")}
        desc={t("plug.githubHelp")}
        rows
        footer={
          <Footer message={error}>
            <button
              className={buttonClass("primary")}
              disabled={!spec.trim() || busy !== null || !!card}
              onClick={fetch}
            >
              {busy === "fetch" ? t("plug.fetching") : t("plug.githubFetch")}
            </button>
          </Footer>
        }
      >
        <Field label={t("plug.githubField")} id="plugrepo" hint={<Html html={th("plug.githubHint")} />}>
          <input
            className={FIELD}
            id="plugrepo"
            value={spec}
            onChange={e => setSpec(e.target.value)}
            onKeyDown={e => e.key === "Enter" && spec.trim() && !card && busy === null && void fetch()}
            placeholder="owner/repo@v1.0"
            spellCheck={false}
            autoComplete="off"
            disabled={!!card}
          />
        </Field>
      </Section>
      {card && (
        <PluginCard card={card} busy={busy === "install"} message={said} onConfirm={install} onCancel={cancel} />
      )}
    </>
  );
}
