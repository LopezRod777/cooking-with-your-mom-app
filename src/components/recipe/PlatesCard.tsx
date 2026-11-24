"use client";

import { useState } from "react";
import { PLATE_LABEL, adultGoalsDiffer, plateSplit } from "@/lib/people";
import { isMinor, type Person, type Recipe } from "@/lib/schemas";

// Who gets what tonight. Protein and vegetables are the same on every plate; only the side moves with the plate each
// Mama sized from each person's estimate. Calories stay behind "Details" on purpose (Jev concept test 2026-11-03:
// numbers up front read as a judgement to whoever is on a cut).
// Mama's line for the little ones, shown under the steps (recipe) and on the cook finish screen. Null when there is none.
export function kidNoteLine(note: string | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  return /^for the little ones/i.test(text) ? text : `For the little ones, ${text}`;
}

// Static fallback for a toddler (3 or under) at the table when the recipe has no kidNote of its own.
export const TODDLER_NOTE = "For the little ones, cut everything nice and small, leave out whole nuts and whole grapes, and keep the spicy stuff on the side.";

// The note to show under the steps and on the finish screen: the recipe's own kidNote, else the toddler fallback.
export function kidNoteFor(recipe: { kidNote?: string }, people: Person[]): string | null {
  // Only a table with a minor sees it: a saved or shared recipe may carry a note from someone else's table.
  if (!people.some(isMinor)) return null;
  const own = kidNoteLine(recipe.kidNote);
  if (own) return own;
  return people.some((p) => p.age !== null && p.age <= 3) ? TODDLER_NOTE : null;
}

// Mama's line on how the plates differ by goal: only when the grown-ups at this table want different things.
export function plateNoteFor(recipe: { plateNote?: string }, people: Person[]): string | null {
  const text = recipe.plateNote?.trim();
  if (!text || !adultGoalsDiffer(people)) return null;
  return text;
}

export function PlatesCard({ recipe, servings, people, compact = false }: { recipe: Recipe; servings: number; people: Person[]; compact?: boolean }) {
  const [details, setDetails] = useState(false);
  const split = plateSplit(recipe, servings, people);
  if (!split.worthShowing) return null;
  const side = split.side;
  return (
    <section data-testid="plates" aria-label="Plates" className={`grid gap-3 rounded-[20px] border border-line bg-panel ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-semibold">Plates tonight</h2>
        {people.length >= 2 && (
          <button type="button" onClick={() => setDetails((d) => !d)} aria-expanded={details} className="min-h-12 px-2 text-[16px] font-semibold text-muted underline underline-offset-4">
            {details ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      {people.length >= 2 && (
        <ul className="grid gap-1.5">
          {/* Everyone on the same plate: say it once in the footer, not on every row. */}
          {split.rows.map((row) => (
            <li key={row.person.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-[18px]">
              <span className="font-semibold">
                {row.label}
                {isMinor(row.person) && <span className="font-normal text-muted"> (kid)</span>}
                {!split.allSame && !isMinor(row.person) && (
                  <>
                    {" "}
                    <span className="font-normal text-muted">· {PLATE_LABEL[row.plate].toLowerCase()} plate</span>
                  </>
                )}
              </span>
              <span className="text-muted">
                {split.allSame ? (
                  details && row.kcal !== null ? `about ${row.kcal} kcal` : ""
                ) : (
                  <>
                    {side && row.sideGrams !== null ? `${row.sideGrams} g ${side.displayName.toLowerCase()}` : "same as everyone"}
                    {details && row.kcal !== null ? ` · about ${row.kcal} kcal` : ""}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {people.length >= 2 && (
        <p className="text-[16px] leading-snug text-muted">
          {split.allSame
            ? split.rows[0]
              ? `Same ${PLATE_LABEL[split.rows[0].plate].toLowerCase()} plate for everyone.`
              : "Same plate for everyone."
            : side
              ? split.wholePlate
                ? "Mama makes the kids' plates a little smaller all around, not just the side."
                : `Protein and vegetables are the same on every plate; only the ${side.displayName.toLowerCase()} changes.`
              : "No side to scale in this one: same plate for everyone, seconds for the hearty plates."}
        </p>
      )}
      {plateNoteFor(recipe, people) && (
        <p data-testid="plate-note" className="font-hand text-[19px] leading-snug text-ink">{plateNoteFor(recipe, people)}</p>
      )}
      {split.leftovers > 0 && (
        <p className="text-[16px] font-semibold leading-snug">
          Cooking {servings}, eating {people.length}: {split.leftovers % 1 === 0 ? split.leftovers : split.leftovers.toFixed(1)} {split.leftovers === 1 ? "serving" : "servings"} left for tomorrow.
        </p>
      )}
    </section>
  );
}
