import { unsafeCSS } from "lit";
import tailwind from "./tailwind.css?inline";

/** Tailwind, compiled once and adopted by every component: `static styles = [tw]`, or `[tw, css\`:host{…}\`]` for what a utility can't say. */
export const tw = unsafeCSS(tailwind);
