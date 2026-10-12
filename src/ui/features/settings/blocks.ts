// The look of the settings window as whole class strings (Tailwind only sees complete names). The components built on
// them (Section, Field, Switch, StatusLine, Footer) sit next to this file.

// a <code> in a translated text
export const CODE =
  "[&_code]:rounded-sm [&_code]:bg-s-mutedbg [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-xs";
export const HINT = `mt-[3px] text-xs leading-[1.45] text-s-muted ${CODE}`;
/** A hint straight in a folded-open row, which has its own gap. */
export const HINT_IN_ROW = `text-xs leading-snug text-s-faint ${CODE}`;
export const OPTIONAL_TEXT = "text-[11px] text-s-faint";
export const OK_MESSAGE = "text-xs text-s-muted";
export const ERROR_MESSAGE = "text-xs text-s-err";
export const STATUS_TEXT = "inline-flex min-w-0 items-center gap-1.5 text-xs text-s-muted";
export const EMPTY_LIST = "py-2.5 text-xs text-s-faint";
export const PILL =
  "inline-block rounded-sm border border-s-border bg-s-mutedbg/40 px-1.5 py-0.5 text-xs leading-tight font-normal text-s-subtle";
/** The "default" tag beside an agent's name */
export const DEFAULT_PILL =
  "inline-flex h-4.5 items-center rounded-[5px] bg-accent-soft px-1.5 text-[11px] font-medium text-accent-text";

const BUTTON =
  "inline-flex h-7.5 items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium whitespace-nowrap no-underline transition-colors duration-150 ease-in-out hover:duration-0 focus-visible:ring-1 ring-s-primary focus-visible:outline-none disabled:opacity-50";
const BUTTON_KIND = {
  plain: "border-s-input bg-transparent text-s-fg hover:bg-s-hover",
  primary: "border-s-primary bg-s-primary text-on-accent hover:bg-accent-hover",
  ghost: "border-transparent bg-transparent text-s-muted hover:bg-s-hover hover:text-s-fg",
  // what removes something: red, so it is found and not clicked by accident
  danger: "border-s-err bg-transparent text-s-err hover:bg-s-err hover:text-white",
  dangerSolid: "border-s-err bg-s-err text-white hover:opacity-90",
};
/** A button; `square` makes it a square holding a glyph. */
export const buttonClass = (kind: keyof typeof BUTTON_KIND = "plain", square = false) =>
  `${BUTTON} ${square ? "w-7.5 p-0" : kind === "primary" ? "px-3.5" : "px-3"} ${BUTTON_KIND[kind]}`;
/** The glyph in an icon button. */
export const BUTTON_GLYPH = "size-4 fill-none stroke-current stroke-2 glyph";
/** The glyph on a tile (menu items, rows). */
export const TILE = "glyph size-4 stroke-1";

const FIELD_BASE =
  " rounded-md border border-s-input bg-transparent px-2.5 text-s-fg placeholder:font-sans placeholder:text-s-subtle read-only:text-s-muted focus-visible:ring-1 ring-s-primary focus-visible:outline-none";
export const FIELD = `${FIELD_BASE} h-8 w-65 text-sm`;
export const FIELD_ICON = `${FIELD_BASE} h-8 w-42 text-sm`;
export const FIELD_CHIP = `${FIELD_BASE} h-6 w-38 text-xs`;
/** A textarea of a few lines for a list typed one item per line (arguments, environment). */
export const AREA = `${FIELD_BASE} min-h-16 w-65 resize-y py-1.5 font-mono text-xs`;
export const SELECT =
  " h-7 w-50 max-w-full appearance-none overflow-hidden rounded-md border border-s-input bg-transparent bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23888%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E)] bg-position-[right_--spacing(2)_center] bg-no-repeat pr-6 pl-2 text-xs text-ellipsis whitespace-nowrap text-s-fg focus-visible:ring-1 ring-s-primary focus-visible:outline-none";

export const FOOTER = "flex flex-wrap items-center gap-2";
/** The footer of a section inside a folded-open row */
export const FOOTER_IN_ROW = `${FOOTER} mt-0.5`;

// the form labels end in a colon, the fields do without
export const withoutColon = (label: string) => label.replace(/\s*:\s*$/, "");
