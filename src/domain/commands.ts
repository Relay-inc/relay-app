/** A slash command or skill as Claude Code's initialize answer lists it. */
export type SlashCommand = { name: string; description: string; argumentHint?: string };

/** The commands for what is typed: only while the field is a `/` and a name with no space yet. Names that start with
 * it first, then names that contain it, then descriptions that mention it. */
export function matchCommands(list: SlashCommand[], typed: string, max = 8): SlashCommand[] {
  const typedName = /^\/(\S*)$/.exec(typed)?.[1].toLowerCase();
  if (typedName === undefined) return [];
  const rank = (command: SlashCommand) => {
    const name = command.name.toLowerCase();
    if (name.startsWith(typedName)) return 0;
    if (name.includes(typedName)) return 1;
    return command.description.toLowerCase().includes(typedName) ? 2 : -1;
  };
  return list
    .map(command => ({ command, rank: rank(command) }))
    .filter(match => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.command.name.localeCompare(b.command.name))
    .slice(0, max)
    .map(match => match.command);
}
