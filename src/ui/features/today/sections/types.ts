import type { ComponentType } from "react";
import type { EntryOf, SubjectType } from "../../../../domain/today/kinds/types";
import type { useT } from "../../../hooks/useT";

/** Something else an item connects to: another item of its project, a card's conversations and PRs. */
export type Connected = { id: string; icon: string; title: string; meta: string; go: () => unknown };
/** What the detail hands the section of an item: the item, the tab open and what it connects to. */
export type SectionProps<T extends SubjectType> = { entry: EntryOf<T>; tab: string; connected: Connected[] };
type Say = ReturnType<typeof useT>["t"];
/** The detail of one kind of item: its body, the facts that its header does not say already (label and value), and
 *  what it needs from its source when it opens. */
export type SectionDef<T extends SubjectType> = {
  Body: ComponentType<SectionProps<T>>;
  facts?: (entry: EntryOf<T>, day: (iso: string) => string, t: Say) => [string, string][];
  load?: (entry: EntryOf<T>) => void;
};
