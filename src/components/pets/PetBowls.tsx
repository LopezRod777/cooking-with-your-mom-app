"use client";

import { useEffect, useRef, useState } from "react";
import { PET_FOODS } from "@/lib/pets/foods";
import { bowlsFor, type Bowl } from "@/lib/pets/bowls";
import type { Pet } from "@/lib/schemas";

const shortName = (foodId: string) => PET_FOODS.find((f) => f.id === foodId)?.shortLabel ?? foodId;

// One shared photo per bowl (same for every user). Requests are cached for the page session.
const photoRequests = new Map<string, Promise<string | null>>();
function bowlPhotoUrl(bowlId: string): Promise<string | null> {
  let request = photoRequests.get(bowlId);
  if (!request) {
    request = fetch("/api/dish-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "pet-bowl", bowlId }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
        return res.ok && typeof data?.url === "string" ? data.url : null;
      })
      .catch(() => null)
      .then((url) => {
        // A failed photo is asked for again on the next mount.
        if (url === null) photoRequests.delete(bowlId);
        return url;
      });
    photoRequests.set(bowlId, request);
  }
  return request;
}

// 4:3 photo at the top of the bowl card. Saffron until the image has loaded, then it fades in.
function BowlPhoto({ bowl }: { bowl: Bowl }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let alive = true;
    void bowlPhotoUrl(bowl.id).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [bowl.id]);

  // A cached image can finish loading before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [url]);

  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-saffron-soft">
      {url && (
        <img
          ref={imgRef}
          src={url}
          alt={bowl.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}

// Bowls the pet can have today, scaled to what is left of the extras budget. Skipped bowls are not shown.
// Phones: a horizontal snap scroller of 240 px cards. sm and up: a three-column grid.
export function PetBowls({
  pet,
  now,
  full,
  onFed,
}: {
  pet: Pet;
  now: Date;
  full: boolean;
  onFed: (bowlId: string) => void;
}) {
  const candidates = bowlsFor(pet, now).filter((p) => !p.skipped);
  if (candidates.length === 0) return null;
  const plans = candidates.filter((p) => p.fits);
  return (
    <section className="grid content-start gap-4" aria-label={`Bowls you can cook for ${pet.name}`}>
      <div className="grid gap-1">
        <h2 className="font-display text-[26px] leading-tight">Bowls for {pet.name}</h2>
        <p className="text-[16px] leading-snug text-muted">Extras, not the diet. Boil or steam, cool, chop small.</p>
      </div>
      {plans.length === 0 && (
        <p className="text-[17px] leading-snug">No bowl fits what&apos;s left today. Tomorrow resets the budget.</p>
      )}
      <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible xl:grid-cols-2">
        {plans.map(({ bowl, grams, kcal, fits }) => (
          <li
            key={bowl.id}
            className="flex w-[240px] shrink-0 snap-start flex-col overflow-hidden rounded-[22px] border border-line bg-white sm:w-auto"
          >
            <BowlPhoto bowl={bowl} />
            <div className="grid content-start gap-2 p-3.5">
              <p className="text-[18px] font-bold leading-snug">{bowl.name}</p>
              <p className="text-[15px] leading-snug text-muted">
                {bowl.components.map((c) => `${grams[c.foodId] ?? 0} g ${shortName(c.foodId).toLowerCase()}`).join(" · ")}
                {` · ${kcal} kcal`}
              </p>
              {bowl.note && <p className="text-[15px] leading-snug text-muted">{bowl.note}</p>}
              <button
                type="button"
                disabled={!fits || full}
                onClick={() => onFed(bowl.id)}
                className="min-h-12 justify-self-start rounded-full border border-ink/25 bg-paper px-4 text-[17px] font-semibold text-ink disabled:opacity-40"
              >
                {fits ? "I fed this" : "Doesn't fit today"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
