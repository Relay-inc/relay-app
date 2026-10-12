import { answer, isRpc, type Host, type HostContext, type Rpc } from "../../domain/plugins/bridge";
import * as backend from "../../infrastructure/backend";
import { prefersDark } from "../../infrastructure/window";
import { useSettingsStore } from "../settings/store";

// The live side of the bridge to a plugin's view: the sandboxed frame's messages in, the answers out. What may be asked
// and answered is domain/plugins/bridge.ts; the tool calls go to the backend, which refuses what the plugin does not allow.

// The standardised theme variables (MCP Apps: styles.variables) from the app's own tokens, read as they are now
const TOKENS: Record<string, string> = {
  "--color-background-primary": "--bg",
  "--color-background-secondary": "--well",
  "--color-background-tertiary": "--fill",
  "--color-text-primary": "--label",
  "--color-text-secondary": "--secondary",
  "--color-text-tertiary": "--tertiary",
  "--color-border-primary": "--separator-strong",
  "--color-border-secondary": "--separator",
  "--color-background-info": "--accent-soft",
  "--color-text-info": "--accent-text",
  "--color-ring-primary": "--focus",
  "--color-text-danger": "--late",
  "--color-text-success": "--ok",
  "--color-text-warning": "--soon",
  "--font-mono": "--mono",
};
function styleVariables() {
  const root = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = { "--font-sans": getComputedStyle(document.body).fontFamily };
  for (const [name, token] of Object.entries(TOKENS)) {
    const value = root.getPropertyValue(token).trim();
    if (value) variables[name] = value;
  }
  return variables;
}
const isDark = () => {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : prefersDark();
};
const hostContext = (frame: HTMLIFrameElement): HostContext => ({
  theme: isDark() ? "dark" : "light",
  styles: { variables: styleVariables() },
  containerDimensions: { width: frame.clientWidth, height: frame.clientHeight },
  displayMode: "inline",
  availableDisplayModes: ["inline"],
  locale: useSettingsStore.getState().locale,
  platform: "desktop",
  userAgent: "relay",
});

/** Serve the frame of plugin `id`: answer what its view asks and keep it told of the theme and the size of the pane.
 *  Returns what stops it; the view gets a `ui/resource-teardown` first (on a best-effort basis: the frame is removed
 *  right after, so a view that needs time to save has none). */
export function startHost(frame: HTMLIFrameElement, id: string): () => void {
  let version = "";
  void backend.updatesStatus().then(
    status => (version = status.version),
    () => {},
  );
  const host: Host = {
    get version() {
      return version;
    },
    context: () => hostContext(frame),
    callTool: (name, args) => backend.pluginCall(id, name, args),
    openLink: async url => {
      await backend.openUrl(url);
    },
  };
  const send = (message: object) => frame.contentWindow?.postMessage({ jsonrpc: "2.0", ...message }, "*");
  let ready = false; // the host sends nothing to a view before its `initialized`
  const onMessage = async (event: MessageEvent) => {
    // the frame has an opaque origin ("null"), so the sender is told by its window
    if (event.source !== frame.contentWindow || !isRpc(event.data)) return;
    const message: Rpc = event.data;
    const reply = await answer(message, host);
    if (reply) send(reply);
    if (message.method === "ui/notifications/initialized") ready = true;
  };
  window.addEventListener("message", onMessage);
  // the context changes with the theme (the settings' data-theme, or macOS's) and with the pane's size
  const changed = () => ready && send({ method: "ui/notifications/host-context-changed", params: hostContext(frame) });
  const watch = new MutationObserver(changed);
  const resized = new ResizeObserver(changed);
  resized.observe(frame);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", changed);
  return () => {
    send({ id: 0, method: "ui/resource-teardown", params: { reason: "closed" } });
    window.removeEventListener("message", onMessage);
    watch.disconnect();
    resized.disconnect();
    media.removeEventListener("change", changed);
  };
}
