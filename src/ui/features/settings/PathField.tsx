import { Icon } from "../../components/Icon";
import { buttonClass } from "./blocks";
import { ChangeInput } from "./ChangeInput";

// A path with its folder button inside the field, and a dot for whether the app found it. The wide one (the vault
// folder) is the path with a folder glyph, and Choose… beside it.
export function PathField({
  value,
  tip,
  placeholder = "",
  readOnly = false,
  wide = false,
  found = null,
  foundTip = "",
  pickTip,
  onInput,
  onCommit,
  onPick,
}: {
  value: string;
  /** The tooltip of the input */
  tip: string;
  placeholder?: string;
  readOnly?: boolean;
  wide?: boolean;
  /** Found (true) or missing (false), or no dot */
  found?: boolean | null;
  foundTip?: string;
  pickTip: string;
  onInput?: (value: string) => void;
  onCommit?: () => void;
  onPick: () => void;
}) {
  const input = (
    <ChangeInput
      className="h-6 min-w-0 w-auto flex-1 rounded-none border-0 bg-transparent p-0 font-mono text-[11.5px] text-s-fg placeholder:font-sans placeholder:text-s-subtle focus-visible:ring-1 ring-s-primary focus-visible:outline-none"
      value={value}
      title={tip}
      placeholder={placeholder || undefined}
      readOnly={readOnly}
      spellCheck={false}
      onInput={e => onInput?.(e.currentTarget.value)}
      onCommit={() => onCommit?.()}
    />
  );
  if (wide)
    return (
      <div className="flex w-full gap-2">
        <div className="flex h-7.5 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg bg-fill-2 px-2.5 text-xs">
          <Icon name="folder" className="size-3.5 flex-none fill-none stroke-secondary stroke-2 glyph" />
          {input}
        </div>
        <button className={buttonClass()} onClick={onPick}>
          {pickTip}
        </button>
      </div>
    );
  return (
    <div className="flex h-7 w-62.5 items-center gap-2 overflow-hidden rounded-[7px] bg-fill-2 pr-1 pl-2.5 text-xs focus-within:ring-1 ring-s-primary">
      {input}
      {found != null && (
        <span
          className={`size-[7px] flex-none rounded-full ${found ? "bg-s-ok" : "bg-s-warn"}`}
          title={foundTip}
        ></span>
      )}
      <button
        className="grid size-5 flex-none place-items-center rounded-md text-s-muted hover:bg-s-hover hover:text-s-fg focus-visible:ring-1 ring-s-primary"
        onClick={onPick}
        title={pickTip}
      >
        <Icon name="folder" className="size-3.5 fill-none stroke-current stroke-2 glyph" />
      </button>
    </div>
  );
}
