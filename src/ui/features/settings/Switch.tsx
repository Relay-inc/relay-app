import { useEffect, useRef } from "react";

/** A switch, 32×20: on is the accent, off a filled track, the thumb white. The box keeps what
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
      className="relative m-0 h-5 w-8 flex-none cursor-default appearance-none rounded-full bg-fill-2 transition-colors duration-150 ease-out after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgba(0,0,0,.25)] after:transition-transform after:duration-150 after:ease-out checked:bg-accent checked:after:translate-x-3 focus-visible:ring-3 ring-s-ring focus-visible:outline-none"
    />
  );
}
