import type { TicketFlow } from "@relay/board-core";

// The lead's grooming comment ("Ticket flow:") and the developer's report ("Ticket built:") are plain-text conventions
// in hidden comments, written by hand and mostly in Dutch. Read them leniently: keywords in any case, Dutch synonyms.

const text = (html: string) => html.replace(/<\/(p|li|div|h\d|tr)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

const VERDICTS: [RegExp, TicketFlow["verdict"]][] = [[/^(not ready|niet klaar)\b/i, "not-ready"], [/^(ready|klaar)\b/i, "ready"], [/^(split|splitsen)\b/i, "split"]];

function parse(body: string): Omit<TicketFlow, "built"> | undefined {
  const lines = body.replace(/^ticket flow\s*:/i, "").split("\n").map(l => l.trim()).filter(Boolean);
  // the verdict is the first line, maybe after "Verdict:"; a block whose first line names none is not a verdict
  const first = (lines[0] || "").replace(/^(verdict|oordeel)\s*:\s*/i, "");
  const verdict = VERDICTS.find(([re]) => re.test(first))?.[1];
  if (!verdict) return;
  const rest = lines.slice(1).join("\n");
  const size = rest.match(/(?:size|grootte)\s*:?\s*([SML])\b(?:\s*\(([^)\n]*)\))?/i);
  const risk = rest.match(/(?:risk|risico)\s*:?\s*(high|hoog|normal|normaal|low|laag)\b/i)?.[1].toLowerCase();
  const budget = rest.match(/budget\s*:?\s*(.+)/i)?.[1].trim();
  return { verdict, size: size?.[1].toUpperCase() as TicketFlow["size"], hours: size?.[2]?.trim() || undefined,
    risk: risk ? (/^(high|hoog)$/.test(risk) ? "high" : "normal") : undefined, budget: budget || undefined };
}

/** The latest `Ticket flow:` verdict among a task's comments, and whether a `Ticket built:` comment came after it. */
export function ticketFlow(comments: { at: string; html: string }[]): TicketFlow | undefined {
  const sorted = comments.map(c => ({ at: c.at, body: text(c.html) })).sort((a, b) => b.at.localeCompare(a.at));
  // a latest flow comment without a readable verdict gives way to the one before it
  for (const [i, c] of sorted.entries()) {
    if (!/^ticket flow\s*:/i.test(c.body)) continue;
    const flow = parse(c.body);
    if (flow) return { ...flow, built: sorted.slice(0, i).some(b => /^ticket (built|gebouwd)\s*:/i.test(b.body)) };
  }
  return undefined;
}
