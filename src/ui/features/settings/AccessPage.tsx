import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { ActionsSection } from "./ActionsSection";
import { HINT } from "./blocks";
import { PermissionsSection } from "./PermissionsSection";

/** Privacy & access: what macOS lets Relay do, and what the agents may do with the user's tools through `relay`. */
export function AccessPage({ active }: { active: boolean }) {
  const { t, th } = useT();
  return (
    <>
      <PermissionsSection active={active} />
      <div className="grid gap-4">
        <div>
          <h2 className="text-[13px] font-semibold text-s-fg">{t("access.agents")}</h2>
          <p className={HINT}>
            <Html html={th("access.agentsHelp")} />
          </p>
        </div>
        <ActionsSection ext="reminders" name={t("act.reminders")} nested />
        <ActionsSection ext="knowledge" name={t("act.knowledge")} nested />
      </div>
    </>
  );
}
