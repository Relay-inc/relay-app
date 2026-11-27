import { useEffect, useRef, useState } from "react";
import { artifactName, artifactsIn, FRAME_SANDBOX, frameTheme, hasLocal } from "../../../domain/artifacts/rules";
import {
  artifactSrc,
  liveBounds,
  liveHide,
  liveShow,
  openArtifact,
  openInBrowser,
  setArtifactView,
  useShownArtifact,
} from "../../../application/artifacts/artifacts";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { copy, toast } from "../../../application/navigation/navigation";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { kindKey } from "./kind";

/** Relay's theme as the frame gets it, following a switch while the drawer is open, as Claude's shell re-sends its own
 *  (`__frame_theme`) when it changes. */
function useFrameTheme() {
  const [theme, setTheme] = useState(() => frameTheme(document.documentElement.dataset.theme));
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(frameTheme(document.documentElement.dataset.theme)));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return theme;
}

/** The Artifact drawer: a page Claude published to claude.ai, from its file on this Mac (a frame that cannot reach
 *  Relay, artifact.rs) or live on claude.ai (a native webview, signed in once). The other
 *  Artifacts of the conversation are a pick away; a republish shows its new version. */
export function ArtifactPanel() {
  const { t } = useT();
  const shownHere = useShownArtifact();
  const opened = shownHere?.open ?? null;
  const view = shownHere?.view ?? "local";
  const selected = useNavigationStore(s => s.selected);
  const items = useConversationsStore(s => s.messages[selected]);
  const all = artifactsIn(items);
  // the conversation's latest version of it: a republish while it is open reloads it
  const artifact = (opened && all.find(a => a.url === opened.url)) ?? opened;
  const [reloads, setReloads] = useState(0);
  const theme = useFrameTheme();
  if (!artifact) return <p className="m-auto max-w-70 text-center text-sm text-secondary">{t("art.none")}</p>;
  const local = hasLocal(artifact);
  const shown = local ? view : "live";
  const choices = all.some(a => a.url === artifact.url) ? all : [artifact, ...all];
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 min-w-0">
        {choices.length > 1 ? (
          <Select
            className="field flex-1 min-w-0 font-semibold"
            aria-label={t("art.others")}
            options={choices.map(a => ({ id: a.url, name: artifactName(a) || t("art.untitled") }))}
            value={artifact.url}
            onChange={url => {
              const next = choices.find(a => a.url === url);
              if (next) openArtifact(next);
            }}
          />
        ) : (
          <b className="flex-1 min-w-0 truncate text-sm font-semibold">{artifactName(artifact) || t("art.untitled")}</b>
        )}
        <span className="flex-none text-xs text-tertiary">
          {[t(kindKey(artifact)), artifact.version ? t("art.version", { n: artifact.version }) : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {local ? (
          <div className="seg" role="tablist">
            {(["local", "live"] as const).map(v => (
              <button
                key={v}
                role="tab"
                aria-selected={shown === v}
                className={shown === v ? "on" : ""}
                onClick={() => setArtifactView(v)}
              >
                {t(v === "local" ? "art.local" : "art.live")}
              </button>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <Icon name="globe" className="glyph size-3.5" />
            {t("art.live")}
          </span>
        )}
        <span className="flex-1" />
        <button
          className="btn-icon"
          title={t("art.reload")}
          aria-label={t("art.reload")}
          onClick={() => setReloads(n => n + 1)}
        >
          <Icon name="refresh" className="glyph size-4" />
        </button>
        <button
          className="btn-icon"
          title={t("art.copy")}
          aria-label={t("art.copy")}
          onClick={() => void copy(artifact.url).then(() => toast(t("art.copied"), undefined, "", 2500))}
        >
          <Icon name="link" className="glyph size-4" />
        </button>
        <button
          className="btn-icon"
          title={t("art.browser")}
          aria-label={t("art.browser")}
          onClick={() => openInBrowser(artifact.url)}
        >
          <Icon name="out" className="glyph size-4" />
        </button>
      </div>
      <p className="text-xs text-tertiary leading-snug">
        {shown === "local"
          ? t("art.localHint")
          : local
            ? t("art.liveHint")
            : `${t("art.noLocal")} ${t("art.liveHint")}`}
      </p>
      <div className="flex-1 min-h-0 flex rounded-lg overflow-hidden ring-1 ring-separator bg-bg">
        {shown === "local" && artifact.path ? (
          <iframe
            key={`${artifact.url} ${artifact.version ?? 0} ${reloads} ${theme}`}
            src={artifactSrc(artifact.path, theme)}
            // its own opaque origin: scripts run, nothing reaches Relay or its IPC
            sandbox={FRAME_SANDBOX}
            title={artifactName(artifact) || t("art.untitled")}
            className="flex-1 min-h-0 w-full border-0 bg-white"
          />
        ) : (
          <Live key={`${artifact.url} ${artifact.version ?? 0} ${reloads}`} url={artifact.url} />
        )}
      </div>
    </div>
  );
}

/** The live page: claude.ai in the native webview, placed over this box and following it (design.rs); claude.ai
 *  refuses to be framed. */
function Live({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let shown = false;
    const place = () => {
      const r = el.getBoundingClientRect();
      (shown ? liveBounds(r) : liveShow(url, r)).catch(e => setError(String(e)));
      shown = true;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    // the drawer slides in by a grid transition: the box moves without resizing
    document.addEventListener("transitionend", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("transitionend", place);
      void liveHide();
    };
  }, [url]);
  return (
    <div ref={box} className="flex-1 min-h-0 grid place-items-center">
      {error ? <p className="err-box m-3">{error}</p> : <span className="spinner"></span>}
    </div>
  );
}
