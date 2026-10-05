import { workKey, type WorkKind } from "../navigation/keys.ts";

// What the user has in progress on Today, shown in the sidebar under its project like a conversation: a review they
// started, a reply they are drafting, a meeting that runs or is being recorded. Derived from the state that already
// holds them (the review screen's, the composer's, the calendar's and the recorder's), never kept on its own.

export type Work = {
  key: string; // workKey(kind, id)
  kind: WorkKind;
  id: string;
  item: string | null; // the Today item it opens on, null when it has none (a running meeting without prep or note)
  project: string | null; // the vault project it sits under, null for General
  title: string;
  busy: boolean; // something runs: the meeting is being recorded
  closable: boolean; // closing discards it (a review, a draft); a meeting is not the user's to close
};

export type WorkInput = {
  reviews: { item: string; title: string; project: string | null }[];
  compose: { mail: string; title: string; project: string | null } | null;
  meetings: { id: string; title: string; start: number; end: number; project: string | null; item: string | null }[];
  recording: string | null; // the meeting being recorded, its id
  now: number;
};

/** The work in progress, reviews first, then the draft, then the meetings running or recorded. */
export function workItems({ reviews, compose, meetings, recording, now }: WorkInput): Work[] {
  return [
    ...reviews.map(r => ({
      key: workKey("review", r.item),
      kind: "review" as const,
      id: r.item,
      item: r.item,
      project: r.project,
      title: r.title,
      busy: false,
      closable: true,
    })),
    ...(compose
      ? [
          {
            key: workKey("mail", compose.mail),
            kind: "mail" as const,
            id: compose.mail,
            item: `mail:${compose.mail}`,
            project: compose.project,
            title: compose.title,
            busy: false,
            closable: true,
          },
        ]
      : []),
    ...meetings
      .filter(m => (m.start <= now && now < m.end) || m.id === recording)
      .map(m => ({
        key: workKey("meeting", m.id),
        kind: "meeting" as const,
        id: m.id,
        item: m.item,
        project: m.project,
        title: m.title,
        busy: m.id === recording,
        closable: false,
      })),
  ];
}
