// Aikido's symbol (the bar over the arch, not the wordmark), from its press kit (https://www.aikido.dev/press-kit, the
// "Symbol · Full color" SVG on cdn.prod.website-files.com), on its own 42×46 grid padded to a square. Only its two
// paths; Aikido's trademark, shown to identify the integration, as Buddy's and Productive's marks are.
const PATHS = [
  "M42 0H0V14.4437H42V0Z",
  "M0 27.991C11.9485 17.4638 30.0514 17.4638 42 27.991V45.9919L41.9918 46L21 25.2626L0.0082342 46L0 45.9919V27.991Z",
];
/** For `Glyph`'s viewBox: the symbol centred on a square. */
export const AIKIDO_VIEWBOX = "-2 0 46 46";
/** In Aikido's purple (#6551F3): the Security tab, its title bar icon and the Integrations tile. */
export const AIKIDO_GLYPH = PATHS.map(d => `<path d="${d}" fill="#6551F3" stroke="none"/>`).join("");
/** In the colour of the text around it, for a place that tints its icon. */
export const AIKIDO_MARK = PATHS.map(d => `<path d="${d}" fill="currentColor" stroke="none"/>`).join("");
