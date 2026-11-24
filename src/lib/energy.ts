import { Person as PersonSchema, isMinor, type Person, type Plate, type SportId } from "./schemas";
import { childKcal, childProteinG } from "./childEnergy";

// Per-person energy and protein estimates. Every number here has a source:
// - Resting energy: Mifflin–St Jeor (Mifflin et al., Am J Clin Nutr 1990; PubMed 2305711).
// - Day-to-day baseline without sport: PAL 1.4, the low end of the FAO/WHO/UNU 2001 "sedentary or light activity"
//   band (1.40–1.69), because students mostly sit; sport is added on top as NET METs so it is never counted twice.
// - Sport cost: 2024 Adult Compendium of Physical Activities (Herrmann, Willis, Ainsworth et al., JSHS 2024),
//   rows read on pacompendium.com on 2026-11-03; code in each entry. 1 MET = 1 kcal·kg⁻¹·h⁻¹.
// - Goal shifts and protein per kg are product choices within common practice (see docs/plans/2026-11-03-people-and-checkins.md).
// Everything is an estimate the person can edit; nothing here is medical advice.

export const SPORTS: Record<SportId, { label: string; met: number; code: string }> = {
  weights: { label: "Weights", met: 5.0, code: "02052" },
  running: { label: "Running", met: 9.3, code: "12050" },
  cycling: { label: "Cycling", met: 8.0, code: "01030" },
  swimming: { label: "Swimming", met: 5.8, code: "18240" },
  soccer: { label: "Soccer", met: 7.0, code: "15610" },
  basketball: { label: "Basketball", met: 7.5, code: "15055" },
  climbing: { label: "Climbing", met: 5.8, code: "15537" },
  hiit: { label: "HIIT / CrossFit", met: 7.0, code: "02210" },
  tennis: { label: "Tennis / racket", met: 6.8, code: "15675" },
  walking: { label: "Walking", met: 3.8, code: "17190" },
  bodyweight: { label: "Bodyweight / Pilates", met: 3.0, code: "02056" },
};
export const SPORT_ORDER: SportId[] = ["weights", "running", "cycling", "swimming", "soccer", "basketball", "climbing", "hiit", "tennis", "walking", "bodyweight"];

const BASE_PAL = 1.4;
const SOMETIMES = { days: 1, minutes: 45 };
const DEFAULT_MET = 5.0;
export const GOAL_FACTOR: Record<Person["goal"], number> = { grow: 1, eat_well: 1, lean: 0.85, rapid_fat_loss: 0.8, clean_bulk: 1.1 };
// Protein per kg: ISSN position stand (Jäger et al., JISSN 2017, PMC5477153): 1.4–2.0 g/kg/day for exercising people,
// 2.3–3.1 g/kg/day for resistance-trained people in an energy deficit. Someone who does not train sits below the band.
function proteinPerKg(p: Pick<Person, "goal" | "training">): number {
  const trains = p.training === "regular" || p.training === "sometimes";
  switch (p.goal) {
    case "rapid_fat_loss": return trains ? 2.3 : 2.0;
    case "lean": return 1.8;
    case "clean_bulk": return 1.6;
    default: return trains ? 1.4 : 1.2;
  }
}

export type Estimate = { restingKcal: number; sportKcalPerDay: number; kcal: number; proteinG: number };

export function restingKcal(p: Pick<Person, "sex" | "age" | "heightCm" | "weightKg">): number | null {
  if (!p.sex || p.sex === "unspecified" || p.age === null || p.heightCm === null || p.weightKg === null) return null;
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "man" ? base + 5 : base - 161;
}

// Net kcal/day from sport: Σ (MET − 1) × kg × hours per session × sessions per week ÷ 7, MET averaged over the sports picked.
export function sportKcalPerDay(p: Pick<Person, "weightKg" | "training" | "sports" | "daysPerWeek" | "minutesPerSession">): number {
  if (p.weightKg === null || !p.training || p.training === "none") return 0;
  const mets = p.sports.map((s) => SPORTS[s].met);
  const met = mets.length ? mets.reduce((a, b) => a + b, 0) / mets.length : DEFAULT_MET;
  const days = p.training === "sometimes" ? SOMETIMES.days : (p.daysPerWeek ?? 0);
  const minutes = p.training === "sometimes" ? SOMETIMES.minutes : (p.minutesPerSession ?? 0);
  return ((met - 1) * p.weightKg * (minutes / 60) * days) / 7;
}

const round = (n: number, to: number) => Math.round(n / to) * to;

