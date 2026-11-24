import type { Pet, Recipe } from "../schemas";
import type { BowlEntry } from "./bowls";
import { buildCookForBothEntry, entryStillFits } from "./cookForBoth";
import { dateKey, pruneExtrasLog } from "./energy";
import { blockedReason } from "./restrictions";

// Shared by the Pets tab and cook mode: one deterministic id per recipe, pet and day, so both surfaces
// see the same log entry and a second tap on either one is a no-op.

// FNV-1a 32-bit over UTF-16 code units; returns 8 lowercase hex chars.
export function hex8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// "ck" + hex8(recipeId|petId|date) + hex8(date|petId|recipeId) = 18 chars (Pet.extrasLog[].id max is 24).
export function cookFeedId(recipeId: string, petId: string, date: string): string {
  return `ck${hex8(`${recipeId}|${petId}|${date}`)}${hex8(`${date}|${petId}|${recipeId}`)}`;
}

export function alreadyFed(pet: Pet, id: string): boolean {
  return pet.extrasLog.some((e) => e.id === id);
}

// The cook-for-both entry for today with the deterministic id, or null (same rules as buildCookForBothEntry).
// A blocked pet gets no entry: appendFeed would refuse it anyway.
export function cookFeedEntry(pet: Pet, recipe: Recipe, now: Date): BowlEntry | null {
  if (blockedReason(pet) !== null) return null;
  const id = cookFeedId(recipe.id, pet.id, dateKey(now));
  return buildCookForBothEntry(pet, recipe, now, () => id);
}

// Appends when entryStillFits and the id is not already in the log; otherwise returns the pet unchanged
// (apart from the prune, which the page does on every write anyway).
export function appendFeed(pet: Pet, entry: BowlEntry, now: Date): Pet {
  const pruned = pruneExtrasLog(pet, now);
  if (alreadyFed(pruned, entry.id) || !entryStillFits(pruned, entry, now)) return pruned;
  return pruneExtrasLog({ ...pruned, extrasLog: [...pruned.extrasLog, entry] }, now);
}
