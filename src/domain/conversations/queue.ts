import type { Caps } from "../agents/types";
import type { Img } from "./types";

/** A message Relay holds while a turn runs: nothing is sent to the agent until the turn before it has ended. */
export type Queued = { id: string; text: string; images: Img[]; files: string[] };

/** What sending does while a turn runs: `queue` holds the message, `steer` ends the turn and sends it at once. */
export type BusySend = "queue" | "steer";

/** Whether the agent can end a running turn and keep what it streamed (Caps.steer). */
export const canSteer = (caps: Pick<Caps, "steer"> | undefined) => !!caps?.steer;
/** What a send while a turn runs does: Steer only where the agent can, else it queues too. */
export const busySend = (wantsSteer: boolean, caps: Pick<Caps, "steer"> | undefined): BusySend =>
  wantsSteer && canSteer(caps) ? "steer" : "queue";

export const enqueue = (list: Queued[] | undefined, message: Queued): Queued[] => [...(list ?? []), message];
export const removeQueued = (list: Queued[] | undefined, id: string): Queued[] => (list ?? []).filter(x => x.id !== id);
/** The text changed; one left without text or attachments is dropped. */
export const editQueued = (list: Queued[] | undefined, id: string, text: string): Queued[] =>
  (list ?? [])
    .map(x => (x.id === id ? { ...x, text: text.trim() } : x))
    .filter(x => x.text || x.images.length || x.files.length);
/** `id` moved to place `to` (0-based, in the list without it). */
export function moveQueued(list: Queued[] | undefined, id: string, to: number): Queued[] {
  const all = list ?? [];
  const item = all.find(x => x.id === id);
  if (!item) return all;
  const rest = all.filter(x => x !== item);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, item);
  return rest;
}

/** What is kept over a restart: text and attached paths. A message with pasted images stays out, those are not kept
 *  anywhere else either (a draft's waiting images do not survive a restart). */
export const storable = (queue: Record<string, Queued[]>) =>
  Object.fromEntries(
    Object.entries(queue)
      .map(([key, list]) => [
        key,
        list.filter(x => !x.images.length).map(x => ({ id: x.id, text: x.text, files: x.files })),
      ])
      .filter(([, list]) => list.length),
  );
export const restored = (
  stored: Record<string, { id: string; text: string; files?: string[] }[]>,
): Record<string, Queued[]> =>
  Object.fromEntries(
    Object.entries(stored).map(([key, list]) => [
      key,
      list.map(x => ({ id: x.id, text: x.text, images: [], files: x.files ?? [] })),
    ]),
  );
