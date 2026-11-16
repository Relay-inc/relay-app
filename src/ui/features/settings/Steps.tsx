import { Icon } from "../../components/Icon";

/** The numbered steps of Add a server, the ones before `at` ticked, the current one in the accent. */
export function Steps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {steps.map((name, i) => {
        const n = i + 1;
        return (
          <li key={name} className="flex items-center gap-2" aria-current={n === at ? "step" : undefined}>
            {i ? <span className="h-px w-6 bg-s-border" /> : null}
            <span
              className={`grid size-5 flex-none place-items-center rounded-full text-[11px] font-semibold ${n < at ? "bg-s-ok text-white" : n === at ? "border border-s-primary text-accent-text" : "border border-s-border text-s-muted"}`}
            >
              {n < at ? <Icon name="check" className="glyph size-3 stroke-[2.5]" /> : n}
            </span>
            <span className={`text-xs ${n === at ? "font-medium text-s-fg" : "text-s-muted"}`}>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
