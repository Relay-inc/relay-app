// the strips under the log line up with the messages: the same column, its padding as the gutter
// grows with the window: never narrower than the old 680px, capped at 1200px so lines stay readable
export const chatWidth = "max-w-[clamp(42.5rem,80%,75rem)]";
export const column = `block w-full ${chatWidth} mx-auto px-8`;
// a card over the bar's width: toast and move bar share the log's column
export const strip = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm";
