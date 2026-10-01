import type { VaultStatus } from "../../domain/vault-setup";
import { RelayOnboard } from "./relay-onboard";

/** The welcome screen over the main window; resolves once a vault is saved. */
export function onboard(start: VaultStatus): Promise<void> {
  const el = new RelayOnboard();
  el.start = start;
  document.body.append(el);
  return new Promise(done => el.addEventListener("saved", () => done(), { once: true }));
}
