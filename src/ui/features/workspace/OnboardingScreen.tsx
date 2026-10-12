import { useState } from "react";
import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../../domain/workspace/types";
import {
  checkMapping,
  pickMapped,
  pickVault,
  saveOnboardingVault,
  startDefaultVault,
} from "../../../application/workspace/vault-setup";
import { useT } from "../../hooks/useT";
import mark from "../../assets/relay-mark.svg";

const HEADING = "text-base font-semibold mt-2.5";
const trimmed = (map: VaultMap) =>
  Object.fromEntries(Object.entries(map).map(([key, path]) => [key, path.trim()])) as VaultMap;

/** A first start offers the starter vault (Start), or a vault of one's own: pick the folder, check what the app found
 *  in it, fix the paths, and use it. What was configured before (a folder that no longer holds a vault) opens on the
 *  second, to fix or replace. */
export function OnboardingScreen({ start }: { start: VaultStatus }) {
  const { t } = useT();
  const [status, setStatusState] = useState<VaultStatus | null>(start.vault ? start : null);
  const [map, setMap] = useState<VaultMap | null>(start.vault ? { ...start.map } : null); // the paths as typed
  const [message, setMessage] = useState("");
  const [own, setOwn] = useState(Boolean(start.vault)); // a vault of one's own, instead of the starter vault
  const [offer, setOffer] = useState(false); // Start was clicked: offer the setup interview, or skip it
  const setStatus = (next: VaultStatus | null) => {
    setStatusState(next);
    setMap(next ? { ...next.map } : null);
  };

  const chooseVault = async () => {
    setMessage("");
    const picked = await pickVault();
    if (picked) setStatus(picked);
  };
  const chooseMappedPath = async (key: MapKey) => {
    setMessage("");
    setStatus(await pickMapped(status!, key, trimmed(map!)));
  };
  const checkMap = async () => setStatus(await checkMapping(status!.vault, trimmed(map!)));
  const saveVault = async () => {
    setMessage("");
    try {
      await saveOnboardingVault(status!.vault, trimmed(map!));
    } catch (err) {
      setMessage(String(err));
    }
  };
  const startDefault = async (setup: boolean) => {
    setMessage("");
    try {
      await startDefaultVault(setup);
    } catch (err) {
      setMessage(String(err));
    }
  };
  const foundClass = (found: boolean, required: boolean) => {
    if (found) return "text-secondary";
    return required ? "text-late" : "text-secondary mb-3";
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-inspector px-8 py-7 block">
      <main className="grid gap-2.5 max-w-2xl mx-auto my-10">
        <img className="block h-11 mb-4" src={mark} alt="" />
        <h2 className={HEADING}>{t("vault.welcome")}</h2>
        {own || offer ? null : (
          <>
            <div className="text-secondary mb-3">{t("vault.introDefault")}</div>
            <div className="flex gap-2 items-center justify-end">
              <button className="btn" onClick={() => setOwn(true)}>
                {t("vault.haveOwn")}
              </button>
              <button className="btn btn-primary" onClick={() => setOffer(true)}>
                {t("vault.start")}
              </button>
            </div>
          </>
        )}
        {offer ? (
          <>
            <h2 className={HEADING}>{t("vault.setupTitle")}</h2>
            <div className="text-secondary mb-3">{t("vault.setupIntro")}</div>
            <div className="flex gap-2 items-center justify-end">
              {message ? <span className="text-late text-sm">{message}</span> : null}
              <button className="btn mr-auto" onClick={() => setOffer(false)}>
                {t("vault.back")}
              </button>
              <button className="btn" onClick={() => startDefault(false)}>
                {t("vault.setupSkip")}
              </button>
              <button className="btn btn-primary" onClick={() => startDefault(true)}>
                {t("vault.setupStart")}
              </button>
            </div>
          </>
        ) : null}
        {own ? <div className="text-secondary mb-3">{t("vault.intro")}</div> : null}
        {own ? (
          <div className="flex gap-2 items-center">
            <input
              className="field flex-1 font-mono"
              readOnly
              value={status?.vault ?? ""}
              placeholder={t("vault.none")}
            />
            <button className={`btn ${status ? "" : "btn-primary"}`} onClick={chooseVault}>
              {t("vault.choose")}
            </button>
          </div>
        ) : null}
        {status && map ? (
          <>
            <h2 className={HEADING}>{t("vault.map")}</h2>
            <div className="text-secondary mb-3">{t("vault.mapHelp")}</div>
            <div className="grid gap-2.5">
              {KEYS.map(([key, , required]) => {
                const found = status.found[key];
                return (
                  <div key={key} className="grid gap-1">
                    <div className="font-medium">
                      {t(`vault.k.${key}`)}
                      {required ? null : (
                        <>
                          {" "}
                          <span className="text-secondary tabular-nums">{t("vault.optional")}</span>
                        </>
                      )}
                      <div className="text-secondary mb-3">{t(`vault.h.${key}`)}</div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        className="field flex-1 font-mono"
                        value={map[key]}
                        onChange={e => setMap({ ...map, [key]: e.target.value })}
                        // checked when the field is committed, as the native change event did
                        onBlur={() => map[key] !== status.map[key] && checkMap()}
                        onKeyDown={e => e.key === "Enter" && checkMap()}
                        spellCheck={false}
                      />
                      <button className="btn" onClick={() => chooseMappedPath(key)}>
                        {t("vault.pickPath")}
                      </button>
                      <span className={`min-w-13 text-xs ${foundClass(found, required)}`}>
                        {found ? t("vault.found") : t("vault.missing")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        {status && !status.ok ? <div className="text-late text-sm">{t("vault.invalid")}</div> : null}
        {own ? (
          <div className="flex gap-2 items-center justify-end">
            {message ? <span className="text-late text-sm">{message}</span> : null}
            {start.vault ? null : (
              <button className="btn" onClick={() => setOwn(false)}>
                {t("vault.back")}
              </button>
            )}
            <button className="btn btn-primary" disabled={!status?.ok} onClick={saveVault}>
              {t("vault.use")}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
