import type { Artifact } from "../../../domain/agents/types";
import { glyphOf } from "../../../domain/artifacts/rules";

/** What an Artifact is, in words: its glyph's kind. */
export const KIND = { chart: "art.dashboard", slides: "art.slides", palette: "art.design", page: "art.page" } as const;
export const kindKey = (artifact: Artifact) => KIND[glyphOf(artifact)];
