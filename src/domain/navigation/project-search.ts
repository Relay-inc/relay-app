export type SearchProject = { name: string; context: string; aliases: string[]; label?: string };

const normalized = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Names and labels rank before aliases/context; every word must match, regardless of accents or case. */
export function searchProjects<T extends SearchProject>(projects: T[], query: string, limit = 8): T[] {
  const needle = normalized(query);
  if (!needle) return [];
  const words = needle.split(/\s+/);
  return projects
    .map(project => {
      const names = [project.name, project.label || ""].map(normalized).filter(Boolean);
      const terms = [...names, ...project.aliases.map(normalized), normalized(project.context)];
      const rank = names.includes(needle)
        ? 0
        : names.some(name => name.startsWith(needle))
          ? 1
          : names.some(name => name.includes(needle))
            ? 2
            : 3;
      return { project, rank, matches: words.every(word => terms.some(term => term.includes(word))) };
    })
    .filter(result => result.matches)
    .sort((a, b) => a.rank - b.rank || a.project.name.localeCompare(b.project.name))
    .slice(0, limit)
    .map(result => result.project);
}
