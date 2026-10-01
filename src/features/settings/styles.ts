import { css, unsafeCSS } from "lit";
import settings from "../../core/styles/settings-tailwind.css?inline";

/** The app's Tailwind with the settings palette as colours (bg-s-bg …), adopted by every settings component. The host
 *  line height is the window's 1.4, which Tailwind's preflight would make 1.5. */
export const tws = [
  unsafeCSS(settings),
  css`
    :host {
      line-height: 1.4;
    }
  `,
];

/** A page of the window: it lays its sections out in the window's column itself, and only the shown one takes part. */
export const page = css`
  :host {
    display: contents;
  }
  :host(:not([active])) {
    display: none;
  }
`;
