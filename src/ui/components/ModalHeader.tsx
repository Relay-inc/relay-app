import type { ReactNode } from "react";
import { useT } from "../hooks/useT";
import { Icon } from "./Icon";

// a header button: an icon with its title
const button = (name: string, title: string, onClick: () => void, disabled: boolean) => (
  <button className="btn-icon disabled:opacity-40" title={title} disabled={disabled} onClick={onClick}>
    <Icon name={name} className="glyph size-4" />
  </button>
);

/** The window's 52px header: what it shows on the left, "3 of 14" with previous/next, an optional link, close. */
export function ModalHeader({
  left,
  position,
  first,
  last,
  link,
  onStep,
  onClose,
}: {
  left: ReactNode;
  position: string;
  first: boolean;
  last: boolean;
  link?: ReactNode;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <div className="h-13 flex-none flex items-center gap-2 pl-5 pr-3 border-b border-separator">
      {left}
      <span className="flex-1"></span>
      <span className="text-xs text-tertiary tabular-nums mr-0.5">{position}</span>
      {button("left", t("kb.prev"), () => onStep(-1), first)}
      {button("right", t("kb.next"), () => onStep(1), last)}
      <span className="w-px h-4 bg-separator-strong mx-1"></span>
      {link}
      {button("close", t("kb.closeEsc"), onClose, false)}
    </div>
  );
}
