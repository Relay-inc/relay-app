// "Time from sessions": the day's time per project, counted from when the user wrote in a conversation. The agent's
// own running time does not count, only the user's presence around each message. Times are epoch ms.
import { fill, prompts } from "../../shared/prompts.ts";

const MIN = 60_000;
/** Each message counts this long on both sides of it. Intervals that touch or overlap are one block. */
const AROUND = 10 * MIN;
const STEP = 15;

/** A message of the user in a conversation under `project`. */
export type Activity = { project: string; title: string; at: number };
export type TimeLine = { project: string; minutes: number; titles: string[] };

/** Per project the minutes to book: the blocks around its messages (a block is merged with the next when the messages
 *  are within 15 minutes, which the overlap of the two intervals already does), time in two projects at once split
 *  evenly, rounded to the nearest 15 minutes, a project under 15 minutes dropped. Most minutes first.
 *  ponytail: an even split of an overlap, not a guess at which project the user was really in. */
export function timeLines(events: Activity[]): TimeLine[] {
  const spans = events.map(e => ({ project: e.project, from: e.at - AROUND, to: e.at + AROUND }));
  const cuts = [...new Set(spans.flatMap(s => [s.from, s.to]))].sort((a, b) => a - b);
  const total = new Map<string, number>();
  for (let i = 0; i < cuts.length - 1; i++) {
    const active = new Set(spans.filter(s => s.from <= cuts[i] && s.to >= cuts[i + 1]).map(s => s.project));
    for (const project of active)
      total.set(project, (total.get(project) ?? 0) + (cuts[i + 1] - cuts[i]) / MIN / active.size);
  }
  return [...total]
    .filter(([, raw]) => raw >= STEP)
    .map(([project, raw]) => ({
      project,
      minutes: Math.round(raw / STEP) * STEP,
      titles: [
        ...new Set(
          events
            .filter(e => e.project === project)
            .sort((a, b) => a.at - b.at)
            .map(e => e.title),
        ),
      ],
    }))
    .sort((a, b) => b.minutes - a.minutes || a.project.localeCompare(b.project));
}

/** The first message to the agent for a "Time <date>" conversation. `lines` carry the Relay project, its label and the
 *  Productive board it is linked to (a board id of provider productive), if any; `sids` are the sessions they were
 *  counted from. The agent adds the sources of weareantenna/antenna-tools' timesheet skill: calendar, Slack, git, other
 *  Claude Code sessions, Google Drive, Jira, Notion, Figma. */
export function timePrompt(
  date: string,
  lines: { label: string; minutes: number; titles: string[]; board?: string }[],
  sids: string[] = [],
) {
  const list = lines
    .map(
      l =>
        `- ${l.label}: ${l.minutes} min${l.board ? ` (Productive-project ${l.board})` : ""}; gesprekken: ${l.titles.map(t => `"${t}"`).join(", ")}`,
    )
    .join("\n");
  return [
    lines.length ? fill(prompts.time.intro, { date, list }) : fill(prompts.time.introEmpty, { date }),
    fill(prompts.time.booking, {
      date,
      counted: sids.length ? `de sessies hierboven al geteld: ${sids.join(", ")}` : "geen, er is nog niets geteld",
    }),
  ].join("\n\n");
}
