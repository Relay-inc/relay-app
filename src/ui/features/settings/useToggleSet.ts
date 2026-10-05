import { useState } from "react";

/** Which rows of a list are folded open, by id. */
export function useToggleSet() {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const setOpen = (id: string, open: boolean) =>
    setOpened(current => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  return { isOpen: (id: string) => opened.has(id), setOpen, toggle: (id: string) => setOpen(id, !opened.has(id)) };
}
