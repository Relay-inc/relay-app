import type { ReactNode } from "react";
import { STATUS_TEXT } from "./blocks";
import { Section } from "./Section";

/** A page's section while its list is not there yet: the title and a spinner with `text`. */
export function LoadingSection({ title, text }: { title: ReactNode; text: ReactNode }) {
  return (
    <Section title={title}>
      <div className={STATUS_TEXT}>
        <span className="spinner"></span>
        {text}
      </div>
    </Section>
  );
}
