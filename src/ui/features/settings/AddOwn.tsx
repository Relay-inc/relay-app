import { useState } from "react";
import { recogniseLine } from "../../../domain/settings/servers";
import { openAdd, pairOwnMachine, setAddStep } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT } from "./blocks";
import { ConnectHelp } from "./ConnectHelp";
import { MachineSetup } from "./MachineSetup";
import { Steps } from "./Steps";

const LABEL = "text-[13px] font-medium text-s-fg";

/** A machine of your own: where it runs (the compose commands of docs/relay-server.md for the kind of machine and the
 *  folder, or the Relay app on a second Mac), then pairing it with the line its relay-server printed. */
export function AddOwn() {
  const { t } = useT();
  const step = useSettingsStore(s => s.serversPage.step);
  const version = useSettingsStore(s => s.machinesPage.setup?.version ?? "");
  return (
    <>
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-s-fg">{t("srv.ownMachine")}</h1>
          <button className={buttonClass("ghost")} onClick={() => openAdd()}>
            {t("mc.cancel")}
          </button>
        </div>
        <Steps steps={[t("srv.stepFor"), t("srv.stepWhere"), t("srv.stepPair")]} at={step} />
      </header>
      {step === 3 ? (
        <Pair />
      ) : (
        <>
          <section className="grid gap-2 rounded-xl border border-s-border bg-raised px-3.5 py-3">
            <h2 className="text-[13px] font-semibold text-s-fg">{t("srv.youNeed")}</h2>
            <ul className="grid list-disc gap-1 pl-4 text-xs text-s-fg">
              <li>{t("srv.needBox")}</li>
              <li>{t("srv.needDocker")}</li>
              <li>{t("srv.needPort")}</li>
              <li>{t("srv.needHttpsOwn")}</li>
              {version ? <li>{t("srv.needVersion", { version })}</li> : null}
            </ul>
          </section>
          <MachineSetup open />
          <div className="flex items-center justify-end gap-2">
            <button className={buttonClass("ghost")} onClick={() => openAdd()}>
              {t("srv.back")}
            </button>
            <button className={buttonClass("primary")} onClick={() => setAddStep(3)}>
              {t("srv.haveLine")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Step 3: the pairing line, a name, and whether the machine only keeps workspaces, with what that means. A line of
 *  another kind (an invite) says to use Join. */
function Pair() {
  const { t, th } = useT();
  const pairing = useSettingsStore(s => s.machinesPage.pairing);
  const pairError = useSettingsStore(s => s.machinesPage.pairError);
  const [line, setLine] = useState("");
  const [name, setName] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const seen = recogniseLine(line);
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <section className="grid gap-4 rounded-xl border border-s-border bg-raised px-4 py-4">
        <div className="grid gap-1.5">
          <label htmlFor="own-line" className={LABEL}>
            {t("mc.line")}
          </label>
          <textarea
            id="own-line"
            className={`${FIELD} h-auto w-full py-1.5 font-mono text-xs`}
            rows={2}
            spellCheck={false}
            placeholder="relay://192.168.1.2:47800#fp=…&code=…"
            value={line}
            onChange={e => setLine(e.target.value)}
          />
          <Html className={HINT} html={th("mc.lineHelp")} />
          {seen?.kind === "pairing" ? (
            <span className="flex items-center gap-1.5 text-xs text-s-ok">
              <Icon name="check" className="glyph size-3.5 stroke-2" />
              {t("srv.seenPairing", { host: seen.host })}
            </span>
          ) : seen ? (
            <span className="flex flex-wrap items-center gap-2 text-xs text-s-warn">
              {t("srv.seenNotPairing")}
              <button className={buttonClass("ghost")} onClick={() => openAdd("join")}>
                {t("srv.joinTitle")}
              </button>
            </span>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="own-name" className={LABEL}>
            {t("mc.name")}
          </label>
          <input
            id="own-name"
            className={`${FIELD} w-80`}
            placeholder={t("mc.namePh")}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={sharedOnly}
            onChange={e => setSharedOnly(e.target.checked)}
          />
          <span className="grid gap-0.5">
            <span className="text-[13px] text-s-fg">{t("mc.sharedOnly")}</span>
            <span className="text-xs text-s-muted">{t("srv.sharedOnlyHelp")}</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {pairError ? <span className={ERROR_MESSAGE}>{pairError}</span> : null}
          <span className="flex-1" />
          <button className={buttonClass("ghost")} onClick={() => setAddStep(2)}>
            {t("srv.back")}
          </button>
          <button
            className={buttonClass("primary")}
            disabled={pairing || seen?.kind !== "pairing"}
            onClick={() => void pairOwnMachine(line.trim(), name.trim(), sharedOnly)}
          >
            {pairing ? t("mc.pairing") : t("mc.pair")}
          </button>
        </div>
        <ConnectHelp />
      </section>
      <section className="grid gap-3 rounded-xl border border-s-border bg-raised px-3.5 py-3">
        <h2 className="text-[13px] font-semibold text-s-fg">{t("srv.afterPairing")}</h2>
        {sharedOnly ? (
          <p className="text-xs text-s-muted">{t("srv.afterShared")}</p>
        ) : (
          <>
            <Note title={t("srv.afterMirror")} text={t("srv.afterMirrorHelp")} />
            <Note title={t("srv.afterConversations")} text={t("srv.afterConversationsHelp")} />
            <Note title={t("srv.afterLogin")} text={t("srv.afterLoginHelp")} />
          </>
        )}
        <Note title={t("srv.afterLater")} text={t("srv.afterLaterHelp")} />
      </section>
    </div>
  );
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs font-medium text-s-fg">{title}</span>
      <span className="text-xs text-s-muted">{text}</span>
    </div>
  );
}
