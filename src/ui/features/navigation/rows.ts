import type { KeyboardEvent } from "react";
// What the sidebar's rows and section heads share: the drop lines and the keyboard.
export const DROP_LINE_BEFORE = "relative before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent";
export const DROP_LINE_AFTER =
  "relative before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-accent";

/** Enter or Space on a focused row clicks it, as on a button (not when the key comes from its own × or + button).
 *  Stopped here: the window would otherwise send the space on to the composer. */
export function clickOnKey(e: KeyboardEvent<HTMLElement>) {
  if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.click();
}
