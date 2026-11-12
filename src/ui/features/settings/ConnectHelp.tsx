import { useT } from "../../hooks/useT";

const ROWS = [
  ["srv.errReach", "srv.errReachCause", "srv.errReachFix"],
  ["srv.errOlder", "srv.errOlderCause", "srv.errOlderFix"],
  ["srv.errNewer", "srv.errNewerCause", "srv.errNewerFix"],
  ["srv.errPairing", "srv.errPairingCause", "srv.errPairingFix"],
  ["srv.errInvite", "srv.errInviteCause", "srv.errInviteFix"],
  ["srv.errWorkspace", "srv.errWorkspaceCause", "srv.errWorkspaceFix"],
  ["srv.errSignIn", "srv.errSignInCause", "srv.errSignInFix"],
  ["srv.errCert", "srv.errCertCause", "srv.errCertFix"],
] as const;

/** When it does not connect: what you see, the likely cause and the fix, folded under every paste field. */
export function ConnectHelp() {
  const { t } = useT();
  return (
    <details className="group min-w-0 rounded-xl border border-s-border bg-raised">
      <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-medium text-s-fg">{t("srv.errTitle")}</summary>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-s-muted">
            <th className="px-3.5 py-1.5 font-normal">{t("srv.errSee")}</th>
            <th className="px-3.5 py-1.5 font-normal">{t("srv.errCause")}</th>
            <th className="px-3.5 py-1.5 font-normal">{t("srv.errFix")}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([see, cause, fix]) => (
            <tr key={see} className="border-t border-s-border align-top">
              <td className="px-3.5 py-2 font-medium text-s-fg">{t(see)}</td>
              <td className="px-3.5 py-2 text-s-muted">{t(cause)}</td>
              <td className="px-3.5 py-2 text-s-fg">{t(fix)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
