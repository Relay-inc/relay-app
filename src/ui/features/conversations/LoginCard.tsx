import { useState } from "react";
import { useConversationsStore } from "../../../application/conversations/store";
import { signIn } from "../../../application/conversations/actions";
import { useNavigationStore } from "../../../application/navigation/store";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** A turn the agent refused because nobody is signed in: what happened in plain words and a button that starts the
 *  agent's own login, which opens the sign-in page in the browser. A conversation on a work machine runs on that
 *  machine's login, so it says where to sign in instead. */
export function LoginCard() {
  const { t } = useT();
  const key = useNavigationStore(s => s.selected);
  const machine = useConversationsStore(s => s.machines[key]?.machine);
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const start = async () => {
    setPhase("busy");
    setError("");
    try {
      await signIn(key);
      setPhase("done");
    } catch (failure) {
      setError(String(failure));
      setPhase("idle");
    }
  };
  return (
    <div className="flex flex-col gap-2.5 border border-separator rounded-lg px-3.5 py-3 text-sm">
      <div className="flex items-center gap-3">
        <Icon
          name={phase === "done" ? "check" : "lock"}
          className={`glyph size-4 flex-none ${phase === "done" ? "text-ok stroke-2" : "text-secondary"}`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-label">{t(phase === "done" ? "login.done" : "login.title")}</div>
          <div className="text-secondary">
            {phase === "done"
              ? t("login.doneHelp")
              : machine
                ? t("login.machine", { machine })
                : t(phase === "busy" ? "login.waiting" : "login.help")}
          </div>
        </div>
        {machine || phase === "done" ? null : (
          <button className="btn btn-primary flex-none disabled:opacity-50" disabled={phase === "busy"} onClick={start}>
            {t(phase === "busy" ? "login.busy" : "login.button")}
          </button>
        )}
      </div>
      {error ? <div className="text-late text-[13px]">{error}</div> : null}
    </div>
  );
}
