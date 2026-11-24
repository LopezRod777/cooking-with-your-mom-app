// Server only. Generates one photo per recipe with Gemini, stores it in Vercel Blob, reuses it forever.
import { AiQuotaError } from "../ai/dailyQuota";
import { createHash } from "node:crypto";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import sharp from "sharp";
import type { Recipe } from "../schemas";
import { drinkImagePrompt } from "../pairings/imagePrompt";

const MODEL = "gemini-3.1-flash-image";
const GEMINI_TIMEOUT_MS = 60_000;
const MAX_COMPONENTS = 5;

export type DishImage = { url: string; cached: boolean; ms: number };

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export function dishImageKey(recipe: Pick<Recipe, "id" | "title" | "ingredients">): string {
  const keys = recipe.ingredients.map((i) => i.key).sort().join(",");
  return `dishes/${recipe.id}-${sha1(`${recipe.title}|${keys}`).slice(0, 10)}.jpg`;
}

// Turns "3/4 lb ground turkey" into "ground turkey". Quantities and units go; the food stays.
function componentName(display: string, key: string): string {
  const name = display
    .replace(/^[\d¼½¾⅓⅔⅛/.\s-]+/, "")
    .replace(
      /^(?:(?:g|kg|oz|lbs?|cups?|tbsps?|tsps?|cans?|cloves?|ml|l|pinch(?:es)?|slices?|pieces?|large|medium|small|whole|heaping)\b\.?\s*)+/i,
      "",
    )
    .replace(/^of\s+/i, "")
    .replace(/[(),].*$/, "")
    .trim()
    .toLowerCase();
  return name || key.replace(/_/g, " ");
}

// The heaviest ingredients are the ones a camera sees; salt and oil do not make the photo.
export function dishComponents(recipe: Pick<Recipe, "ingredients">): string[] {
  const byWeight = [...recipe.ingredients].sort((a, b) => b.grams - a.grams);
  const names: string[] = [];
  for (const ing of byWeight) {
    const name = componentName(ing.display, ing.key);
    if (!names.includes(name)) names.push(name);
    if (names.length === MAX_COMPONENTS) break;
  }
  return names;
}

const ANGLES = ["Overhead photograph", "Photograph at a 45-degree angle"];
const SURFACES = ["worn wooden kitchen table", "rumpled linen tablecloth", "white marble counter"];
const VESSELS = [
  { vessel: "simple white ceramic bowl", utensil: "a fork" },
  { vessel: "speckled enamel plate", utensil: "a fork" },
];
const SKILLET = { vessel: "well-used cast-iron skillet", utensil: "a wooden spoon" };
// The skillet is only for dishes cooked in one: never for a bowl, a salad or a sandwich.
const SKILLET_TITLE = /skillet|stir-fry|hash|frittata|scramble|shakshuka/i;
// Share of recipes shot in a bowl or plate. The rest use the skillet only if the title allows it.
const PLATE_OR_BOWL_SHARE = 0.7;

// Same recipe id always gets the same angle, surface and dish, so a week does not look cloned.
export function variationFor(recipe: Pick<Recipe, "id" | "title">) {
  const h = createHash("sha1").update(recipe.id).digest();
  const plateOrBowl = VESSELS[h[3] % VESSELS.length];
  const skilletAllowed = SKILLET_TITLE.test(recipe.title);
  // A byte is 0 to 255, so use a fraction of that range: % 100 would skew the odds.
  const vessel = skilletAllowed && h[2] / 256 >= PLATE_OR_BOWL_SHARE ? SKILLET : plateOrBowl;
  return {
    angle: ANGLES[h[0] % ANGLES.length],
    surface: SURFACES[h[1] % SURFACES.length],
    ...vessel,
  };
}

export function dishPrompt(recipe: Recipe): string {
  const { angle, surface, vessel, utensil } = variationFor(recipe);
  const components = dishComponents(recipe).join(", ");
  return [
    `${angle} of ${recipe.title}, a ${recipe.slot} meal: ${components}, in a ${vessel} on a ${surface}, ${utensil} beside it.`,
    "Shot on a 50mm lens, natural window light from the left, soft shadows, slight film grain, true-to-life colors, not oversaturated, no text, no hands, no logo.",
    "Looks like a real home kitchen photo, not a studio ad.",
  ].join(" ");
}

