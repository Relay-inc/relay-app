import { useState } from "react";
import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../../domain/workspace/types";
import { checkMapping, newVault, pickMapped, pickVault, saveOnboardingVault } from "../../../application/workspace/vault-setup";
import { useT } from "../../hooks/useT";
import mark from "../../assets/relay-mark.svg";

const HEADING = "text-base font-semibold mt-2.5";
const trimmed = (map: VaultMap) =>
  Object.fromEntries(Object.entries(map).map(([key, path]) => [key, path.trim()])) as VaultMap;

/** Pick a vault folder, check what the app found in it, fix the paths, and use it. What was configured before (a
 *  folder that no longer holds a vault) stays visible, to fix or replace. */
export function OnboardingScreen({ start }: { start: VaultStatus }) {
  const { t } = useT();
  const [status, setStatusState] = useState<VaultStatus | null>(start.vault ? start : null);
  const [map, setMap] = useState<VaultMap | null>(start.vault ? { ...start.map } : null); // the paths as typed
  const [message, setMessage] = useState("");
  const setStatus = (next: VaultStatus | null) => {
    setStatusState(next);
    setMap(next ? { ...next.map } : null);
  };

  const chooseVault = async () => {
    setMessage("");
    const picked = await pickVault();
    if (picked) setStatus(picked);
  };
  const startVault = async (elsewhere: boolean) => {
    setMessage("");
    try {
      const made = await newVault(elsewhere);
      if (made) setStatus(made);
    } catch (err) {
      setMessage(String(err));
    }
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
  const foundClass = (found: boolean, required: boolean) => {
    if (found) return "text-secondary";
    return required ? "text-late" : "text-secondary";
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-inspector px-8 py-7 block">
      <main className="grid gap-2.5 max-w-2xl mx-auto my-10">
        <img className="block h-11 mb-4" src={mark} alt="" />
        <h2 className={HEADING}>{t("vault.welcome")}</h2>
        <div className="text-secondary mb-3">{t("vault.intro")}</div>
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
        <div className="flex gap-2 items-center text-secondary">
          <span className="flex-1">{t("vault.newHelp")}</span>
          <button className="btn" onClick={() => startVault(false)}>
            {t("vault.new")}
          </button>
          <button className="btn" onClick={() => startVault(true)}>
            {t("vault.newElsewhere")}
          </button>
        </div>
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
        <div className="flex gap-2 items-center justify-end">
          {message ? <span className="text-late text-sm">{message}</span> : null}
          <button className="btn btn-primary" disabled={!status?.ok} onClick={saveVault}>
            {t("vault.use")}
          </button>
        </div>
      </main>
    </div>
  );
}
