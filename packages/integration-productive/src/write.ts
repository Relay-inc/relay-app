import type { Ctx } from "@relay/board-core";

// What the panel writes to Productive, kept apart from index.ts so tests/write.test.ts can run it without a webview.

/** A comment as Productive stores it: HTML, here from plain text (paragraphs on blank lines, line breaks kept). */
export const toHtml = (s: string) => s.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!)).replace(/\n/g, "<br>")}</p>`).join("");

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
