import raw from "../../../data/pairing-vocab.json";

export type WineColor = "red" | "white" | "rose" | "sparkling" | "orange";
export type WineBody = "light" | "medium" | "full";
export type WineSweetness = "dry" | "off-dry" | "sweet";
export type OtherKind = "beer" | "cider" | "spirit" | "cocktail" | "sake";
export type CocktailBase = "vodka" | "gin" | "rum" | "tequila" | "mezcal" | "whiskey" | "brandy" | "sake" | "sparkling-wine" | "red-wine" | "white-wine" | "beer";
export const COCKTAIL_BASES: readonly CocktailBase[] = ["vodka","gin","rum","tequila","mezcal","whiskey","brandy","sake","sparkling-wine","red-wine","white-wine","beer"];
export type CocktailGlass = "rocks" | "highball" | "coupe" | "flute" | "wine" | "mug" | "pint";
export const COCKTAIL_GLASSES: readonly CocktailGlass[] = ["rocks", "highball", "coupe", "flute", "wine", "mug", "pint"];
export type Cocktail = {
  id: string;
  name: string;
  base: CocktailBase;
  mix: string;
  food: string;
  glass: CocktailGlass;
  // Liquid tint for the glass drawing (not a brand color).
  tone: string;
  recipe: { ingredients: string[]; steps: string[] };
};

export type WineStyle = {
  id: string;
  name: string;
  color: WineColor;
  body: WineBody;
  sweetness: WineSweetness;
  grapes: string[];
  regions: string[];
  serveTempF: [number, number];
  blurb: string;
  // Término de búsqueda en tiendas cuando el nombre no sirve ("Unoaked Chardonnay" → "chardonnay").
  searchTerm?: string;
};

export type OtherDrink = {
  id: string;
  kind: OtherKind;
  name: string;
  blurb: string;
  searchTerm?: string;
  recipe?: { ingredients: string[]; steps: string[] };
};

export type NamedItem = { id: string; name: string; blurb: string };
export type Grape = { id: string; name: string };
export type Region = { id: string; name: string; country: string };
export type Principle = { id: string; label: string; text: string; sourceIds: string[] };
export type AvoidReason = { id: string; text: string };
export type Source = { id: string; org: string; title: string; url: string; accessedAt: string };

export type PairingVocab = {
  wines: WineStyle[];
  grapes: Grape[];
  regions: Region[];
  others: OtherDrink[];
  cocktails: Cocktail[];
  zeroProof: NamedItem[];
  principles: Principle[];
  avoidReasons: AvoidReason[];
  sources: Source[];
  serve: Record<string, string>;
};

export const VOCAB = raw as unknown as PairingVocab;

function indexBy<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export const wineById = indexBy(VOCAB.wines);
export const grapeById = indexBy(VOCAB.grapes);
export const regionById = indexBy(VOCAB.regions);
export const otherById = indexBy(VOCAB.others);
export const cocktailById = indexBy(VOCAB.cocktails);
export const zeroProofById = indexBy(VOCAB.zeroProof);
export const principleById = indexBy(VOCAB.principles);
export const avoidReasonById = indexBy(VOCAB.avoidReasons);
export const sourceById = indexBy(VOCAB.sources);

/** Every drink style id the model may name (wines, other drinks, zero-proof). */
export const drinkStyleIds = new Set<string>([
  ...VOCAB.wines.map((w) => w.id),
  ...VOCAB.others.map((o) => o.id),
  ...VOCAB.zeroProof.map((z) => z.id),
]);

/** Término para buscar la bebida en una tienda. Null si el id no es vino ni otra bebida alcohólica. */
export function searchTermFor(styleId: string): string | null {
  const style = wineById.get(styleId) ?? otherById.get(styleId);
  if (!style) return null;
  return style.searchTerm ?? style.name;
}

/**
 * Null when the wine choice is coherent with the vocabulary; otherwise a short reason.
 * Grapes and regions must belong to the style; the temperature must fall in its range.
 */
export function wineChoiceProblem(
  styleId: string,
  grapeIds: readonly string[],
  regionIds: readonly string[],
  serveTempF: number,
): string | null {
  const style = wineById.get(styleId);
  if (!style) return `unknown wine styleId "${styleId}"`;
  const badGrape = grapeIds.find((g) => !style.grapes.includes(g));
  if (badGrape !== undefined) return `grape "${badGrape}" is not in style "${styleId}"`;
  const badRegion = regionIds.find((r) => !style.regions.includes(r));
  if (badRegion !== undefined) return `region "${badRegion}" is not in style "${styleId}"`;
  const [lo, hi] = style.serveTempF;
  if (serveTempF < lo || serveTempF > hi) {
    return `serveTempF ${serveTempF} is outside ${lo}-${hi} for style "${styleId}"`;
  }
  return null;
}

export function isValidWineChoice(
  styleId: string,
  grapeIds: readonly string[],
  regionIds: readonly string[],
  serveTempF: number,
): boolean {
  return wineChoiceProblem(styleId, grapeIds, regionIds, serveTempF) === null;
}
