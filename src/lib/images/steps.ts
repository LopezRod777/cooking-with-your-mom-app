// Server only. One photo per recipe step, all in the same kitchen as the recipe's dish photo.
import { createHash } from "node:crypto";
import type { Recipe } from "../schemas";
import { dishComponents, findBlob, generateCachedImage, variationFor, type DishImage } from "./dish";
import { flowStep } from "../stepText";
import { stepActionFor, STEP_ACTION_LABEL } from "../stepAction";
import { CATALOG } from "../catalog";

export const PROMPT_VERSION = "v5";
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

const STOP = new Set(["the", "and", "with", "for", "into", "from", "over", "until", "then", "large", "small", "fresh", "dried", "ground", "whole", "wheat", "white", "red", "green", "black", "plain", "liquid", "baby", "crumbled", "shredded", "grated", "boneless", "skinless", "extra", "virgin", "olive", "oil", "salt", "pepper", "water"]);
// Words of a catalog display name that identify the food ("feta cheese (crumbled)" → feta, cheese).
function foodWords(displayName: string): string[] {
  return displayName.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
// Ingredients this step names in its text, with no fallback. Empty when the step names no food.
function namedIngredients(recipe: Recipe, i: number): string[] {
  const text = recipe.steps[i].text.toLowerCase();
  const hits: string[] = [];
  for (const ing of recipe.ingredients) {
    const name = CATALOG[ing.key]?.displayName ?? ing.key.replace(/_/g, " ");
    const words = foodWords(name);
    if (words.some((w) => new RegExp(`\\b${w}(s|es)?\\b`).test(text) || (w.endsWith("s") && new RegExp(`\\b${w.slice(0, -1)}\\b`).test(text)))) {
      const short = name.replace(/\(.*?\)/g, "").trim().toLowerCase();
      if (!hits.includes(short)) hits.push(short);
    }
  }
  return hits.slice(0, 4);
}
// Ingredients this step talks about, by name match against the step text; the recipe's main components when none match.
export function stepIngredients(recipe: Recipe, i: number): string[] {
  const hits = namedIngredients(recipe, i);
  return hits.length > 0 ? hits : dishComponents(recipe).slice(0, 3);
}

const COOKWARE = /\b(nonstick skillet|cast-iron skillet|skillet|frying pan|saut[eé] pan|saucepan|large pot|pot|dutch oven|sheet pan|baking dish|baking sheet|wok|griddle|blender|mixing bowl|bowl|air fryer basket|slow cooker)\b/i;
// Where the food is at step i: the cookware this step names, else the last one an earlier step named, else null.
export function vesselFor(recipe: Recipe, i: number): string | null {
  for (let k = i; k >= 0; k--) {
    const m = COOKWARE.exec(recipe.steps[k].text);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
// Food already in play before step i: ingredients named by steps 0..i−1 that step i does not name again.
// Only food that sat in the same vessel as step i counts: bowl contents from step 0 are not in the skillet at step 1.
export function carriedIngredients(recipe: Recipe, i: number): string[] {
  const vessel = vesselFor(recipe, i);
  if (vessel === null) return [];
  const now = new Set(namedIngredients(recipe, i));
  const out: string[] = [];
  for (let k = 0; k < i; k++) {
    if (vesselFor(recipe, k) !== vessel) continue;
    for (const ing of namedIngredients(recipe, k)) if (!now.has(ing) && !out.includes(ing)) out.push(ing);
  }
  return out.slice(0, 5);
}

// One kitchen per recipe: the dish photo's surface, vessel and utensil, so the last step matches the plate.
export function stepScene(recipe: Pick<Recipe, "id" | "title">) {
  const { surface, vessel, utensil } = variationFor(recipe);
  return {
    surface, vessel, utensil,
    light: "natural window light from the left",
    props: `${utensil}, a small wooden cutting board, salt and pepper shakers and a folded linen towel at the edge of the frame`,
  };
}
const ANGLES = ["Overhead photograph", "Photograph at a 45-degree angle", "Close-up photograph at counter height"];
export function stepAngle(recipe: Pick<Recipe, "id">, i: number): string {
  const h = createHash("sha1").update(`${recipe.id}|${i}`).digest();
  return ANGLES[h[0] % ANGLES.length];
}
export function stepPrompt(recipe: Recipe, i: number, withReference: boolean): string {
  const step = recipe.steps[i];
  const scene = stepScene(recipe);
  const action = STEP_ACTION_LABEL[stepActionFor(step)].toLowerCase();
  const carried = carriedIngredients(recipe, i);
  const vessel = vesselFor(recipe, i);
  const plated = stepActionFor(step) === "plate";
  const kitchen = "Photo 1 is the kitchen: same table surface, same light, same props.";
  const lead = !withReference
    ? ""
    : i === 1
      ? `${kitchen} Continue from photo 1.`
      : `${kitchen} Photo 2 is the previous step: continue from it, ${plated ? "same food, now plated" : "same cookware, same contents"}.`;
  const where = plated
    ? `Served on a plate on the counter, not in the cookware; the ${scene.vessel} stays empty to one side.`
    : vessel
      ? `The food is in the ${vessel}; the ${scene.vessel} stays empty to one side unless this step serves the dish.`
      : `The food sits in whatever the step names (skillet, pot, bowl, sheet pan, plate); the ${scene.vessel} stays empty to one side unless this step serves the dish.`;
  return [
    lead,
    `${stepAngle(recipe, i)} of this cooking step, mid-action, ${action}: ${flowStep(step.text)}`,
    `Only the food this step names is in frame: ${stepIngredients(recipe, i).join(", ")}.${carried.length > 0 ? ` Already there from earlier steps: ${carried.join(", ")}.` : ""} Nothing from later steps.`,
    where,
    `On a ${scene.surface}, ${scene.light}, ${scene.props}.`,
    "Shot on a 50mm lens, soft shadows, slight film grain, true-to-life colors, not oversaturated. No people, no hands, no text, no logo. Looks like a real home kitchen photo, not a studio ad.",
  ].filter(Boolean).join(" ");
}
function sceneSig(recipe: Recipe): string {
  const s = stepScene(recipe);
  return `${s.surface}|${s.vessel}|${s.utensil}`;
}
// key_0 depends on step 0's text; key_i (i > 0) also carries key_0, so a different reference means a different photo.
export function stepImageKey(recipe: Recipe, i: number): string {
  const components = dishComponents(recipe).slice(0, 3).join(",");
  const base = `${PROMPT_VERSION}|${recipe.steps[i].text}|${components}|${sceneSig(recipe)}`;
  if (i === 0) return `steps/${recipe.id}-0-${sha1(base).slice(0, 10)}.jpg`;
  const key0 = stepImageKey(recipe, 0);
  const prev = i > 1 ? `|${stepImageKey(recipe, i - 1)}` : "";
  return `steps/${recipe.id}-${i}-${sha1(`${base}|${key0}${prev}`).slice(0, 10)}.jpg`;
}
export function findStepImage(recipe: Recipe, i: number): Promise<string | null> {
  return findBlob(stepImageKey(recipe, i));
}
async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`reference fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
// Step 0 from text. Steps 1..n: step 0 (kitchen) and step i-1 (pan and contents) as references, generated first if missing. Never without them.
export async function generateStepImage(recipe: Recipe, i: number): Promise<DishImage> {
  if (i < 0 || i >= recipe.steps.length) throw new Error("step out of range");
  if (i === 0) return generateCachedImage(stepImageKey(recipe, 0), stepPrompt(recipe, 0, false), `step:${recipe.id}:0`);
  const first = await generateStepImage(recipe, 0);
  const refs = [await fetchBuffer(first.url)];
  if (i > 1) {
    const prev = await generateStepImage(recipe, i - 1);
    refs.push(await fetchBuffer(prev.url));
  }
  return generateCachedImage(stepImageKey(recipe, i), stepPrompt(recipe, i, true), `step:${recipe.id}:${i}`, undefined, refs);
}
