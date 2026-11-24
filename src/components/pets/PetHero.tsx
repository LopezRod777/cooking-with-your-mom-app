"use client";

import { Button } from "@/components/ui/Button";
import type { Blocked } from "@/lib/pets/restrictions";
import type { Stage } from "@/lib/pets/energy";
import type { Pet } from "@/lib/schemas";
import { PetAvatar } from "./PetAvatar";
import { PetHeaderMeta } from "./PetHeaderMeta";

export const STAGE_TEXT: Record<Stage, string> = {
  too_young: "too young for extras (under 4 months)",
  puppy: "puppy",
  kitten: "kitten",
  adult: "adult",
  growing_large: "growing large dog",
};

// Top panel for one pet: photo, name, facts, today's extras bar, and Edit / Remove.
// A pet that is too young or blocked by a restriction shows its message where the bar would be.
export function PetHero({
  pet,
  now,
  stage,
  mer,
  budgetKcal,
  budgetRule,
  remaining,
  blocked,
  confirming,
  editDisabled,
  onEdit,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  pet: Pet;
  now: Date;
  stage: Stage;
  mer: number | null;
  budgetKcal: number;
  budgetRule: "10%" | "5%" | "none";
  remaining: number;
  blocked: Blocked | null;
  confirming: boolean;
  editDisabled: boolean;
  onEdit: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const young = stage === "too_young";
  const pct = budgetKcal > 0 ? Math.max(0, Math.min(100, (remaining / budgetKcal) * 100)) : 0;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-5 rounded-[28px] bg-panel p-4 sm:p-6 xl:gap-x-7">
      <PetAvatar pet={pet} className="!h-24 !w-24 xl:!h-[120px] xl:!w-[120px]" />

      <div className="grid min-w-0 content-center gap-1">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[34px] leading-none">{pet.name}</h2>
          {!confirming && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onEdit}
                disabled={editDisabled}
                className="min-h-11 rounded-full px-3 text-[17px] font-semibold text-ink underline disabled:opacity-40"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onAskRemove}
                className="min-h-11 rounded-full px-3 text-[17px] font-semibold text-tomato underline"
              >
                Remove
              </button>
            </div>
          )}
        </div>
        <PetHeaderMeta pet={pet} now={now} />
        {!young && mer !== null && (
          <p className="text-[17px] text-muted">About {Math.round(mer / 10) * 10} kcal a day (Merck starting point)</p>
        )}
        {young && <p className="text-[18px] font-semibold">{STAGE_TEXT[stage]}</p>}
      </div>

      {confirming && (
        <div role="group" aria-label={`Confirm removing ${pet.name}`} className="col-span-2 grid gap-3">
          <p className="text-[18px] font-semibold">Remove {pet.name}?</p>
          <div className="flex flex-wrap gap-3">
            <Button size="md" onClick={onConfirmRemove}>
              Yes
            </Button>
            <Button size="md" variant="ghost" onClick={onCancelRemove}>
              No
            </Button>
          </div>
        </div>
      )}

      {!young && blocked && (
        <section
          className="col-span-2 grid gap-3 xl:col-span-1 xl:col-start-2"
          aria-label={`Extras for ${pet.name}`}
        >
          <p className="text-[18px] font-semibold leading-snug">{blocked.text}</p>
          {blocked.source && (
            <p className="text-[16px] text-muted">
              Source:{" "}
              <a href={blocked.source.url} target="_blank" rel="noopener" className="underline">
                {blocked.source.org}
              </a>
            </p>
          )}
        </section>
      )}

      {!young && !blocked && (
        <div className="col-span-2 grid gap-2 xl:col-span-1 xl:col-start-2">
          <p className="text-[17px] font-semibold">
            {pet.name}&apos;s extras today: {remaining} of {budgetKcal} kcal
          </p>
          <div
            role="progressbar"
            aria-label={`${pet.name}'s extras remaining today`}
            aria-valuemin={0}
            aria-valuemax={budgetKcal}
            aria-valuenow={remaining}
            className="h-3.5 overflow-hidden rounded-full bg-[#f1e4d2]"
          >
            <div
              className="h-full rounded-full bg-saffron transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[15px] leading-snug text-muted">
            {budgetRule} of the day, our conservative rule. Extras come out of the regular portion.
          </p>
          {stage === "growing_large" && (
            <p className="text-[17px] font-semibold">Growing large dog: have the vet set the daily amount.</p>
          )}
        </div>
      )}
    </div>
  );
}
