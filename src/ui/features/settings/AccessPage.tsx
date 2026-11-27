import { AccessTable } from "./AccessTools";
import { PermissionsSection } from "./PermissionsSection";

/** Privacy & access: what macOS lets Relay do, and what agents may do with the user's tools through `relay`. */
export function AccessPage({ active }: { active: boolean }) {
  return (
    <>
      <PermissionsSection active={active} />
      <AccessTable />
    </>
  );
}
