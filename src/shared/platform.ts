/** Whether Relay runs on macOS, where ⌘ is the command key. Elsewhere (Windows) Ctrl is. WebView2 names Windows in
 *  its user agent, WebKit on the Mac does not, and a test under Node counts as the Mac. */
export const isMac = () => typeof navigator === "undefined" || !/Windows/.test(navigator.userAgent);
/** Whether the command key is down: ⌘ on macOS, Ctrl on Windows. */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac() ? e.metaKey : e.ctrlKey);
