import type { Artifact } from "../../../domain/agents/types";
import { artifactName, glyphOf } from "../../../domain/artifacts/rules";
import { openArtifact, openInBrowser, useShownArtifact } from "../../../application/artifacts/artifacts";
import { useNavigationStore } from "../../../application/navigation/store";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { kindKey } from "./kind";

/** A page Claude published as a claude.ai Artifact, where the call stood in the conversation: its kind, name and version,
 *  and Open, which shows it in the Artifact drawer. The way the Claude app shows it: "a card with the page's title and
 *  link". Lit while the drawer shows it. */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { t } = useT();
  const shown = useShownArtifact()?.open.url === artifact.url;
  const drawerOpen = useNavigationStore(s => s.drawer === "artifact");
  const on = shown && drawerOpen;
  const meta = [
    t(kindKey(artifact)),
    artifact.version ? t("art.version", { n: artifact.version }) : "",
    artifact.updated ? t("art.updated") : "",
  ].filter(Boolean);
  return (
    <div
      className={`group flex items-center gap-3 w-full max-w-110 pl-2.5 pr-2 py-2.5 rounded-xl bg-raised shadow-sm ring-1 ${on ? "ring-accent" : "ring-separator-strong hover:ring-accent"}`}
      data-artifact-card={artifact.url}
    >
      <button
        className="flex-1 min-w-0 flex items-center gap-3 border-0 bg-transparent p-0 text-left cursor-default"
        onClick={() => openArtifact(artifact)}
      >
        <span className="flex-none size-10 grid place-items-center rounded-lg bg-accent-soft text-accent-text">
          <Icon name={glyphOf(artifact)} className="glyph size-5" />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <b className="text-[13px] font-semibold text-label truncate">{artifactName(artifact) || t("art.untitled")}</b>
          <span className="text-xs text-secondary truncate">{meta.join(" · ")}</span>
        </span>
      </button>
      <button
        className="btn-icon flex-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title={t("art.browser")}
        aria-label={t("art.browser")}
        onClick={() => openInBrowser(artifact.url)}
      >
        <Icon name="out" className="glyph size-4" />
      </button>
      <button className="btn h-7! px-2.5! text-xs flex-none" onClick={() => openArtifact(artifact)}>
        {t("art.open")}
      </button>
    </div>
  );
}
