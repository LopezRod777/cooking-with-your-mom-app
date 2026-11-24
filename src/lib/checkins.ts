import { isMinor, type AppState, type CheckIn, type Person, type Want } from "./schemas";

// Two-week check-ins. The rule, taken from how MacroFactor and Carbon adjust (their help centers, read 2026-11-03):
// hold unless the data says move, move in small steps, and never change anything without the person's tap.

export const CHECKIN_DAYS = 14;
export const SNOOZE_DAYS = 3;
export const STEP_KCAL = 150;
export const MAX_ADJUST = 400;

export const WANT_LABEL: Record<Want, string> = {
  variety: "More variety",
  faster: "Faster meals",
  cheaper: "Cheaper",
  filling: "More filling",
  lighter: "Lighter",
};
// What each want tells the plan. No names, no numbers about bodies.
const WANT_PROMPT: Record<Want, string> = {
  variety: "more variety across the week (no repeated main protein two days in a row)",
  faster: "faster meals (20 minutes or less where possible)",
  cheaper: "cheaper ingredients (beans, eggs, chicken thighs, frozen vegetables)",
  filling: "more filling plates (more volume: vegetables, beans, potatoes, whole grains)",
  lighter: "lighter meals (less oil and cheese, more vegetables)",
};

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

export function lastCheckin(checkins: CheckIn[], personId: string): CheckIn | null {
  const mine = checkins.filter((c) => c.personId === personId).sort((a, b) => (a.at < b.at ? 1 : -1));
  return mine[0] ?? null;
}

// People whose check-in is due today: 14 days after the last one, or after the day they were added (unknown = due).
// "Later" snoozes one person, not the house.
export function dueFor(state: Pick<AppState, "people" | "checkins">, today = todayKey()): Person[] {
  // Kids do not check in: their plate comes from the age table and a grown-up changes it in Settings.
  return state.people.filter((p) => {
    if (isMinor(p)) return false;
    if (p.snoozedUntil && p.snoozedUntil > today) return false;
    const last = lastCheckin(state.checkins, p.id)?.at ?? p.addedAt;
    return last === null || daysBetween(last, today) >= CHECKIN_DAYS;
  });
}

export function snooze(person: Person, today = todayKey()): Person {
  return { ...person, snoozedUntil: addDays(today, SNOOZE_DAYS) };
}

export type Answers = Pick<CheckIn, "energy" | "hunger" | "meals" | "weightLb" | "wants">;

// The oldest saved check-in nobody has answered yet (Apply, Keep as is, or Got it on a hold), whatever its date:
// a decision left overnight is still waiting the next morning.
export function pendingFor(state: Pick<AppState, "checkins" | "people">): CheckIn | null {
  // A check-in left open for someone who is now a minor stays closed: kids do not check in.
  const minors = new Set(state.people.filter(isMinor).map((p) => p.id));
  return [...state.checkins].sort((a, b) => (a.at < b.at ? -1 : 1)).find((c) => !c.applied && !c.kept && !minors.has(c.personId)) ?? null;
}
export type Suggestion = { move: "hold" | "up" | "down"; why: string };

// Weight change (lb) against the last weigh-in, only if that weigh-in is recent enough to mean something
// (10 to 35 days ago); null otherwise. Returns the days too, so the reason can say the real span.
export const TREND_MIN_DAYS = 10;
export const TREND_MAX_DAYS = 35;
export function weightTrendLb(checkins: CheckIn[], personId: string, current: number | null, today = todayKey()): { lb: number; days: number } | null {
  const prev = checkins.filter((c) => c.personId === personId && c.weightLb !== null).sort((a, b) => (a.at < b.at ? -1 : 1));
  const last = prev[prev.length - 1];
  if (!last || current === null) return null;
  const days = daysBetween(last.at, today);
  if (days < TREND_MIN_DAYS || days > TREND_MAX_DAYS) return null;
  return { lb: current - (last.weightLb as number), days };
}

export function suggest(person: Person, answers: Answers, checkins: CheckIn[], today = todayKey()): Suggestion {
  // Under 16: never a cut, never a "down".
  const minor = isMinor(person);
  const cutting = !minor && (person.goal === "lean" || person.goal === "rapid_fat_loss");
  const gaining = person.goal === "clean_bulk";
  const room = (dir: 1 | -1) => Math.abs(person.kcalAdjust + dir * STEP_KCAL) <= MAX_ADJUST;
  // 1. How they feel beats the scale.
  if (answers.hunger === "hungry" && answers.energy === "low") {
    return room(1)
      ? { move: "up", why: "Hungry and low on energy for two weeks means your body is asking for more, so Mama is adding about 150 kcal to your plates." }
      : { move: "hold", why: "Still hungry and low, and Mama has already added what she can, so let's look at your sleep and protein first." };
  }
  if (answers.hunger === "stuffed" && !gaining) {
    if (minor) return { move: "hold", why: "You're still growing, so Mama keeps your plates just the way they are." };
    return room(-1)
      ? { move: "down", why: "Stuffed most days means the plates are bigger than you need, so Mama is taking about 150 kcal off." }
      : { move: "hold", why: "Still stuffed, so Mama holds here and you try smaller sides before anything else." };
  }
  // 2. The scale, only with two weigh-ins, only when it argues with the goal.
  const trend = weightTrendLb(checkins, person.id, answers.weightLb, today);
  if (trend !== null) {
    if (cutting && trend.lb >= 1 && room(-1)) return { move: "down", why: `You're up ${trend.lb.toFixed(1)} lb in ${trend.days} days on a cut, so Mama takes a small step down, about 150 kcal.` };
    if (gaining && trend.lb <= -1 && room(1)) return { move: "up", why: `You're down ${Math.abs(trend.lb).toFixed(1)} lb in ${trend.days} days while building, so Mama takes a small step up, about 150 kcal.` };
  }
  return { move: "hold", why: "Everything looks on track, so Mama keeps your plates right where they are." };
}

export function applyMove(person: Person, move: Suggestion["move"]): Person {
  if (move === "hold" || (move === "down" && isMinor(person))) return person;
  const next = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, person.kcalAdjust + (move === "up" ? STEP_KCAL : -STEP_KCAL)));
  return { ...person, kcalAdjust: next };
}

// One prompt line from the latest check-in of each grown-up: wants only, merged, no names (a child's wish never thins the shared dish).
export function wantsPromptLine(people: Person[], checkins: CheckIn[]): string | null {
  const wants = new Set<Want>();
  for (const p of people) {
    if (isMinor(p)) continue;
    for (const w of lastCheckin(checkins, p.id)?.wants ?? []) wants.add(w);
  }
  if (wants.size === 0) return null;
  return `- Asked for at the last check-in: ${[...wants].map((w) => WANT_PROMPT[w]).join("; ")}.`;
}
