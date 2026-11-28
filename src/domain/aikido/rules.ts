// Aikido issues per vault project (application/aikido): what the API answers, read into what the Security panel shows,
// and the prompt that asks an agent to fix a group. Every text here is the scanner's, so it reaches a prompt only
// inside an untrusted block.
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts.ts";

export type Severity = "critical" | "high" | "medium" | "low";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
/** A code repo as Aikido knows it: `url` its page at the provider ("" when Aikido gives none), `scanned` the last scan,
 *  epoch seconds, 0 when never. */
export type AikidoRepo = { id: number; name: string; provider: string; url: string; scanned: number };
/** An open issue group: one finding over one or more places. `repos`: the linked repos it was listed for. */
export type Group = {
  id: number;
  title: string;
  type: string;
  severity: Severity;
  score: number;
  locations: string[]; // the code repos' names
  howToFix: string;
  cves: string[];
  since: number; // first detected, epoch seconds, 0 when unknown
  minutes: number; // Aikido's estimate of the time to fix it, 0 when unknown
  repos: number[];
};
/** One issue of a group, from the export: where it is and what fixes it. */
export type Issue = {
  id: number;
  group: number;
  repo: string;
  file: string;
  start: number;
  end: number;
  pkg: string;
  installed: string;
  patched: string[];
  cve: string;
  sla: number; // remediate by, epoch seconds, 0 when none
};

type Json = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** A top-level array, or the first array inside an object (the docs do not say which /repositories/code answers). */
const rows = (v: unknown): Json[] => {
  if (Array.isArray(v)) return v.filter(x => x && typeof x === "object");
  const inner = v && typeof v === "object" ? Object.values(v).find(Array.isArray) : undefined;
  return inner ? rows(inner) : [];
};

/** GET /repositories/code → the repos, by name. */
export const reposOf = (answer: unknown): AikidoRepo[] =>
  rows(answer)
    .map(r => ({
      id: num(r.id),
      name: text(r.name),
      provider: text(r.provider),
      url: text(r.url),
      scanned: Math.max(0, num(r.last_scanned_at)),
    }))
    .filter(r => r.id > 0 && r.name)
    .sort((a, b) => a.name.localeCompare(b.name));

/** GET /open-issue-groups?filter_code_repo_id=… → that repo's groups. */
export const groupsOf = (answer: unknown, repo: number): Group[] =>
  rows(answer)
    .filter(g => num(g.id) > 0 && SEVERITIES.includes(g.severity as Severity))
    .map(g => ({
      id: num(g.id),
      title: text(g.title),
      type: text(g.type),
      severity: g.severity as Severity,
      score: num(g.severity_score),
      locations: rows(g.locations)
        .filter(l => String(l.type).startsWith("code_repo"))
        .map(l => text(l.name))
        .filter(Boolean),
      howToFix: text(g.how_to_fix),
      cves: Array.isArray(g.related_cve_ids) ? g.related_cve_ids.filter(c => typeof c === "string") : [],
      since: num(g.first_detected_at),
      minutes: num(g.time_to_fix_minutes),
      repos: [repo],
    }));

/** Worst first: the severity score, then the severity, then the oldest group. */
export const sortGroups = (groups: Group[]) =>
  [...groups].sort(
    (a, b) => b.score - a.score || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id - b.id,
  );
/** The groups of every linked repo as one list: a group listed for two repos once, with both. */
export function mergeGroups(lists: Group[][]): Group[] {
  const byId = new Map<number, Group>();
  for (const g of lists.flat()) {
    const had = byId.get(g.id);
    byId.set(g.id, had ? { ...had, repos: [...new Set([...had.repos, ...g.repos])] } : g);
  }
  return sortGroups([...byId.values()]);
}
export const worst = (groups: Group[]): Severity | null =>
  SEVERITIES.find(s => groups.some(g => g.severity === s)) ?? null;
export const isAlarm = (g: Group) => g.severity === "critical" || g.severity === "high";
/** The critical and high groups the user has not seen yet in this project: what makes the Security tab red. */
export const newAlarms = (groups: Group[], seen: number[]) => groups.filter(g => isAlarm(g) && !seen.includes(g.id));

/** What "Fix …" in the panel's footer takes on, one conversation per repo: critical and high (the default), only
 *  critical, quick wins (at most 30 minutes by Aikido's estimate, any severity), dependency updates, everything. */
export const FIX_FILTERS = ["critical-high", "critical", "quick-wins", "dependencies", "all"] as const;
export type FixFilter = (typeof FIX_FILTERS)[number];
export const QUICK_WIN_MINUTES = 30;
export const fixMatches = (filter: FixFilter, g: Group) =>
  filter === "critical-high"
    ? isAlarm(g)
    : filter === "critical"
      ? g.severity === "critical"
      : filter === "quick-wins"
        ? g.minutes > 0 && g.minutes <= QUICK_WIN_MINUTES
        : filter === "dependencies"
          ? g.type === "open_source"
          : true;
/** The issue export's own narrowing for a filter, so its 100 issues are the right ones; the rest is narrowed by group
 *  afterwards (the export cannot filter on the time to fix). */
