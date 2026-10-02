import type { ReactNode } from "react";
import type { Message } from "../../../domain/settings/types";
import { useT } from "../../hooks/useT";
import { buttonClass, FOOTER_IN_ROW } from "./blocks";
import { Footer } from "./Footer";

/** The footer of something that can leave its list (an integration, an agent): Remove on the left, its text in line
 *  with the content above, then the message and the buttons on the right. */
export function RemoveFooter({
  onRemove,
  message,
  explain,
  children,
}: {
  onRemove: () => void;
  message?: Message | null;
  explain?: (error: string) => ReactNode;
  children?: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className={FOOTER_IN_ROW}>
      <button className={`${buttonClass("ghost")} -ml-3`} onClick={onRemove}>
        {t("ag.remove")}
      </button>
      <Footer message={message} explain={explain}>
        {children}
      </Footer>
    </div>
  );
}
