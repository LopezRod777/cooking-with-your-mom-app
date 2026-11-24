import { KITCHEN_TOOLS, type Kitchen, type KitchenTool } from "../schemas";

export type RecipeLike = { equipment: string[]; steps: { text: string; action?: string }[] };

const OVEN = /\b(oven|bake|baked|baking sheet|baking dish|roast|roasted|roasting|broil|broiler|toaster oven)\b/;
const STOVE_WORDS =
  /\b(skillet|frying pan|saucepan|stovetop|stove|burner|boil|boiling|simmer|simmering|saut[eé]|sauteed|sear|seared|pan-fry|pan-fried|griddle|wok)\b/;
// "pan"/"pot" as whole words; pancakes, potatoes are stripped before this runs.
const PAN_POT = /\b(pan|pot)\b(?!cakes?|atoes?|\s?pie|ful)/;

const FAMILIES: Record<KitchenTool, RegExp[]> = {
  oven: [OVEN],
  stove: [STOVE_WORDS, PAN_POT],
  microwave: [/\bmicrowave(d|-safe)?\b/],
  airFryer: [/\bair[ -]?fry(er|ing|ied)?\b/],
  blender: [/\b(blender|food processor|immersion blender|blend|blended|blending|blitz|pulse|pur[eé]e|pur[eé]ed)\b/],
  toaster: [/\btoaster\b(?!\s?oven)/],
  riceCooker: [/\brice cooker\b/],
  multiCooker: [/\b(instant pot|pressure cooker|slow cooker|crock-?pot|multi-?cooker)\b/],
};

const LABELS: Record<KitchenTool, string> = {
  stove: "a stove",
  oven: "an oven",
  microwave: "a microwave",
  airFryer: "an air fryer",
  blender: "a blender",
  toaster: "a toaster",
  riceCooker: "a rice cooker",
  multiCooker: "a pressure or slow cooker",
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bno-bake\b/g, "")
    .replace(/\bpotato(es)?\b/g, "")
    .replace(/\bpancakes?\b/g, "");
}

// Tools this recipe needs that the kitchen lacks. [] when kitchen is null (never asked).
export function missingEquipment(recipe: RecipeLike, kitchen: Kitchen | null): KitchenTool[] {
  if (!kitchen) return [];
  const texts = [recipe.equipment.join(" | "), ...recipe.steps.map((s) => s.text)].map(normalize);
  const needed = new Set<KitchenTool>();
  for (const tool of KITCHEN_TOOLS) {
    if (FAMILIES[tool].some((re) => texts.some((t) => re.test(t)))) needed.add(tool);
  }
  if (recipe.steps.some((s) => s.action === "bake")) needed.add("oven");
  return KITCHEN_TOOLS.filter((tool) => needed.has(tool) && kitchen[tool] === false);
}

// Human label for a tool.
export function toolLabel(tool: KitchenTool): string {
  return LABELS[tool];
}

// "Needs an oven" / "Needs an oven and a blender".
export function needsLine(tools: KitchenTool[]): string {
  return `Needs ${tools.map(toolLabel).join(" and ")}`;
}
