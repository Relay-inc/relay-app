import { useEffect, useRef, useState } from "react";
import type { PluginViewInfo } from "../../../domain/plugins/types";
import { startHost } from "../../../application/plugins/host";
import { loadPluginView } from "../../../application/plugins/plugins";
import { useSettingsStore } from "../../../application/settings/store";
import { useT } from "../../hooks/useT";
import { Segmented } from "../settings/Segmented";

type Loaded = { status: "loading" } | { status: "ready"; info: PluginViewInfo } | { status: "error"; message: string };

/** A plugin's view in the middle column: its `ui://` page in a frame that cannot reach Relay (`sandbox="allow-scripts"`
 *  without allow-same-origin gives it an opaque origin, so no Tauri IPC and no access to this page) and has the policy the
 *  plugin declared. Everything the view may do goes through the bridge (application/plugins/host.ts). A plugin with more
 *  than one view gets a tab per view; only the picked one runs. Keyed by the plugin, the view and the attempt, so Try
 *  again starts the server and reads the view afresh. */
export function PluginView({ id, className = "" }: { id: string; className?: string }) {
  const { t } = useT();
  const views = useSettingsStore(s => s.settings.plugins?.find(p => p.id === id)?.views) ?? [];
  const [picked, setPicked] = useState("");
  const [attempt, setAttempt] = useState(0);
  const uri = (views.find(v => v.uri === picked) ?? views[0])?.uri;
  const frame = (
    <PluginFrame
      key={`${id}:${uri}:${attempt}`}
      id={id}
      uri={uri}
      className={views.length > 1 ? "flex-1" : className}
      retry={() => setAttempt(attempt + 1)}
    />
  );
  if (views.length < 2) return frame;
  return (
    <div className={`${className} flex flex-col min-h-0`}>
      <div className="flex items-center px-4 h-11 border-b border-separator">
        <Segmented
          label={t("plug.views")}
          options={views.map(v => [v.uri, v.name] as const)}
          value={uri ?? ""}
          onPick={setPicked}
        />
      </div>
      {frame}
    </div>
  );
}

function PluginFrame({
  id,
  uri,
  className,
  retry,
}: {
  id: string;
  uri?: string;
  className: string;
  retry: () => void;
}) {
  const { t } = useT();
  const plugin = useSettingsStore(s => s.settings.plugins?.find(p => p.id === id));
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let live = true;
    loadPluginView(id, uri).then(
      info => live && setLoaded({ status: "ready", info }),
      error => live && setLoaded({ status: "error", message: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [id, uri]);
  const ready = loaded.status === "ready";
  useEffect(() => (ready && frame.current ? startHost(frame.current, id) : undefined), [ready, id]);

  if (loaded.status === "ready")
    return (
      <iframe
        ref={frame}
        src={loaded.info.url}
        sandbox="allow-scripts"
        title={loaded.info.name}
        className={`${className} min-h-0 w-full border-0`}
      />
    );
  return (
    <div className={`${className} grid place-content-center justify-items-center gap-3 px-8 text-center`}>
      {loaded.status === "loading" ? (
        <>
          <span className="spinner"></span>
          <p className="text-sm text-secondary">{t("plug.starting", { name: plugin?.name ?? id })}</p>
        </>
      ) : (
        <>
          <p className="max-w-120 text-sm text-late">{loaded.message}</p>
          <button className="rounded-lg border border-separator-strong px-3 py-1 text-sm hover:bg-fill" onClick={retry}>
            {t("plug.retry")}
          </button>
        </>
      )}
    </div>
  );
}
