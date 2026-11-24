import { breedHeading, breedNotes } from "@/lib/pets/breed";
import type { VetSource } from "@/lib/pets/vetNotes";
import type { Pet } from "@/lib/schemas";

function SourceLine({ sources }: { sources: VetSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="text-[15px] leading-snug text-muted">
      {sources.length > 1 ? "Sources: " : "Source: "}
      {sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && ", "}
          <a href={s.url} target="_blank" rel="noopener" className="underline">
            {s.org}
          </a>
        </span>
      ))}
    </p>
  );
}

export function BreedNotes({ pet, now }: { pet: Pet; now: Date }) {
  const notes = breedNotes(pet, now);
  if (notes.length === 0) return null;
  const heading = breedHeading(notes);

  return (
    <section data-testid="breed-notes" aria-label={heading} className="grid content-start gap-4">
      <div className="grid gap-1">
        <h2 className="font-display text-[26px] leading-tight">{heading}</h2>
        <p className="text-[16px] leading-snug text-muted">
          What {pet.name}&apos;s breed changes about food. Portions already follow weight, age and size.
        </p>
      </div>
      <div className="grid">
        {notes.map((n) => (
          <details
            key={`${n.breedId}-${n.conditionId}`}
            className="group border-t border-line py-2"
            data-condition={n.conditionId}
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[18px] font-semibold leading-snug [&::-webkit-details-marker]:hidden">
              <span>{n.title}</span>
              <span aria-hidden="true" className="shrink-0 text-[20px] text-muted group-open:hidden">
                +
              </span>
              <span aria-hidden="true" className="hidden shrink-0 text-[20px] text-muted group-open:inline">
                –
              </span>
            </summary>
            <div className="grid gap-2 pb-2">
              <p className="text-[17px] leading-snug">{n.text}</p>
              <SourceLine sources={n.sources} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
