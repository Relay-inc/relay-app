// one size system in content: h-8, rounded-lg, medium; one primary, the others outline
export const ACT = "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[13px] font-medium cursor-pointer";
export const PRIMARY = `${ACT} bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-default`;
export const OUTLINE = `${ACT} border border-separator-strong text-label hover:bg-fill disabled:opacity-50 disabled:cursor-default`;
// compact, in a row of a card or a bar
export const SMALL = "inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-[13px] font-medium cursor-pointer";
export const SMALL_PRIMARY = `${SMALL} bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-default`;
export const SMALL_OUTLINE = `${SMALL} border border-separator-strong text-label hover:bg-fill disabled:opacity-50 disabled:cursor-default`;
