import { Icon } from "../../components/Icon";
import { ChangeInput } from "./ChangeInput";

// A path with its folder button inside the field, and a dot for whether the app found it.
// The box is content-box with 2px 4px padding: 260 × 28 is the content, the padding and border come on top, which
// gives the path boxes their height.
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
  return (
    <div
      className={`${wide ? "w-auto" : "w-65"} box-content flex h-7 items-center gap-2 overflow-hidden rounded-md border border-s-input py-0.5 pr-1 pl-2 text-xs focus-within:ring-1 ring-s-primary`}
    >
      {found != null && (
        <span className={`size-1.5 flex-none rounded-full ${found ? "bg-s-ok" : "bg-s-warn"}`} title={foundTip}></span>
      )}
      <ChangeInput
        className="h-6 min-w-0 w-auto flex-1 rounded-none border-0 bg-transparent p-0 font-mono text-xs text-s-fg placeholder:font-sans placeholder:text-s-subtle focus-visible:ring-1 ring-s-primary focus-visible:outline-none"
        value={value}
        title={tip}
        placeholder={placeholder || undefined}
        readOnly={readOnly}
        spellCheck={false}
        onInput={e => onInput?.(e.currentTarget.value)}
        onCommit={() => onCommit?.()}
      />
      <button
        className="box-content grid h-7 w-8 flex-none place-items-center border-l border-s-border text-s-muted hover:bg-s-hover hover:text-s-fg focus-visible:ring-1 ring-inset ring-s-primary"
        onClick={onPick}
        title={pickTip}
      >
        <Icon name="folder" className="size-4 fill-none stroke-current stroke-2 glyph" />
      </button>
    </div>
  );
}
