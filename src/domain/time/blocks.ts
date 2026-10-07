// "Time from sessions": the day's time per project, counted from when the user wrote in a conversation. The agent's
// own running time does not count, only the user's presence around each message. Times are epoch ms.
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
 *  Productive board it is linked to (a board id of provider productive), if any. */
export function timePrompt(
  date: string,
  lines: { label: string; minutes: number; titles: string[]; board?: string }[],
) {
  const list = lines
    .map(
      l =>
        `- ${l.label}: ${l.minutes} min${l.board ? ` (Productive-project ${l.board})` : ""}; gesprekken: ${l.titles.map(t => `"${t}"`).join(", ")}`,
    )
    .join("\n");
  return [
    `Boek mijn tijd van ${date} in Productive. Dit is mijn eigen activiteit in Relay-gesprekken (de tijd rond mijn berichten, de looptijd van de agent telt niet mee), afgerond op 15 minuten:`,
    list,
    "Werk zo:",
    `1. Haal met \`relay productive.time_entries\` (after en before ${date}) op wat al geboekt is. Een entry heeft enkel een service-id: zoek per project de services op met \`relay productive.services\` om te weten bij welk project ze horen. Trek het geboekte per project af van de minuten hierboven en boek nooit dubbel; blijft er minder dan 15 minuten over, sla het project over.`,
    "2. Koppel elk Relay-project aan zijn Productive-project: gebruik het project-id hierboven als dat er staat, anders zoek je het met `relay productive.projects` op naam. Kies met `relay productive.services` de passende service (budgetlijn).",
    "3. Doe per project één voorstel met `relay productive.add_time` (service, date, minutes, een korte note opgebouwd uit de titels van de gesprekken). Ik keur elke boeking goed of corrigeer ze in de kaart.",
    "4. Som op het einde op wat geboekt is en wat je oversloeg.",
  ].join("\n\n");
}
