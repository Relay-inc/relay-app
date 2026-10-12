import { answer, isRpc, type Host, type HostContext, type Rpc } from "../../domain/plugins/bridge";
import { INLINE_MAX_HEIGHT, inlineHeight } from "../../domain/plugins/rules";
import type { ToolResult } from "../../domain/plugins/types";
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
const hostContext = (frame: HTMLIFrameElement, inline: boolean): HostContext => ({
  theme: isDark() ? "dark" : "light",
  styles: { variables: styleVariables() },
  containerDimensions: inline
    ? { width: frame.clientWidth, maxHeight: INLINE_MAX_HEIGHT }
    : { width: frame.clientWidth, height: frame.clientHeight },
  displayMode: "inline",
  availableDisplayModes: ["inline"],
  locale: useSettingsStore.getState().locale,
  platform: "desktop",
  userAgent: "relay",
});

/** A view shown under the agent's call to one of the plugin's tools: the call's arguments (sent once the view says it is
 *  ready), and where the height goes that the view asks for, as it renders. */
export type Call = { input: Record<string, unknown>; onHeight: (height: number) => void };
/** What `startHost` gives back: `result` hands the view the call's result, now or once it is ready (a live call
 *  answers after its frame loaded); `stop` ends it, and the view gets a `ui/resource-teardown` first (on a best-effort
 *  basis: the frame is removed right after, so a view that needs time to save has none). */
export type Hosted = { stop: () => void; result: (result: ToolResult | null) => void };

/** Serve the frame of plugin `id`: answer what its view asks and keep it told of the theme and the size of the pane. With
 *  a `call` the view is inline in a conversation: it sizes itself up to a maximum, and gets the call's input and result
 *  (spec: `ui/notifications/tool-input`, then `tool-result`, each after `ui/notifications/initialized`). */
export function startHost(frame: HTMLIFrameElement, id: string, call?: Call): Hosted {
  let version = "";
  void backend.updatesStatus().then(
    status => (version = status.version),
    () => {},
  );
  const host: Host = {
    get version() {
      return version;
    },
    context: () => hostContext(frame, !!call),
    callTool: (name, args) => backend.pluginCall(id, name, args),
    openLink: async url => {
      await backend.openUrl(url);
    },
  };
  const send = (message: object) => frame.contentWindow?.postMessage({ jsonrpc: "2.0", ...message }, "*");
  let ready = false; // the host sends nothing to a view before its `initialized`
  let pending: ToolResult | null = null;
  const sendResult = () => ready && pending && send({ method: "ui/notifications/tool-result", params: pending });
  const onMessage = async (event: MessageEvent) => {
    // the frame has an opaque origin ("null"), so the sender is told by its window
    if (event.source !== frame.contentWindow || !isRpc(event.data)) return;
    const message: Rpc = event.data;
    const reply = await answer(message, host);
    if (reply) send(reply);
    if (message.method === "ui/notifications/initialized") {
      ready = true;
      if (call) send({ method: "ui/notifications/tool-input", params: { arguments: call.input } });
      sendResult();
    }
    const height = message.method === "ui/notifications/size-changed" ? inlineHeight(message.params?.height) : null;
    if (call && height !== null) call.onHeight(height);
  };
  window.addEventListener("message", onMessage);
  // the context changes with the theme (the settings' data-theme, or macOS's) and with the pane's size
  const changed = () =>
    ready && send({ method: "ui/notifications/host-context-changed", params: hostContext(frame, !!call) });
  const watch = new MutationObserver(changed);
  // inline the view sets its own height: only a change of width is news to it
  let width = frame.clientWidth;
  const resized = new ResizeObserver(() => {
    if (call && frame.clientWidth === width) return;
    width = frame.clientWidth;
    changed();
  });
  resized.observe(frame);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", changed);
  return {
    stop: () => {
      send({ id: 0, method: "ui/resource-teardown", params: { reason: "closed" } });
      window.removeEventListener("message", onMessage);
      watch.disconnect();
      resized.disconnect();
      media.removeEventListener("change", changed);
    },
    result: next => {
      pending = next;
      sendResult();
    },
  };
}
