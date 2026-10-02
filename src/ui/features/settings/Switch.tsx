import { useEffect, useRef } from "react";

/** A switch, 28×16: on is the text colour with a light thumb, off a muted track with a dark thumb. The box keeps what
 *  was clicked until `on` changes, so a slow save does not flick it back. */
export function Switch({ id, on, onToggle }: { id: string; on: boolean; onToggle: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.checked = on;
  }, [on]);
  return (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      id={id}
      defaultChecked={on}
      onChange={e => onToggle(e.target.checked)}
      className="relative m-0 h-4 w-7 flex-none cursor-default appearance-none rounded-full border border-s-input bg-s-mutedbg transition-colors duration-150 ease-in-out after:absolute after:top-px after:left-px after:size-3 after:rounded-full after:bg-s-fg after:transition-transform after:duration-150 after:ease-in-out checked:border-transparent checked:bg-s-fg checked:after:translate-x-3 checked:after:bg-s-bg focus-visible:ring-2 ring-s-ring ring-offset-2 ring-offset-s-bg focus-visible:outline-none"
    />
  );
}
