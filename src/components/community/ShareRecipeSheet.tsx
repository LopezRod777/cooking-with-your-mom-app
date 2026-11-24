"use client";

/* Recipe photos come from Blob or source sites, so they are plain <img> tags. */
/* eslint-disable @next/next/no-img-element */

import { useAppState } from "@/lib/useAppState";
import type { Recipe } from "@/lib/schemas";

// Bottom sheet: pick one of this week's recipes (then favorites) to share into the table.
// The parent posts it with the draft text, so the sheet only reports the id.
export function ShareRecipeSheet({ onClose, onPick }: { onClose: () => void; onPick: (recipeId: string) => void }) {
  const [state] = useAppState();

  const seen = new Set<string>();
  const recipes: Recipe[] = [];
  for (const r of [...Object.values(state.plan?.recipes ?? {}), ...Object.values(state.favoriteRecipes)]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    recipes.push(r);
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-ink/30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share a recipe"
        data-testid="share-recipe-sheet"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto grid max-h-[70vh] w-full max-w-[720px] gap-2 overflow-y-auto rounded-t-[24px] bg-paper px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_-16px_rgba(35,26,20,0.35)] lg:left-[264px]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-hand text-[28px] leading-none text-ink">Share a recipe</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[18px] font-semibold text-muted active:bg-ink/5">
            ✕
          </button>
        </div>

        {recipes.length === 0 && <p className="py-6 text-[16px] text-muted">Nothing to share yet. Cook something first.</p>}

        <ul className="grid gap-1">
          {recipes.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id)}
                data-testid="share-recipe-row"
                className="flex min-h-14 w-full items-center gap-3 rounded-[14px] p-2 text-left active:bg-ink/5"
              >
                {r.imageUrl ? (
                  <img src={r.imageUrl} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 shrink-0 rounded-[12px] object-cover" />
                ) : (
                  <span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-[12px] bg-saffron-soft" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-semibold text-ink">{r.title}</span>
                  <span className="block text-[13px] text-muted">{r.prepMinutes + r.cookMinutes} min</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
