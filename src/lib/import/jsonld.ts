// schema.org Recipe from a page's JSON-LD: the amounts the site itself publishes. Everything here is page data, never instructions.

export type LdRecipe = { name: string; ingredients: string[]; steps: string[]; yieldText?: string; servings?: number };

export const LD_LIMITS = { blocks: 20, blockChars: 200_000, depth: 40, nodes: 5000, recipes: 5, ingredients: 30, ingredientChars: 160, steps: 30, stepChars: 500, nameChars: 120, textChars: 8000 } as const;

type Obj = Record<string, unknown>;

const ENTITIES = new Map<string, string>([
  ["nbsp", " "],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["#39", "'"],
  ["#x27", "'"],
]);

// Number bound to its portions word ("8 servings", "4-6 servings", "6 people"), then a "Serves N" / "Makes N" phrase.
const SERVINGS_COUNT = /(?<![\d.])(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\s*(?:servings?|portions?|people)\b/i;
const SERVES_COUNT = /\b(?:serves|makes)\s+(\d{1,2})(?![\d.])/i;

const DISH_STOP = new Set([
  "the", "and", "with", "for", "from", "recipe", "recipes", "easy", "best", "homemade", "authentic", "quick", "simple", "classic", "ultimate", "perfect", "how", "make", "made", "your", "you", "this", "that",
]);

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRecipeName(t: string): boolean {
  return t === "Recipe" || t.endsWith("/Recipe");
}

function isRecipeType(t: unknown): boolean {
  if (typeof t === "string") return isRecipeName(t);
  return Array.isArray(t) && t.some((x) => typeof x === "string" && isRecipeName(x));
}

export function cleanText(s: unknown): string {
  const stripped = String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x27|nbsp|amp|lt|gt|quot);/g, (m, ent: string) => {
      const named = ENTITIES.get(ent);
      if (named !== undefined) return named;
      const n = Number(ent.slice(1));
      return n < 65536 ? String.fromCharCode(n) : m;
    });
  const noControl = Array.from(stripped)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return !((c < 32 && c !== 9 && c !== 10) || c === 127);
    })
    .join("");
  return noControl.replace(/\s+/g, " ").trim();
}

function flattenSteps(v: unknown, depth: number): string[] {
  if (depth > LD_LIMITS.depth) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap((item) => flattenSteps(item, depth + 1));
  if (isObj(v)) {
    if (v.itemListElement !== undefined) return flattenSteps(v.itemListElement, depth + 1);
    if (typeof v.text === "string") return [v.text];
  }
  return [];
}

function toRecipe(node: Obj): LdRecipe | null {
  const name = cleanText(node.name).slice(0, LD_LIMITS.nameChars);
  const rawIngredients = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [node.recipeIngredient];
  const ingredients = rawIngredients
    .map((x) => cleanText(x))
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, LD_LIMITS.ingredientChars))
    .slice(0, LD_LIMITS.ingredients);
  if (ingredients.length === 0) return null;
  const flat = flattenSteps(node.recipeInstructions, 0)
    .map((s) => cleanText(s))
    .filter((s) => s.length > 0);
  const steps = splitInlineSteps(flat)
    .map((s) => s.slice(0, LD_LIMITS.stepChars))
    .slice(0, LD_LIMITS.steps);
  const { yieldText, servings } = parseServings(node.recipeYield);
  return { name, ingredients, steps, yieldText, servings };
}

function collectRecipes(root: unknown, out: LdRecipe[]): void {
  let visited = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > LD_LIMITS.depth || visited >= LD_LIMITS.nodes || out.length >= LD_LIMITS.recipes) return;
    visited++;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (!isObj(node)) return;
    if (isRecipeType(node["@type"])) {
      const r = toRecipe(node);
      if (r) out.push(r);
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  walk(root, 0);
}

export function extractRecipeLds(html: string): LdRecipe[] {
  try {
    const out: LdRecipe[] = [];
    const re = /<script\b[^>]*?\stype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
    let m: RegExpExecArray | null;
    let blocks = 0;
    while (blocks < LD_LIMITS.blocks && out.length < LD_LIMITS.recipes && (m = re.exec(html)) !== null) {
      blocks++;
      const body = m[1];
      if (body.length > LD_LIMITS.blockChars) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      collectRecipes(parsed, out);
    }
    return out;
  } catch {
    return [];
  }
}

export function splitInlineSteps(steps: string[]): string[] {
  if (steps.length !== 1) return steps;
  const text = steps[0];
  const marks = Array.from(text.matchAll(/(^|\s|\.)\s*(\d{1,2})\.\s+(?=[A-ZÁÉÍÓÚÑ])/g));
  if (marks.length < 2) return steps;
  if (marks.some((m, i) => Number(m[2]) !== i + 1)) return steps;
  const first = marks[0];
  if (text.slice(0, first.index ?? 0).trim() !== "") return steps;
  const pieces: string[] = [];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const next = marks[i + 1];
    const end = next ? (next.index ?? 0) + next[1].length : text.length;
    const piece = text.slice(start, end).trim();
    if (piece) pieces.push(piece);
  });
  return pieces;
}

export function parseServings(yieldValue: unknown): { yieldText?: string; servings?: number } {
  const last = Array.isArray(yieldValue) ? yieldValue[yieldValue.length - 1] : yieldValue;
  const text = cleanText(last);
  if (text === "") return {};
  const yieldText = text.slice(0, 60);
  let servings: number | undefined;
  if (/^\d{1,2}$/.test(text)) {
    const n = Number(text);
    if (n >= 1 && n <= 24) servings = n;
  } else {
    const m = SERVINGS_COUNT.exec(text) ?? SERVES_COUNT.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 24) servings = n;
    }
  }
  return { yieldText, servings };
}

function dishTokens(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3 && !DISH_STOP.has(t));
}

export function dishMatches(postTitle: string, recipeName: string): boolean {
  const postTokens = dishTokens(postTitle);
  if (postTokens.length === 0) return false;
  const recipeTokens = dishTokens(recipeName);
  const same = (a: string, b: string): boolean =>
    a === b || a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a;
  const hit = (p: string): boolean => recipeTokens.some((r) => same(p, r));
  const matched = postTokens.filter(hit).length;
  const needed = postTokens.length <= 2 ? postTokens.length : Math.ceil(postTokens.length / 2);
  return matched >= needed;
}

export function ldToLookedUp(r: LdRecipe, host: string): string | null {
  if (r.steps.length === 0) return null;
  const clause = typeof r.servings === "number" ? `makes ${r.servings} servings` : "servings not stated by the page";
  const build = (steps: string[]): string =>
    [
      "INGREDIENTS:",
      ...r.ingredients.map((i) => `- ${i}`),
      "STEPS:",
      ...steps.map((s, i) => `${i + 1}. ${s}`),
      `NOTES: a published recipe for this dish, "${r.name}" at ${host}; ${clause}.`,
    ].join("\n");
  let steps = r.steps;
  let out = build(steps);
  while (out.length > LD_LIMITS.textChars && steps.length > 1) {
    steps = steps.slice(0, -1);
    out = build(steps);
  }
  return out.length > LD_LIMITS.textChars ? null : out;
}
