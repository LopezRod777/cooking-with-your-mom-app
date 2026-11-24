import { EMERGENCY, VET_RULES, telHref, type VetSource } from "@/lib/pets/vetNotes";

function uniqueSources(...lists: VetSource[][]): VetSource[] {
  const out: VetSource[] = [];
  for (const s of lists.flat()) {
    if (!out.some((o) => o.org === s.org && o.url === s.url)) out.push(s);
  }
  return out;
}

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

const RULE_CARDS = [
  {
    key: "treats10",
    texts: [VET_RULES.treats10.dog.text, VET_RULES.treats10.cat.text],
    sources: uniqueSources(VET_RULES.treats10.dog.sources, VET_RULES.treats10.cat.sources),
  },
  {
    key: "largeBreed",
    texts: [VET_RULES.largeBreed.text],
    sources: VET_RULES.largeBreed.sources,
  },
  {
    key: "catsCarnivore",
    texts: [VET_RULES.catsCarnivore.text],
    sources: VET_RULES.catsCarnivore.sources,
  },
  {
    key: "fishCats",
    texts: [VET_RULES.fishCats.text],
    sources: VET_RULES.fishCats.sources,
  },
];

const POISON_LINES = [
  { key: "aspca", label: "ASPCA Animal Poison Control", line: EMERGENCY.aspca },
  { key: "pph", label: "Pet Poison Helpline", line: EMERGENCY.pph },
];

// The first sentence (up to a full stop and a space); the whole text when there is none.
function firstSentence(text: string): string {
  return text.split(/(?<=\.)\s/)[0];
}

export function VetCorner() {
  return (
    <section className="grid content-start gap-4" aria-label="What the vets say">
      <h2 className="font-display text-[26px] leading-tight">What the vets say</h2>

      <div className="grid">
        {RULE_CARDS.map((card) => {
          const [first, ...rest] = card.texts;
          const head = firstSentence(first);
          const tail = first.slice(head.length).trim();
          return (
            <details key={card.key} className="group border-t border-line py-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[18px] font-semibold leading-snug [&::-webkit-details-marker]:hidden">
                <span>{head}</span>
                <span aria-hidden="true" className="shrink-0 text-[20px] text-muted group-open:hidden">
                  +
                </span>
                <span aria-hidden="true" className="hidden shrink-0 text-[20px] text-muted group-open:inline">
                  –
                </span>
              </summary>
              <div className="grid gap-2 pt-2 pb-1">
                {tail && <p className="text-[17px] leading-snug">{tail}</p>}
                {rest.map((text) => (
                  <p key={text} className="text-[17px] leading-snug">
                    {text}
                  </p>
                ))}
                <SourceLine sources={card.sources} />
              </div>
            </details>
          );
        })}
      </div>

      <div className="grid gap-3">
        <h3 className="text-[18px] font-semibold">If they ate something they shouldn&apos;t</h3>
        <div className="grid grid-cols-2 gap-3">
          {POISON_LINES.map(({ key, label, line }) => (
            <a
              key={key}
              href={telHref(line.phone)}
              className="grid min-h-14 content-center gap-0.5 rounded-[18px] bg-saffron-soft px-3.5 py-3 text-ink no-underline"
            >
              <span className="text-[17px] font-bold leading-snug">{label}</span>
              <span className="text-[15px] leading-snug text-muted">
                {line.phone}
                {line.fee && ` · ${line.fee}`}
              </span>
            </a>
          ))}
        </div>
        <p className="text-[15px] leading-snug text-muted">
          {POISON_LINES.map(({ key, line }, i) => (
            <span key={key}>
              {i > 0 && " · "}
              <a href={line.url} target="_blank" rel="noopener" className="underline">
                {line.org}
              </a>
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
