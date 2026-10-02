import type { ElementType } from "react";

/** A UI string with markup (`th`, `tnh`, `pth`, `ath` from useT): the app's own strings with every parameter escaped.
 *  Renders as `as` (a span by default) with the markup inside; give it the classes of the element it stands in for. */
export function Html({ html, as: Tag = "span", className }: { html: string; as?: ElementType; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
