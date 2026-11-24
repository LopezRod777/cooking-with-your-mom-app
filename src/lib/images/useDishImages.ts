"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { isOfflineNow } from "../offline/useOffline";
import type { AppState, Recipe } from "../schemas";

// Module-level so every page shares one queue and one in-flight set.
const CONCURRENCY = 3;
const inFlight = new Set<string>();
const failed = new Set<string>();

type Job = { recipe: Recipe; setState: Dispatch<SetStateAction<AppState>> };
const queue: Job[] = [];
let running = 0;

function needsDishImage(r: Recipe): boolean {
  return !r.imageUrl && !r.source?.image;
}

// Writes the url into every copy of the recipe (week plan and favorites), touching nothing else.
function withImageUrl(prev: AppState, id: string, url: string): AppState {
  const inPlan = prev.plan?.recipes[id];
  const inFavs = prev.favoriteRecipes[id];
  const planNeeds = Boolean(inPlan && !inPlan.imageUrl);
  const favNeeds = Boolean(inFavs && !inFavs.imageUrl);
  if (!planNeeds && !favNeeds) return prev;
  return {
    ...prev,
    plan:
      planNeeds && prev.plan
        ? { ...prev.plan, recipes: { ...prev.plan.recipes, [id]: { ...inPlan!, imageUrl: url } } }
        : prev.plan,
    favoriteRecipes: favNeeds
      ? { ...prev.favoriteRecipes, [id]: { ...inFavs!, imageUrl: url } }
      : prev.favoriteRecipes,
  };
}

async function run({ recipe, setState }: Job): Promise<void> {
  try {
    const res = await fetch("/api/dish-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipe }),
    });
    const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
    if (!res.ok || typeof data?.url !== "string") throw new Error(`dish image ${res.status}`);
    const url = data.url;
    setState((prev) => withImageUrl(prev, recipe.id, url));
  } catch {
    // Keep the category photo. Not retried until the next page load.
    failed.add(recipe.id);
  } finally {
    inFlight.delete(recipe.id);
  }
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void run(job).finally(() => {
      running--;
      pump();
    });
  }
}

// Asks for a dish photo for every recipe that has none yet. Pass hydrated=false until the state is loaded.
export function useDishImages(
  state: AppState,
  setState: Dispatch<SetStateAction<AppState>>,
  hydrated: boolean,
): void {
  const plan = state.plan;
  const favorites = state.favoriteRecipes;

  useEffect(() => {
    if (!hydrated || isOfflineNow()) return;
    const todo = new Map<string, Recipe>();
    for (const r of [...Object.values(plan?.recipes ?? {}), ...Object.values(favorites)]) {
      if (needsDishImage(r) && !inFlight.has(r.id) && !failed.has(r.id)) todo.set(r.id, r);
    }
    for (const recipe of todo.values()) {
      inFlight.add(recipe.id);
      queue.push({ recipe, setState });
    }
    pump();
  }, [plan, favorites, hydrated, setState]);
}
