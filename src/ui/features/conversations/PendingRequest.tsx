import { useState } from "react";
import type { CardChoice, Pending } from "../../../domain/conversations/types";
import { answer } from "../../../application/conversations/actions";
import { PermissionCard } from "../../components/PermissionCard";

/** A permission card or question that answers itself: busy while the answer goes out, usable again when it fails
 *  (the error shows above it) or a question had nothing answered. */
export function PendingRequest({ request, where = "" }: { request: Pending; where?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const decide = async (choice: CardChoice) => {
    setBusy(true);
    try {
      await answer(request, choice);
      setErr("");
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };
  return (
    <>
      {err ? <div className="err-box">{err}</div> : null}
      <PermissionCard request={request} where={where} busy={busy} onAnswer={decide} />
    </>
  );
}
