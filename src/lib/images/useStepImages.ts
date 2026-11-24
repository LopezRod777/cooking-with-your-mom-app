"use client";

import { useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { getIdentity } from "../store";
import { isOfflineNow } from "../offline/useOffline";
import type { AppState, Recipe } from "../schemas";

export type StepPhotoStatus = "pending" | "failed";
// Recipes whose step photos failed this page load (step 0 failed, cap, or server error): no retry until reload.

// Writes the url into every copy of the recipe, only where the step still has the same text (a late answer never lands on another step).
function withStepUrl(prev: AppState, id: string, i: number, text: string, url: string): AppState {
  const patch = (r: Recipe | undefined) =>
    r && r.steps[i] && r.steps[i].text === text && !r.steps[i].imageUrl
      ? { ...r, steps: r.steps.map((s, k) => (k === i ? { ...s, imageUrl: url } : s)) }
      : r;
  const inPlan = patch(prev.plan?.recipes[id]);
  const inFavs = patch(prev.favoriteRecipes[id]);
  if (inPlan === prev.plan?.recipes[id] && inFavs === prev.favoriteRecipes[id]) return prev;
  return {
    ...prev,
    plan: prev.plan && inPlan ? { ...prev.plan, recipes: { ...prev.plan.recipes, [id]: inPlan } } : prev.plan,
    favoriteRecipes: inFavs ? { ...prev.favoriteRecipes, [id]: inFavs } : prev.favoriteRecipes,
  };
}

// Sequential per recipe: step 0 first (it is the reference for the others), then the next step without a photo.
const failed = new Set<string>();
const inFlight = new Set<string>();
// Tiny external store: a finished request (success or failure) re-renders whichever mount is current.
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;
function bump() { version++; for (const l of listeners) l(); }

export function useStepImages(recipe: Recipe | undefined, enabled: boolean, setState: Dispatch<SetStateAction<AppState>>): StepPhotoStatus {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const id = recipe?.id;
  const key = `${getIdentity()}:${id}`; // a failure of one account says nothing about another's
  const next = recipe ? recipe.steps.findIndex((s) => !s.imageUrl) : -1;
  const text = recipe && next >= 0 ? recipe.steps[next].text : "";
  useEffect(() => {
    if (!enabled || !id || next < 0 || failed.has(key) || inFlight.has(key) || isOfflineNow()) return;
    inFlight.add(key);
    (async () => {
      try {
        const res = await fetch("/api/step-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipeId: id, step: next }) });
        const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
        if (!res.ok || typeof data?.url !== "string") throw new Error(`step image ${res.status}`);
        const url = data.url;
        // Always applied: the state is global, so a mount that left and came back sees the photo land.
        setState((prev) => withStepUrl(prev, id, next, text, url));
      } catch {
        failed.add(key);
      } finally {
        inFlight.delete(key);
        bump();
      }
    })();
  }, [enabled, id, key, next, text, setState]);
  return id && (failed.has(key) || isOfflineNow()) ? "failed" : "pending";
}
