"use client";

import { sipRulesFor, sipsFor } from "@/lib/pets/sips";
import type { Pet } from "@/lib/schemas";

// Safe drinks and frozen treats for this pet, with the vet source on each card.
export function PetSips({ pet }: { pet: Pet }) {
  const sips = sipsFor(pet.species);
  if (sips.length === 0) return null;
  const rules = sipRulesFor(pet.species);
  return (
    <section data-testid="pet-sips" aria-label={`Sips for ${pet.name}`} className="grid content-start gap-4">
      <div className="grid gap-1">
        <h2 className="font-display text-[26px] leading-tight">Sips for {pet.name}</h2>
        <p className="text-[17px] leading-snug text-muted">
          {pet.species === "dog" ? "Mocktails for the bowl. Water first; these are treats." : "Ways to get more water in. Treats, not meals."}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sips.map((sip) => (
          <li key={sip.id} className="grid content-start gap-2 rounded-[20px] border border-line bg-panel p-4">
            <h3 className="text-[20px] font-semibold leading-tight">{sip.name}</h3>
            <p className="text-[17px] leading-snug">{sip.how}</p>
            {sip.note && <p className="text-[15px] font-semibold leading-snug text-tomato">{sip.note}</p>}
            <p className="text-[14px] leading-snug text-muted">
              {sip.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && " · "}
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {s.org}
                  </a>
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
      <ul className="grid gap-1.5 text-[15px] leading-snug text-muted">
        {rules.map((r) => (
          <li key={r.text}>
            {r.text}{" "}
            {r.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {s.org}
              </a>
            )).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, " · ", el]), [])}
          </li>
        ))}
      </ul>
    </section>
  );
}