export function estimateFor(p: Person): Estimate | null {
  // Under 16: the DGA table by age, sex and activity; no weight or height needed. A check-in can add to it, never take from it.
  if (isMinor(p)) {
    const table = p.age === null ? null : childKcal(p.age, p.sex, p.activity);
    if (table === null) return null;
    const kcal = table + Math.max(0, p.kcalAdjust ?? 0);
    return { restingKcal: 0, sportKcalPerDay: 0, kcal, proteinG: childProteinG(p.age as number, p.sex) ?? 0 };
  }
  const rest = restingKcal(p);
  if (rest === null || p.weightKg === null) return null;
  const sport = sportKcalPerDay(p);
  const maintenance = rest * BASE_PAL + sport;
  const factor = GOAL_FACTOR[p.goal];
  // Floor: never under resting × 1.2, enforced after rounding (the floor rounds up, the target to the nearest 50).
  const floor = Math.ceil((rest * 1.2) / 50) * 50;
  // Check-in steps apply on top of what the person was shown, so "+150" is always +150.
  const kcal = Math.max(floor, round(maintenance * factor, 50)) + (p.kcalAdjust ?? 0);
  const proteinG = Math.min(250, p.weightKg * proteinPerKg(p));
  return { restingKcal: Math.round(rest), sportKcalPerDay: Math.round(sport), kcal, proteinG: round(proteinG, 5) };
}

// Complete = every field Mama needs is in AND the whole person passes the schema (ranges, integers), so a card the
// UI accepts can never produce a state the server or the next cache parse rejects.
export function isComplete(p: Person): boolean {
  if (!PersonSchema.safeParse(p).success) return false;
  // Under 16: age and sex are enough (activity falls back to moderately active).
  if (isMinor(p)) return p.age !== null && p.sex !== null;
  // Skipped the details: complete as is (regular plate, no estimate). Lily, Emma and Chloe in the Miro run.
  if (p.sex === "unspecified") return true;
  if (!p.sex || p.age === null || p.heightCm === null || p.weightKg === null || !p.training) return false;
  if (p.training === "regular") return p.sports.length > 0 && p.daysPerWeek !== null && p.minutesPerSession !== null;
  return true;
}

// Plate weight = this person's kcal ÷ the table's mean kcal. People without an estimate get 1 (a regular plate).
// When fewer than two people have an estimate but the grown-ups' goals differ, the goal factors stand in for the
// estimates (a cut is a lighter plate, a bulk a heartier one), so the side still follows the goal; children stay at 1.
export function plateWeights(people: Person[]): number[] {
  const kcals = people.map((p) => estimateFor(p)?.kcal ?? null);
  const known = kcals.filter((k): k is number => k !== null);
  if (known.length >= 2) {
    const mean = known.reduce((a, b) => a + b, 0) / known.length;
    return kcals.map((k) => (k === null ? 1 : k / mean));
  }
  if (!goalSplit(people)) return people.map(() => 1);
  const adults = people.filter((p) => !isMinor(p));
  const mean = adults.reduce((s, p) => s + GOAL_FACTOR[p.goal], 0) / adults.length;
  return people.map((p) => (isMinor(p) ? 1 : GOAL_FACTOR[p.goal] / mean));
}

// True when the split has to come from the goals: fewer than two grown-ups with an estimate (a child's table number does
// not count), two or more grown-ups, goals not all the same.
export function goalSplit(people: Person[]): boolean {
  const adults = people.filter((p) => !isMinor(p));
  const known = adults.filter((p) => estimateFor(p) !== null).length;
  if (known >= 2) return false;
  return adults.length >= 2 && new Set(adults.map((p) => p.goal)).size >= 2;
}

export function plateLabel(weight: number): Plate {
  return weight < 0.9 ? "light" : weight > 1.1 ? "hearty" : "regular";
}

const PLATE_BY_GOAL: Record<Person["goal"], Plate> = { lean: "light", rapid_fat_loss: "light", clean_bulk: "hearty", eat_well: "regular", grow: "regular" };

// Plate labels for the table: from the energy weights when there are estimates; from the goals when the split comes
// from the goals (so "Get lean" against "Just eat well" reads light / regular, not regular / regular).
export function plateLabels(people: Person[]): Plate[] {
  if (!goalSplit(people)) return plateWeights(people).map(plateLabel);
  return people.map((p) => (isMinor(p) ? "regular" : PLATE_BY_GOAL[p.goal]));
}

// Units for US students: feet/inches and pounds in, centimetres and kilograms stored.
export const cmFromFtIn = (ft: number, inches: number) => Math.round((ft * 12 + inches) * 2.54 * 10) / 10;
export const ftInFromCm = (cm: number) => { const total = Math.round(cm / 2.54); return { ft: Math.floor(total / 12), in: total % 12 }; };
export const kgFromLb = (lb: number) => Math.round(lb * 0.45359237 * 10) / 10;
export const lbFromKg = (kg: number) => Math.round(kg / 0.45359237);
