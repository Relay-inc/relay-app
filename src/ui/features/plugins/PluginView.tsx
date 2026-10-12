import { useEffect, useRef, useState } from "react";
import type { PluginViewInfo } from "../../../domain/plugins/types";
import { startHost } from "../../../application/plugins/host";
import { loadPluginView } from "../../../application/plugins/plugins";
import { useSettingsStore } from "../../../application/settings/store";
import { useT } from "../../hooks/useT";

type Loaded = { status: "loading" } | { status: "ready"; info: PluginViewInfo } | { status: "error"; message: string };

/** A plugin's view in the middle column: its `ui://` page in a frame that cannot reach Relay (`sandbox="allow-scripts"`
 *  without allow-same-origin gives it an opaque origin, so no Tauri IPC and no access to this page) and has the policy the
 *  plugin declared. Everything the view may do goes through the bridge (application/plugins/host.ts). Keyed by the plugin
 *  and the attempt, so Try again starts the server and reads the view afresh. */
export function PluginView({ id, className = "" }: { id: string; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  return <PluginFrame key={`${id}:${attempt}`} id={id} className={className} retry={() => setAttempt(attempt + 1)} />;
}

function PluginFrame({ id, className, retry }: { id: string; className: string; retry: () => void }) {
  const { t } = useT();
  const plugin = useSettingsStore(s => s.settings.plugins?.find(p => p.id === id));
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const frame = useRef<HTMLIFrameElement>(null);
  const uri = plugin?.view?.uri;
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
