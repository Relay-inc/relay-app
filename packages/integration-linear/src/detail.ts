import type { CardView, Ctx, Opt } from "@relay/board-core";
import { markdown, safeUrl, ticketDetail } from "@relay/board-core/detail";
import { MOVE, TYPES } from "./map.ts";

export const ASSIGN = "mutation Assign($id: String!, $assigneeId: String) { issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }";
export const COMMENT = "mutation Comment($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }";
export const UPLOAD = "mutation Upload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }";
export const ATTACH = "mutation Attach($id: String!, $title: String!, $url: String!) { attachmentCreate(input: { issueId: $id, title: $title, url: $url }) { success } }";

export const DETAIL = "query Detail($id: String!) { issue(id: $id) { id title identifier url description createdAt archivedAt dueDate creator { name displayName } assignee { id name displayName } state { id name type } team { id name } project { name } } }";
const pageInfo = "pageInfo { hasNextPage endCursor }";
export const COMMENTS = `query Comments($id: String!, $after: String) { issue(id: $id) { comments(first: 100, after: $after) { nodes { id body createdAt user { name displayName } } ${pageInfo} } } }`;
export const HISTORY = `query History($id: String!, $after: String) { issue(id: $id) { history(first: 100, after: $after) { nodes { id createdAt actor { name displayName } fromState { name } toState { name } fromAssignee { name displayName } toAssignee { name displayName } fromTitle toTitle fromDueDate toDueDate fromPriority toPriority updatedDescription addedLabels { name } removedLabels { name } } ${pageInfo} } } }`;
export const FILES = `query Files($id: String!, $after: String) { issue(id: $id) { attachments(first: 100, after: $after) { nodes { id title url metadata } ${pageInfo} } } }`;
export const LABELS = `query Labels($id: String!, $after: String) { issue(id: $id) { labels(first: 100, after: $after) { nodes { name } ${pageInfo} } } }`;
export const PEOPLE = `query People($id: String!, $after: String) { team(id: $id) { members(first: 100, after: $after) { nodes { id name displayName active } ${pageInfo} } } }`;
export const WORKFLOW = `query Workflow($id: String!, $after: String) { team(id: $id) { states(first: 100, after: $after) { nodes { id name type position } ${pageInfo} } } }`;
export const gql = async (c: Ctx, query: string, variables: Record<string, unknown>) => {
  const r = await c.call("POST", "/graphql", { query, variables });
  if (r?.errors?.length) throw new Error(r.errors.map((e: any) => e.message).join("; "));
  if (!r?.data) throw new Error("Linear: missing response data");
  return r.data;
};
export async function pages(c: Ctx, query: string, id: string, root: string, field: string) {
  const nodes: any[] = [];
  let after: string | null = null;
  for (;;) {
    const page: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } | undefined = (await gql(c, query, { id, after }))[root]?.[field];
    if (!page) throw new Error(`Linear: missing ${field}`);
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    const next: string | null = page.pageInfo.endCursor;
    if (!next || next === after) throw new Error("Linear: pagination did not advance");
    after = next;
  }
}
const name = (p: any): string => p?.displayName || p?.name || "";
const person = (p: any): Opt => ({ id: p.id, name: name(p) });
export function mapDetail(issue: any, comments: any[], history: any[], files: any[], labels: any[], states: any[], people: any[]): CardView {
  const done = ["completed", "canceled"].includes(issue.state.type);
  const feed: CardView["feed"] = comments.map(c => ({ at: c.createdAt, who: name(c.user), html: markdown(c.body), change: "", files: [] }));
  for (const h of history) {
    const changes: string[] = [];
    for (const [key, label] of [["State", "Status"], ["Assignee", "Assignee"], ["Title", "Title"], ["DueDate", "Due date"], ["Priority", "Priority"]]) {
      const from = h[`from${key}`], to = h[`to${key}`];
      if (from != null || to != null) changes.push(`${label}: ${typeof from === "object" && from ? name(from) : from ?? "—"} → ${typeof to === "object" && to ? name(to) : to ?? "—"}`);
    }
    if (h.updatedDescription) changes.push("Description updated");
    if (h.addedLabels?.length) changes.push(`+ ${h.addedLabels.map((l: any) => l.name).join(", ")}`);
    if (h.removedLabels?.length) changes.push(`− ${h.removedLabels.map((l: any) => l.name).join(", ")}`);
    if (changes.length) feed.push({ at: h.createdAt, who: name(h.actor), html: "", change: changes.join("; "), files: [] });
  }
  return {
    title: issue.title, number: issue.identifier, closed: done || !!issue.archivedAt, url: safeUrl(issue.url),
    board: issue.project?.name || issue.team.name, list: "", project: issue.team.id, created: issue.createdAt, creator: name(issue.creator),
    description: markdown(issue.description || ""), due: issue.dueDate || "", labels: labels.map(l => l.name),
    status: { id: issue.state.id, name: issue.state.name, state: done ? "done" : issue.state.type === "started" ? "doing" : "todo" },
    statuses: [...states].sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.position - b.position).map(s => ({ id: s.id, name: s.name })),
    assignee: issue.assignee ? person(issue.assignee) : undefined,
    people: people.filter(p => p.active !== false || p.id === issue.assignee?.id).map(person).sort((a, b) => a.name.localeCompare(b.name)),
    files: files.map(f => ({ id: f.id, name: f.title, url: safeUrl(f.url), size: Number(f.metadata?.size) || 0 })),
    feed: feed.sort((a, b) => b.at.localeCompare(a.at)),
  };
}
async function mutate(c: Ctx, query: string, variables: Record<string, unknown>, field: string) {
  const result = (await gql(c, query, variables))[field];
  if (!result?.success) throw new Error(`Linear: ${field} was refused`);
  return result;
}
export const linearTicket = ticketDetail("Linear", async (c, _ref, id) => {
  const issue = (await gql(c, DETAIL, { id })).issue;
  if (!issue) throw new Error("Linear: issue not found");
  const [comments, history, files, labels, states, people] = await Promise.all([
    pages(c, COMMENTS, id, "issue", "comments"), pages(c, HISTORY, id, "issue", "history"),
    pages(c, FILES, id, "issue", "attachments"), pages(c, LABELS, id, "issue", "labels"),
    pages(c, WORKFLOW, issue.team.id, "team", "states"), pages(c, PEOPLE, issue.team.id, "team", "members"),
  ]);
  return mapDetail(issue, comments, history, files, labels, states, people);
}, async (c, ref, id, action, { value, files }) => {
  if (action === "status" && value) await mutate(c, MOVE, { id, stateId: value }, "issueUpdate");
  else if (action === "assignee") await mutate(c, ASSIGN, { id, assigneeId: value || null }, "issueUpdate");
  else if (action === "comment" && value.trim()) await mutate(c, COMMENT, { id, body: value }, "commentCreate");
  else if (action === "attach") for (const file of files) {
    const contentType = file.type || "application/octet-stream";
    const result = await mutate(c, UPLOAD, { contentType, filename: file.name, size: file.size }, "fileUpload");
    const upload = result.uploadFile;
    if (!upload?.uploadUrl || !safeUrl(upload.assetUrl)) throw new Error("Linear: missing upload URL");
    const headers: Record<string, string> = { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000" };
    for (const h of upload.headers || []) headers[h.key] = h.value;
    await c.upload(upload.uploadUrl, headers, file);
    await mutate(c, ATTACH, { id, title: file.name, url: upload.assetUrl }, "attachmentCreate");
  }
  else throw new Error("Linear: unsupported ticket action");
  return linearTicket.detail.fetch(c, ref, id);
});
