import { useWorkspaceStore } from "../../../application/workspace/store";
import { OnboardingScreen } from "./OnboardingScreen";

/** The welcome screen over the window, while the workspace store's `onboarding` is set (first launch, or a vault
 *  that is gone). Saving the vault clears it. */
export function WorkspaceView() {
  const start = useWorkspaceStore(s => s.onboarding);
  return start ? <OnboardingScreen start={start} /> : null;
}
