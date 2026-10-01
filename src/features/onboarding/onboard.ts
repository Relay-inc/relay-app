import type { VaultStatus } from "../../domain/vault-setup";
import { RelayOnboard } from "./relay-onboard";

/** The welcome screen over the main window; resolves once a vault is saved. */
export function onboard(start: VaultStatus): Promise<void> {
  const screen = new RelayOnboard();
  screen.start = start;
  document.body.append(screen);
  return new Promise(resolve => screen.addEventListener("saved", () => resolve(), { once: true }));
}
