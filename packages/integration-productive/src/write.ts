import type { Ctx } from "@relay/board-core";

// What the panel writes to Productive, kept apart from index.ts so tests/write.test.ts can run it without a webview.

/** A comment as Productive stores it: HTML, here from plain text (paragraphs on blank lines, line breaks kept). */
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
// Productive's mention, as its own editor writes it in the comment's text (read from real comments): @[{json}]
const token = (p: { id: string; name: string }) =>
  `@[${JSON.stringify({ type: "person", id: p.id, label: p.name, avatar_url: null, attachment_url: null, is_done: true }).replace(/[<>&]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)}]`;
/** A comment as escaped HTML paragraphs; every "@Name" of a person picked in the composer becomes Productive's
 *  mention, so that person is notified. */
export const toHtml = (s: string, mentions: { id: string; name: string }[] = []) => {
  let html = s.trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  // the longest name first: "Jan Tubeeckx" before "Jan"
  for (const p of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    const at = `@${esc(p.name)}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`${at}(?![\\p{L}\\p{N}])`, "gu"), () => token(p));
  }
  return html;
};
/** Productive's mentions in a comment's HTML as "@Name" in bold (its JSON is no text to read). */
export const showMentions = (html: string) =>
  html.replace(/@\[(\{[^\[\]]*?\})\]/g, (all, json) => {
    try {
      const m = JSON.parse(json.replace(/&quot;/g, '"'));
      return typeof m.label === "string" ? `<b>@${esc(m.label)}</b>` : all;
    } catch {
      return all;
    }
  });

const S3 = "https://productive-files-production.s3.eu-west-1.amazonaws.com";
/** A file for a task, the bb plugin's flow: the attachment record, the bytes to S3 with the policy Productive gave
 * (every field but `url`), then where they landed. Resolves with the attachment id; linking it to the task is the caller's. */
export async function uploadFile(c: Ctx, f: File) {
  const r = await c.call("POST", "/attachments", { data: { type: "attachments", attributes: { name: f.name, content_type: f.type || "application/octet-stream", size: f.size, attachable_type: "task" } } });
  const id = r.data.id, pol = r.data.attributes?.aws_policy || {}, url = pol.url || S3;
  const fields = Object.fromEntries(Object.entries(pol).filter(([k, v]) => k !== "url" && v != null).map(([k, v]) => [k, String(v)]));
  const at = await c.upload(url, fields, f) || `${url.replace(/\/$/, "")}/${encodeURI(pol.key || "")}`;
  await c.call("PATCH", `/attachments/${id}`, { data: { type: "attachments", id, attributes: { temp_url: at } } });
  return id as string;
}
