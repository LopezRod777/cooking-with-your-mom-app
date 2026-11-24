"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppState } from "@/lib/useAppState";
import { krogerSourceLine } from "@/lib/prices";
import type { PairingOutput, WineChoice } from "@/lib/pairings/schema";
import {
  avoidReasonById,
  grapeById,
  otherById,
  principleById,
  regionById,
  sourceById,
  wineById,
  zeroProofById,
  type OtherDrink,
} from "@/lib/pairings/vocab";
import { GlassIcon, type GlassTone } from "./GlassIcon";
import { DrinkPhoto } from "./DrinkPhoto";
import type { PairingResult } from "./usePairingsGate";
import { StoreBottles, type ShelfReport } from "./StoreBottles";
import { WhereToGet, type ShelfState } from "./WhereToGet";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function WhyChips({ principleIds }: { principleIds: string[] }) {
  return (
    <ul className="grid gap-2" aria-label="Why it works">
      {principleIds.map((pid) => {
        const principle = principleById.get(pid);
        if (!principle) return null;
        const sources = principle.sourceIds
          .map((sid) => sourceById.get(sid))
          .filter((s): s is NonNullable<typeof s> => Boolean(s));
        return (
          <li key={pid} className="grid gap-1">
            <span className="w-fit rounded-full bg-saffron-soft px-3 py-1 text-[15px] font-semibold leading-snug text-ink">
              {principle.label}
            </span>
            <p className="text-[15px] leading-snug text-muted">
              {principle.text}{" "}
              {sources.map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? " · " : ""}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-tomato underline underline-offset-4"
                  >
                    Read more: {s.org}
                  </a>
                </span>
              ))}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function WineBlock({
  choice,
  index,
  onShelf,
}: {
  choice: WineChoice;
  index: number;
  onShelf: (styleId: string, report: ShelfReport | null) => void;
}) {
  const style = wineById.get(choice.styleId);
  if (!style) return null;
  const grapes = choice.grapeIds.map((g) => grapeById.get(g)?.name).filter(Boolean);
  const regions = choice.regionIds
    .map((r) => regionById.get(r))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => `${r.name}, ${r.country}`);
  return (
    <article aria-label={`Wine ${index + 1}: ${style.name}`} className="grid content-start gap-4 rounded-[24px] bg-panel p-3">
      <DrinkPhoto styleId={style.id} name={style.name} />
      <div className="grid content-start gap-4 px-3 pb-3">
        <div className="flex items-start gap-3">
          <GlassIcon tone={style.color as GlassTone} size={36} />
          <div className="grid gap-1">
            <h3 className="text-[26px] leading-tight">{style.name}</h3>
            <p className="text-[16px] text-muted">
              {cap(style.body)} body, {style.sweetness}
            </p>
          </div>
        </div>
        <p className="text-[17px] leading-snug text-ink">{style.blurb}</p>
        <dl className="grid gap-1 text-[16px] leading-snug">
          {grapes.length > 0 && (
            <div>
              <dt className="inline font-semibold">Grapes: </dt>
              <dd className="inline">{grapes.join(", ")}</dd>
            </div>
          )}
          {regions.length > 0 && (
            <div>
              <dt className="inline font-semibold">From: </dt>
              <dd className="inline">{regions.join("; ")}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-semibold">Serve at: </dt>
            <dd className="inline">{choice.serveTempF}°F</dd>
          </div>
        </dl>
        <span className="w-fit rounded-full border border-line px-3 py-1 text-[15px] font-semibold text-ink">
          {choice.tier}
        </span>
        <WhyChips principleIds={choice.whyPrincipleIds} />
        <StoreBottles styleId={style.id} label={style.name} onShelf={(report) => onShelf(style.id, report)} />
      </div>
    </article>
  );
}

function OtherBlock({
  other,
  onShelf,
}: {
  other: PairingOutput["other"][number];
  onShelf: (styleId: string, report: ShelfReport | null) => void;
}) {
  const drink: OtherDrink | undefined = otherById.get(other.styleId);
  if (!drink) return null;
  return (
    <article aria-label="Also good" className="grid content-start gap-4 rounded-[24px] bg-panel p-3">
      <DrinkPhoto styleId={drink.id} name={drink.name} />
      <div className="grid content-start gap-4 px-3 pb-3">
        <div className="flex items-start gap-3">
          <GlassIcon tone={drink.kind === "cocktail" ? "cocktail" : "beer"} size={36} />
          <div className="grid gap-1">
            <p className="text-[15px] font-semibold uppercase tracking-wide text-muted">Also good</p>
            <h3 className="text-[26px] leading-tight">{drink.name}</h3>
          </div>
        </div>
        <p className="text-[17px] leading-snug text-ink">{drink.blurb}</p>
        {drink.kind === "cocktail" && drink.recipe && (
          <div className="grid gap-2 text-[16px] leading-snug">
            <p className="font-semibold">Ingredients</p>
            <ul className="list-disc pl-5">
              {drink.recipe.ingredients.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <p className="font-semibold">Steps</p>
            <ol className="list-decimal pl-5">
              {drink.recipe.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}
        <WhyChips principleIds={other.whyPrincipleIds} />
        <StoreBottles styleId={drink.id} label={drink.name} onShelf={(report) => onShelf(drink.id, report)} />
      </div>
    </article>
  );
}

function ZeroBlock({ styleId, first }: { styleId: string; first: boolean }) {
  const item = zeroProofById.get(styleId);
  if (!item) return null;
  return (
    <article aria-label="Zero-proof" className="grid content-start gap-3 rounded-[24px] bg-panel p-3">
      <DrinkPhoto styleId={item.id} name={item.name} />
      <div className="grid content-start gap-4 px-3 pb-3">
        <div className="flex items-start gap-3">
          <GlassIcon tone="zero" size={36} />
          <div className="grid gap-1">
            <p className="text-[15px] font-semibold uppercase tracking-wide text-muted">
              {first ? "Zero-proof first" : "Zero-proof"}
            </p>
            <h3 className="text-[26px] leading-tight">{item.name}</h3>
          </div>
        </div>
        <p className="text-[17px] leading-snug text-ink">{item.blurb}</p>
      </div>
    </article>
  );
}

function SkipBlock({ avoid }: { avoid: PairingOutput["avoid"][number] }) {
  const name =
    wineById.get(avoid.styleId)?.name ?? otherById.get(avoid.styleId)?.name ?? zeroProofById.get(avoid.styleId)?.name;
  const reason = avoidReasonById.get(avoid.avoidReasonId)?.text;
  if (!name || !reason) return null;
  return (
    <article aria-label="Skip" className="grid gap-2 rounded-[24px] border border-line p-6">
      <p className="text-[15px] font-semibold uppercase tracking-wide text-muted">Skip</p>
      <h3 className="text-[22px] leading-tight">{name}</h3>
      <p className="text-[17px] leading-snug text-ink">{reason}</p>
    </article>
  );
}

export function PairingCard({
  result,
  slot,
  busy,
  onPairAgain,
}: {
  result: PairingResult;
  slot: string;
  busy: boolean;
  onPairAgain: () => void;
}) {
  const { pairing } = result;
  const [state] = useAppState();
  const breakfast = slot === "breakfast";
  // A $0 drinks budget puts the alcohol-free pick first, the same ordering as breakfast. Ordering only, no price claim.
  const zeroFirst = breakfast || state.profile.drinksBudgetUsd === 0;
  const wineStyles = pairing.wines
    .map((w) => wineById.get(w.styleId))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ name: s.name }));
  const zero = <ZeroBlock key="zero" styleId={pairing.zeroProof[0].styleId} first={zeroFirst} />;

  // Shelf reports from the StoreBottles under each drink, keyed by style id.
  const [shelf, setShelf] = useState<Record<string, ShelfReport>>({});
  const reportShelf = useCallback((styleId: string, report: ShelfReport | null) => {
    setShelf((prev) => {
      if (report === null) {
        if (!(styleId in prev)) return prev;
        const next = { ...prev };
        delete next[styleId];
        return next;
      }
      return { ...prev, [styleId]: report };
    });
  }, []);
  const wines = pairing.wines.map((w, i) => (
    <WineBlock key={`wine-${i}`} choice={w} index={i} onShelf={reportShelf} />
  ));
  // Card order: wines, then the other drink. The first shop with a price sets the one attribution line.
  const drinkIds = [...pairing.wines.map((w) => w.styleId), pairing.other[0].styleId];
  const firstOk = drinkIds
    .map((id) => shelf[id])
    .find((r): r is Extract<ShelfReport, { kind: "ok" }> => r?.kind === "ok");
  const shelfState: ShelfState = firstOk ? "ok" : drinkIds.some((id) => shelf[id]?.kind === "not_kroger") ? "not_kroger" : null;

  return (
    <div className="grid gap-8">
      {breakfast && <p className="text-[17px] leading-snug text-muted">For breakfast, Mama leans alcohol-free.</p>}
      {state.profile.drinksBudgetUsd === 0 && (
        <p className="text-[17px] leading-snug text-muted">You set your drinks budget to $0; zero-proof first.</p>
      )}
      <section aria-label="Pairings" className="grid items-start gap-5 lg:grid-cols-2">
        {zeroFirst ? (
          <>
            {zero}
            {wines}
          </>
        ) : (
          <>
            {wines}
            {zero}
          </>
        )}
        <OtherBlock other={pairing.other[0]} onShelf={reportShelf} />
        <SkipBlock avoid={pairing.avoid[0]} />
      </section>

      <div className="grid gap-1">
        {firstOk && (
          <p className="text-[15px] leading-snug text-muted">
            {krogerSourceLine({ store: firstOk.store, quotedAt: firstOk.quotedAt, prices: {} })}
          </p>
        )}
        <p className="text-[16px] leading-snug text-muted">Prices vary by store; check the nearby stores below.</p>
      </div>

      <div>
        <Button variant="ghost" size="md" disabled={busy} onClick={onPairAgain}>
          Pair again
        </Button>
      </div>

      <WhereToGet styles={wineStyles} shelf={shelfState} />
    </div>
  );
}
