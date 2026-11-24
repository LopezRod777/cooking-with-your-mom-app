// Prompts for the drink photos. Built only from vocab fields: no per-style text lives here.
import { otherById, wineById, zeroProofById, type WineColor, type WineStyle } from "./vocab";

// Every drink photo ends with this guard: no text, labels, brands or people.
const GUARD = "Photoreal, no text, no labels, no logos, no people, no hands.";

const WINE_NOUN: Record<WineColor, string> = {
  red: "red",
  white: "white",
  rose: "rosé",
  sparkling: "sparkling",
  orange: "orange",
};

const WINE_LIQUID: Record<WineColor, string> = {
  red: "deep ruby",
  white: "pale straw",
  rose: "pale salmon pink",
  sparkling: "pale gold with fine bubbles",
  orange: "amber-orange",
};

// Sweet wines are darker than their color's default: sweet whites look golden, sweet reds garnet.
function wineLiquid(style: WineStyle): string {
  if (style.sweetness === "sweet" && style.color === "white") return "golden";
  if (style.sweetness === "sweet" && style.color === "red") return "garnet";
  return WINE_LIQUID[style.color];
}

function wineGlass(style: WineStyle): string {
  if (style.color === "sparkling") return "flute";
  if (style.sweetness === "sweet" || /sherry|port|madeira|ximénez|ximenez|marsala/i.test(style.name)) return "small glass";
  return "wine glass";
}

function scene(styleId: string): string {
  const wine = wineById.get(styleId);
  if (wine) {
    return `An unlabeled ${WINE_NOUN[wine.color]} wine bottle and one filled ${wineGlass(wine)} of ${wine.name}: ${wineLiquid(wine)}, on a linen tablecloth by a window, soft natural light, shallow depth of field`;
  }
  const other = otherById.get(styleId);
  if (other) {
    if (other.kind === "beer" || other.kind === "cider") {
      return `A tall glass of ${other.name}, light foam, beside an unlabeled brown bottle`;
    }
    if (other.kind === "cocktail") return `${other.name} in the right glass with its garnish, on a bar top`;
    return `A short glass of ${other.name} neat`;
  }
  const zero = zeroProofById.get(styleId);
  if (zero) {
    if (/sparkling/i.test(zero.name)) return `${zero.name} in a flute, fine bubbles, beside an unlabeled bottle`;
    if (/wine/i.test(zero.name)) return `${zero.name} in a wine glass beside an unlabeled bottle`;
    return `${zero.name} in a tall glass with ice and citrus`;
  }
  throw new Error(`unknown drink styleId "${styleId}"`);
}

/** The full prompt sent to the image model. Same styleId always gives the same text. */
export function drinkImagePrompt(styleId: string): string {
  return `${scene(styleId)}. ${GUARD}`;
}

/** Logical key for a drink photo. Throws on an unknown styleId, like drinkImagePrompt. */
export function drinkImageKey(styleId: string): string {
  drinkImagePrompt(styleId);
  return `pairing-drink:${styleId}`;
}
