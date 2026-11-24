"use client";

import { dateKey, extrasRemaining, gramsGivenToday, EXTRAS_LOG_MAX } from "@/lib/pets/energy";
import { gramsThatFit, type PetFood } from "@/lib/pets/foods";
import { fitNote, vetNoteFor } from "@/lib/pets/vetNotes";
import type { Pet } from "@/lib/schemas";

type ExtrasEntry = Pet["extrasLog"][number];

// Today's plain foods as tap-to-log chips. Tap logs one food; a logged chip turns green and tap again undoes that entry.
// The vet notes for these foods sit in a "Why these foods" disclosure under the grid.
export function ShareChips({
  pet,
  foods,
  now,
  full,
  onGive,
  onUndo,
}: {
  pet: Pet;
  foods: PetFood[];
  now: Date;
  full: boolean;
  onGive: (food: PetFood) => void;
  onUndo: (entry: ExtrasEntry) => void;
}) {
  const today = dateKey(now);
  const remaining = extrasRemaining(pet, now);
  const notes: { food: PetFood; text: string; org: string; url: string }[] = [];
  for (const food of foods) {
    const vet = vetNoteFor(food.id, pet.species);
    if (vet?.note) notes.push({ food, text: fitNote(vet.note, vet.source.org), org: vet.source.org, url: vet.source.url });
  }

  return (
    <section className="grid content-start gap-4" aria-label={`Today you can share with ${pet.name}`}>
      <div className="grid gap-1">
        <h2 className="font-display text-[26px] leading-tight">Today {pet.name} can share</h2>
        <p className="text-[16px] leading-snug text-muted">
          Tap what you gave. All cooked plain: no salt, no oil, no skin, no seeds.
        </p>
      </div>
      {full && <p className="text-[17px] font-semibold">Today&apos;s log is full ({EXTRAS_LOG_MAX}).</p>}
      {remaining <= 0 && <p className="text-[17px] text-muted">Nothing more today.</p>}

      <ul className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
        {foods.map((food) => {
          const logged = pet.extrasLog.filter((e) => e.date === today && e.foodId === food.id);
          const entry = logged[logged.length - 1];
          const done = entry !== undefined;
          const grams = entry ? (entry.grams ?? 0) : gramsThatFit(food, remaining, pet.species, gramsGivenToday(pet, food.id, today));
          const name = food.shortLabel.toLowerCase();
          return (
            <li key={food.id}>
              <button
                type="button"
                title={food.label}
                aria-pressed={done}
                aria-label={done ? `Undo ${grams} g ${name} for ${pet.name}` : `Log ${grams} g ${name} for ${pet.name}`}
                disabled={!done && (grams <= 0 || full)}
                onClick={() => (entry ? onUndo(entry) : onGive(food))}
                className={`flex min-h-16 w-full flex-col justify-center gap-0.5 rounded-[18px] border px-3.5 py-2.5 text-left transition-colors disabled:opacity-40 ${
                  done ? "border-transparent bg-basil-soft text-basil-text" : "border-line bg-white text-ink"
                }`}
              >
                <span className="text-[17px] font-bold leading-snug">
                  {food.shortLabel}
                  {done && " ✓"}
                </span>
                <span className={`text-[15px] tabular-nums ${done ? "" : "text-muted"}`}>
                  {done ? `${grams} g · logged` : `${grams} g`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {notes.length > 0 && (
        <details className="border-t border-line pt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-[17px] font-semibold text-basil-text underline [&::-webkit-details-marker]:hidden">
            Why these foods (what the vets say)
          </summary>
          <ul className="mt-2 grid gap-3">
            {notes.map((n) => (
              <li key={n.food.id} className="text-[15px] leading-snug">
                <span className="font-semibold">{n.food.shortLabel}.</span> {n.text} (
                <a href={n.url} target="_blank" rel="noopener" className="underline">
                  {n.org}
                </a>
                )
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
