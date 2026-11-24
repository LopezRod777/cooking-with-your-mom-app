import type { Pet } from "@/lib/schemas";
import { ageMonths } from "@/lib/pets/energy";

// "3 years" / "8 months" from the birth month. Whole years once the pet is a year old.
export function petAgeText(bornYearMonth: string, now: Date): string {
  const months = ageMonths(bornYearMonth, now);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "year" : "years"}`;
}

// Header line under the name: "Dog · 33 lb (15 kg) · Beagle · 3 years", then the neutered line.
export function PetHeaderMeta({ pet, now }: { pet: Pet; now: Date }) {
  const kind = pet.species === "dog" ? "Dog" : "Cat";
  const parts = [
    kind,
    `${Math.round(pet.weightKg * 2.2046)} lb (${pet.weightKg} kg)`,
    pet.breed,
    petAgeText(pet.bornYearMonth, now),
  ].filter((p): p is string => Boolean(p));
  return (
    <div className="grid gap-1">
      <p className="text-[17px] text-muted">{parts.join(" · ")}</p>
      <p className="text-[17px] text-muted">{pet.neutered ? "neutered or spayed" : "not neutered or spayed"}</p>
    </div>
  );
}