export async function findBlob(key: string): Promise<string | null> {
  try {
    return (await head(key)).url;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
};

async function generateJpeg(prompt: string, signal?: AbortSignal, references?: Buffer[]): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const parts = references?.length
    ? [
        ...references.map((ref) => ({ inlineData: { mimeType: "image/jpeg", data: ref.toString("base64") } })),
        { text: prompt },
      ]
    : [{ text: prompt }];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3" } },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(GEMINI_TIMEOUT_MS)]) : AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as GeminiResponse;
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error("Gemini returned no image");
  return sharp(Buffer.from(b64, "base64"))
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

// Pet bowls: same Blob store and caching as dishes. The key carries a hash of the prompt, so editing
// imagePrompt in data/pet-bowls.json makes a new photo. No personal data goes into the prompt.
const PET_BOWL_SUFFIX = [
  "Shot on a 50mm lens, natural window light from the left, soft shadows, true-to-life colors, not oversaturated.",
  "A plain home kitchen photo: no people, no animals, no hands, no text, no logo, no brand names.",
];

export function petBowlPrompt(imagePrompt: string): string {
  return [imagePrompt, ...PET_BOWL_SUFFIX].join(" ");
}

// The key hashes the full prompt that goes to Gemini (suffix included), so any change to it makes a new photo.
export function petBowlImageKey(bowlId: string, imagePrompt: string): string {
  return `pet-bowls/${bowlId}-${sha1(petBowlPrompt(imagePrompt)).slice(0, 10)}.jpg`;
}

// In-flight generations by blob key (pet bowls and pairing drinks). Concurrent misses for one photo wait on one Gemini call.
const inFlight = new Map<string, Promise<DishImage>>();

function generateOnce(key: string, prompt: string, label: string, reserve?: () => Promise<boolean>): Promise<DishImage> {
  const pending = inFlight.get(key);
  if (pending) {
    // The other person ran out of their own slots: that says nothing about this one's.
    return pending.catch((err) => {
      if (err instanceof AiQuotaError) return generateOnce(key, prompt, label, reserve);
      throw err;
    });
  }
  const run = generateCachedImage(key, prompt, label, undefined, undefined, reserve).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

export function generatePetBowlImage(bowlId: string, imagePrompt: string, reserve?: () => Promise<boolean>): Promise<DishImage> {
  return generateOnce(petBowlImageKey(bowlId, imagePrompt), petBowlPrompt(imagePrompt), `pet-bowl:${bowlId}`, reserve);
}

// Pairing drinks: one photo per drink style, shared by everyone. Same store, model and settings as the bowls.
// The key hashes the full prompt, so editing imagePrompt.ts makes a new photo.
export function pairingDrinkImageKey(styleId: string, prompt: string): string {
  return `pairing-drinks/${styleId}-${sha1(prompt).slice(0, 10)}.jpg`;
}

// Throws (rejects) on a styleId that is not in the pairing vocabulary.
export async function generateDrinkImage(styleId: string, reserve?: () => Promise<boolean>): Promise<DishImage> {
  const prompt = drinkImagePrompt(styleId);
  return generateOnce(pairingDrinkImageKey(styleId, prompt), prompt, `pairing-drink:${styleId}`, reserve);
}

// `signal` aborts the Gemini call (a caller's time budget); a cached photo still comes back after the abort.
// `reserve` runs only when the photo is not cached yet; false throws AiQuotaError and nothing is generated.
export async function generateDishImage(recipe: Recipe, signal?: AbortSignal, reserve?: () => Promise<boolean>): Promise<DishImage> {
  return generateCachedImage(dishImageKey(recipe), dishPrompt(recipe), recipe.id, signal, undefined, reserve);
}

export async function generateCachedImage(key: string, prompt: string, label: string, signal?: AbortSignal, references?: Buffer[], reserve?: () => Promise<boolean>): Promise<DishImage> {
  const started = Date.now();

  const existing = await findBlob(key);
  if (existing) return { url: existing, cached: true, ms: Date.now() - started };
  if (reserve && !(await reserve())) throw new AiQuotaError();

  const jpeg = await generateJpeg(prompt, signal, references);
  const options = {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  } as const;
  let url: string;
  let cached = false;
  try {
    url = (await put(key, jpeg, options)).url;
  } catch (err) {
    // Another request finished the same photo first: use its copy.
    const winner = await findBlob(key);
    if (!winner) throw err;
    url = winner;
    cached = true;
  }
  const ms = Date.now() - started;
  if (!cached) console.log(`[dish-image] generated ${key} (${label}) ms=${ms} bytes=${jpeg.length}`);
  return { url, cached, ms };
}