export const exportQuery = (filter: FixFilter) =>
  filter === "critical-high"
    ? "&filter_severities=critical,high"
    : filter === "critical"
      ? "&filter_severities=critical"
      : filter === "dependencies"
        ? "&filter_issue_type=open_source"
        : "";

/** GET /issues/export?… → the issues. */
export const issuesOf = (answer: unknown): Issue[] =>
  rows(answer)
    .filter(i => num(i.id) > 0)
    .map(i => ({
      id: num(i.id),
      group: num(i.group_id),
      repo: text(i.code_repo_name),
      file: text(i.affected_file),
      start: num(i.start_line),
      end: num(i.end_line),
      pkg: text(i.affected_package),
      installed: text(i.installed_version),
      patched: Array.isArray(i.patched_versions) ? i.patched_versions.filter(v => typeof v === "string") : [],
      cve: text(i.cve_id),
      sla: num(i.sla_remediate_by),
    }));

/** Where an issue is, in one mono line: "src/a.php:88" or "src/a.php:88-92", the package for a dependency. */
export const placeOf = (i: Issue) => {
  const lines = i.start ? `:${i.start}${i.end > i.start ? `-${i.end}` : ""}` : "";
  const pkg = i.pkg
    ? `${i.pkg}${i.installed ? ` ${i.installed}` : ""}${i.patched.length ? ` → ${i.patched[0]}` : ""}`
    : "";
  return [i.file && `${i.file}${lines}`, pkg].filter(Boolean).join(" · ");
};
/** The scanner's type as the panel names it. */
const TYPES: Record<string, string> = {
  open_source: "open source",
  leaked_secret: "secret",
  sast: "SAST",
  iac: "IaC",
  eol: "EOL",
  malware: "malware",
  license: "license",
  cloud: "cloud",
  surface_monitoring: "surface",
  scm_security: "SCM",
  ai_pentest: "pentest",
};
export const typeLabel = (type: string) => TYPES[type] ?? type.replace(/_/g, " ");

/** "Owner/Name.git/" → "owner/name": a repo as a project lists it or as the path of its GitHub URL. */
const slugOf = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/^\/+/, "");
const urlPath = (url: string) => {
  try {
    return slugOf(new URL(url).pathname);
  } catch {
    return "";
  }
};
/** A project's Aikido repos, from the GitHub repos it is linked to (`owner/name`): Aikido's GitHub repos whose URL is
 *  that repo, case and a trailing `.git` or `/` aside. A repo Aikido gives no URL for matches on its name instead, but
 *  only when no other GitHub repo in Aikido has that name (two owners, one name: no guess). Other providers never. */
export function matchRepos(repos: AikidoRepo[], slugs: string[]): number[] {
  const github = repos.filter(r => r.provider === "github");
  const wanted = slugs.map(slugOf);
  return github
    .filter(r => {
      if (r.url) return wanted.includes(urlPath(r.url));
      const name = r.name.toLowerCase();
      const alone = github.filter(x => x.name.toLowerCase() === name).length === 1;
      return alone && wanted.some(s => s.split("/").pop() === name);
    })
    .map(r => r.id);
}

// the Aikido app per region, as packages/integration-aikido allows them; its API has no link to one issue
const HOSTS: Record<string, string> = {
  eu: "app.aikido.dev",
  us: "app.us.aikido.dev",
  au: "app.au.aikido.dev",
  me: "app.me.aikido.dev",
};
export const REGIONS = Object.keys(HOSTS);
/** The issues page of the region's app: the only Aikido link the panel opens. */
export const issuesPage = (region: string) => `https://${HOSTS[region] ?? HOSTS.eu}/issues`;

/** The prompt for a conversation that fixes exactly these groups, each with its issues (at most 10 a group), on
 *  `branch`, in the checkouts by repo name ("" when there is none on this Mac). */
export function fixPrompt(groups: Group[], issues: Issue[], checkouts: Record<string, string>, branch: string) {
  const findings = groups
    .map(g => {
      const mine = issues.filter(i => i.group === g.id).slice(0, 10);
      const places = mine.map(i => `  - ${[i.repo, placeOf(i), i.cve].filter(Boolean).join(": ")}`);
      const lines = [
        `- Groep ${g.id} · ${g.severity} · ${typeLabel(g.type)} · ${g.title}`,
        ...(places.length ? places : g.locations.map(l => `  - ${l}`)),
        ...(g.cves.length ? [`  CVE: ${g.cves.join(", ")}`] : []),
        ...(g.howToFix ? [`  Hoe op te lossen: ${g.howToFix.replace(/\s+/g, " ").trim()}`] : []),
      ];
      return lines.join("\n");
    })
    .join("\n");
  // repo names go outside the untrusted block, so only as a repo name may be written
  const repos = Object.keys(checkouts).filter(r => /^[\w.-]{1,100}$/.test(r));
  return fill(prompts.aikido.fix, {
    repos: repos.join(", "),
    checkouts: repos
      .map(r => `${r}: ${checkouts[r] || "geen checkout op deze Mac gevonden, vraag waar hij staat"}`)
      .join("; "),
    branch,
    findings: untrusted("aikido", findings),
    untrusted: untrustedNote("nl", ["aikido"]),
  });
}
