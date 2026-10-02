import type { Section } from "../../../domain/navigation/sidebar";

/** The text colour of a project's context, grey for no project. */
export const TINT_TEXT: Record<Section["tint"], string> = {
  "": "text-tertiary",
  "ctx-a": "text-ctx-a",
  "ctx-m": "text-ctx-m",
  "ctx-p": "text-ctx-p",
};
