/** What a relay:// link asks for. `ask` only fills Cmd-K: a link from outside (any web page can open one) never sends
 *  a prompt by itself, the user presses Enter. */
export type DeepLink = { kind: "ask"; text: string } | { kind: "open"; query: string };

/** relay://ask opens Cmd-K, relay://ask?q=… with the question typed, relay://open?q=… the best matching project. */
export function parseLink(link: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "relay:") return null;
  const query = url.searchParams.get("q")?.trim() || "";
  if (url.host === "ask") return { kind: "ask", text: query };
  if (url.host === "open") return { kind: "open", query };
  return null;
}

/** The launch links still to handle: a webview reload boots again with the same launch link, which was handled. */
export const unhandled = (links: string[], handled: string[]) => links.filter(link => !handled.includes(link));
