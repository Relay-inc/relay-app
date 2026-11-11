import * as Y from "yjs";
import * as backend from "../../infrastructure/backend";

/** Who else is on a page: their name, a colour of their own and their cursor (anchor, head) in the note's text. */
export type Peer = { from: string; name: string; color: string; anchor: number; head: number };
/** A shared document's page as its editor holds it while open: the note's whole text as a Y.Text ("md", as the Mac's
 *  documents have it), edits made with `LOCAL` sent, and the other members' cursors. */
export type SharedPage = {
  text: Y.Text;
  undo: Y.UndoManager;
  cursor: (anchor: number, head: number) => void; // this Mac's, in the note's text
  peers: (on: (peers: Peer[]) => void) => void;
  close: () => void;
};

/** The origin of what this Mac's editor types: sent, and the only thing ⌘Z undoes. */
export const LOCAL = Symbol("local");
const SEND_AFTER = 300; // ms: what is typed goes out in one update
const CURSOR_EVERY = 100; // ms between two cursors sent (at most 10 a second)
const CURSOR_AGAIN = 10_000; // ms: a cursor sent again while it stays put, so the others keep it
const PEER_GONE = 30_000; // ms without a cursor: that member left the page
// Tailwind's 500 shades: a member's colour, by their device
const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const b64 = (u: Uint8Array) => btoa(Array.from(u, b => String.fromCharCode(b)).join(""));
export const colorOf = (from: string) =>
  COLORS[[...from].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % COLORS.length];

/** The page `path` (a shared workspace's note, absolute) as a shared document, or null when it is none. */
export async function openSharedPage(path: string): Promise<SharedPage | null> {
  const opened = await backend.sharedDocOpen(path).catch(() => null);
  if (!opened) return null;
  const { vault, doc: id, name } = opened;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes(opened.state), "remote");
  const text = doc.getText("md");
  const undo = new Y.UndoManager(text, { trackedOrigins: new Set([LOCAL]) });

  // what is typed: one update every SEND_AFTER ms, kept until it went out (a failure tries again with the next)
  let queue: Uint8Array[] = [];
  let timer = 0;
  const flush = () => {
    window.clearTimeout(timer);
    if (!queue.length) return;
    const update = Y.mergeUpdates(queue);
    queue = [];
    backend.sharedDocEdit(path, id, b64(update)).catch(() => {
      queue.unshift(update);
    });
  };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    queue.push(update);
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, SEND_AFTER);
  };
  doc.on("update", onUpdate);
  const stopDoc = backend.onSharedDoc(change => {
    if (change.vault === vault && change.id === id) Y.applyUpdate(doc, bytes(change.update), "remote");
  });

  // cursors: as positions relative to the text, so they stay on their character while others type
  const seen = new Map<string, { name: string; anchor: unknown; head: unknown; at: number }>();
  let listener: (peers: Peer[]) => void = () => {};
  const at = (rel: unknown) => {
    try {
      const pos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), doc);
      return pos?.type === text ? pos.index : -1;
    } catch {
      return -1;
    }
  };
  const tell = () => {
    const now = Date.now();
    const peers: Peer[] = [];
    for (const [from, p] of seen) {
      if (now - p.at > PEER_GONE) {
        seen.delete(from);
        continue;
      }
      const [anchor, head] = [at(p.anchor), at(p.head)];
      if (anchor >= 0 && head >= 0) peers.push({ from, name: p.name, color: colorOf(from), anchor, head });
    }
    listener(peers);
  };
  const stopCursors = backend.onSharedAwareness(cursor => {
    if (cursor.vault !== vault || cursor.doc !== id) return;
    try {
      const body = JSON.parse(cursor.body) as { name?: string; anchor?: unknown; head?: unknown; gone?: boolean };
      if (body.gone) seen.delete(cursor.from);
      else
        seen.set(cursor.from, {
          name: String(body.name ?? "?").slice(0, 60),
          anchor: body.anchor,
          head: body.head,
          at: Date.now(),
        });
      tell();
    } catch {
      /* not a cursor: ignored */
    }
  });
  text.observe(tell); // their cursors move with the text
  const prune = window.setInterval(tell, 5_000);

  let mine = "";
  let last = 0;
  let pending = 0;
  const send = (body: string) => void backend.sharedAwareness(path, id, body).catch(() => {});
  const cursor = (anchor: number, head: number) => {
    mine = JSON.stringify({
      name,
      anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, anchor)),
      head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, head)),
    });
    window.clearTimeout(pending);
    const wait = last + CURSOR_EVERY - Date.now();
    pending = window.setTimeout(
      () => {
        last = Date.now();
        send(mine);
      },
      Math.max(0, wait),
    );
  };
  const again = window.setInterval(() => {
    if (mine && Date.now() - last >= CURSOR_AGAIN) {
      last = Date.now();
      send(mine);
    }
  }, CURSOR_AGAIN);

  return {
    text,
    undo,
    cursor,
    peers: on => {
      listener = on;
      tell();
    },
    close: () => {
      flush();
      [pending, timer].forEach(window.clearTimeout);
      [prune, again].forEach(window.clearInterval);
      if (mine) send(JSON.stringify({ gone: true }));
      void stopDoc.then(stop => stop());
      void stopCursors.then(stop => stop());
      text.unobserve(tell);
      doc.off("update", onUpdate);
      undo.destroy();
      doc.destroy();
    },
  };
}
