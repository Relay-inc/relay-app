import { useEffect, useRef, useState } from "react";
import { checkUpdate, dropDownload, updatePlugin } from "../../../application/settings/plugins";
import { useSettingsStore } from "../../../application/settings/store";
import type { Plugin, PluginCard as Card } from "../../../domain/plugins/types";
import type { Message } from "../../../domain/settings/types";
import { useT } from "../../hooks/useT";
import { buttonClass } from "./blocks";
import { Footer } from "./Footer";
import { PluginCard } from "./PluginCard";
import { Section } from "./Section";

/** The updates of a plugin installed from GitHub: Check compares the ref's current commit with the installed one, and a
 *  newer one comes as a confirmation card (what changed in what runs is marked). Nothing updates by itself. */
export function PluginUpdate({ plugin }: { plugin: Plugin }) {
  const { t } = useT();
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState<"check" | "update" | null>(null);
  const [note, setNote] = useState<Message | null>(null);
  const said = useSettingsStore(s => s.pluginsPage.messages[plugin.id]);
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
  if (!plugin.source) return null;

  const check = async () => {
    setBusy("check");
    setNote(null);
    // a promise chain, not try/catch: the React compiler bails out on a conditional inside a try block
    await checkUpdate(plugin.id).then(
      found => {
        setCard(found);
        setNote({ text: t(found ? "plug.updatesFound" : "plug.updatesUpToDate"), ok: true });
      },
      e => setNote({ text: String(e), ok: false }),
    );
    setBusy(null);
  };
  const apply = async () => {
    if (!card) return;
    setBusy("update");
    if (await updatePlugin(card)) {
      setCard(null);
      setNote(null);
    }
    setBusy(null);
  };
  const cancel = async () => {
    if (card) await dropDownload(card);
    setCard(null);
    setNote(null);
  };
  return (
    <>
      <Section
        title={t("plug.updatesH")}
        desc={t("plug.updatesHelp", { repo: plugin.source.repo, sha: plugin.source.sha.slice(0, 7) })}
        action={
          <button className={buttonClass()} disabled={busy !== null || !!card} onClick={check}>
            {busy === "check" ? t("plug.checking") : t("plug.updatesCheck")}
          </button>
        }
        footer={!card && (note || said) ? <Footer message={note ?? said} /> : undefined}
      />
      {card && (
        <PluginCard card={card} update busy={busy === "update"} message={said} onConfirm={apply} onCancel={cancel} />
      )}
    </>
  );
}
