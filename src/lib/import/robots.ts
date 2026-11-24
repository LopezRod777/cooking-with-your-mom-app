// Minimal robots.txt reader (RFC 9309 subset) with a wildcard matcher without regex: may our fetch read this path? our agent group first, else the `*` group; longest match wins; unknown or empty file = allowed.

export type RobotsRules = { allow: string[]; disallow: string[]; truncated: boolean };

type Group = { agents: string[]; allow: string[]; disallow: string[]; hasRules: boolean; capDropped: boolean };

export const ROBOTS_LIMITS = { rules: 2000, patternChars: 500, pathChars: 2048, fileChars: 512_000, steps: 200_000 } as const;

export function parseRobots(text: string, agent?: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let ruleCount = 0;
  let droppedPattern = false;
  const fileTruncated = text.length > ROBOTS_LIMITS.fileChars;

  for (const raw of text.slice(0, ROBOTS_LIMITS.fileChars).split(/\r?\n/)) {
    const hashAt = raw.indexOf("#");
    const line = (hashAt >= 0 ? raw.slice(0, hashAt) : raw).trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], allow: [], disallow: [], hasRules: false, capDropped: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      current.hasRules = true;
      if (value === "") continue;
      if (value.length > ROBOTS_LIMITS.patternChars) {
        droppedPattern = true;
        continue;
      }
      if (ruleCount >= ROBOTS_LIMITS.rules) {
        current.capDropped = true;
        continue;
      }
      ruleCount++;
      const pattern = normalizePath(value);
      if (field === "allow") current.allow.push(pattern);
      else current.disallow.push(pattern);
    }
  }

  const wanted = agent?.trim().toLowerCase();
  const agentGroups = wanted ? groups.filter((g) => g.agents.includes(wanted)) : [];
  const selected = agentGroups.length > 0 ? agentGroups : groups.filter((g) => g.agents.includes("*"));

  return {
    allow: selected.flatMap((g) => g.allow),
    disallow: selected.flatMap((g) => g.disallow),
    truncated: fileTruncated || droppedPattern || selected.some((g) => g.capDropped),
  };
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;

// Decodes %XX only when the byte is an unreserved character; otherwise keeps it encoded with uppercase hex.
function normalizePath(p: string): string {
  return p.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    if (UNRESERVED.test(ch)) return ch;
    return "%" + hex.toUpperCase();
  });
}

// Iterative two-pointer wildcard match: `*` matches any run, a trailing `$` anchors the end,
// otherwise the pattern must match a prefix of the path. One "last star" backtrack position, no recursion.
// Every inner-loop step spends one unit of `budget`; at 0 the match gives up with "budget".
function globMatch(pattern: string, path: string, budget: { left: number }): boolean | "budget" {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern + "*";
  let pi = 0;
  let si = 0;
  let starP = -1;
  let starS = 0;
  while (si < path.length) {
    if (--budget.left <= 0) return "budget";
    if (pi < p.length && p[pi] === "*") {
      starP = pi++;
      starS = si;
    } else if (pi < p.length && p[pi] === path[si]) {
      pi++;
      si++;
    } else if (starP >= 0) {
      pi = starP + 1;
      si = ++starS;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

function patternLength(pattern: string): number {
  return pattern.endsWith("$") ? pattern.length - 1 : pattern.length;
}

// Fail closed: an incomplete parse, an over-long path, or an exhausted step budget all answer false.
export function robotsAllows(rules: RobotsRules, rawPath: string): boolean {
  if (rules.truncated) return false;
  if (rawPath.length > ROBOTS_LIMITS.pathChars) return false;
  const path = normalizePath(rawPath);
  const budget = { left: ROBOTS_LIMITS.steps };

  let bestAllow = -1;
  for (const p of rules.allow) {
    const len = patternLength(p);
    const m: boolean | "budget" = len > bestAllow ? globMatch(p, path, budget) : false;
    if (m === "budget") return false;
    if (m) bestAllow = len;
  }

  let bestDisallow = -1;
  for (const p of rules.disallow) {
    const len = patternLength(p);
    const m: boolean | "budget" = len > bestDisallow ? globMatch(p, path, budget) : false;
    if (m === "budget") return false;
    if (m) bestDisallow = len;
  }

  if (bestAllow < 0 && bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

export function pathAllowedBy(robotsTxt: string | null, path: string, agent?: string): boolean {
  if (!robotsTxt) return true;
  return robotsAllows(parseRobots(robotsTxt, agent), path);
}
