import { z } from "zod";
import { CATALOG_KEYS } from "../catalog";
import { DrinkKind, MealSlot, Recipe, StepAction } from "../schemas";

// Loose schemas for structured output. The grammar rejects numeric/length constraints,
// so every limit is enforced afterwards by the strict schemas in ../schemas.

const CatalogKey = z.enum(CATALOG_KEYS as [string, ...string[]]);

export const LlmIngredient = z.object({
  key: CatalogKey,
  grams: z.number(),
  display: z.string(),
});
export type LlmIngredient = z.infer<typeof LlmIngredient>;

export const LlmStep = z.object({
  text: z.string(),
  timerSeconds: z.number().optional(),
  tempF: z.number().optional(),
  action: StepAction,
});
export type LlmStep = z.infer<typeof LlmStep>;

export const LlmRecipe = z.object({
  id: z.string(),
  title: z.string(),
  cuisine: z.string(),
  slot: MealSlot,
  servings: z.number(),
  prepMinutes: z.number(),
  cookMinutes: z.number(),
  ingredients: z.array(LlmIngredient),
  equipment: z.array(z.string()),
  steps: z.array(LlmStep),
  substitutions: z.array(
    z.object({
      ingredientKey: z.string(),
      swapWith: z.string(),
      note: z.string(),
    }),
  ),
  momTip: z.string().optional(),
  kidNote: z.string().optional(),
  plateNote: z.string().optional(),
  imageKey: Recipe.shape.imageKey,
});
export type LlmRecipe = z.infer<typeof LlmRecipe>;

// What the import call returns: the recipe as the creator made it, plus 2 to 4 lighter ideas (not applied).
export const LlmImported = z.object({
  recipe: LlmRecipe,
  healthierIdeas: z.array(z.string()),
});
export type LlmImported = z.infer<typeof LlmImported>;

export const LlmSkeleton = z.object({
  days: z.array(
    z.object({
      dayIndex: z.number(),
      label: z.string(),
      meals: z.array(
        z.object({
          slot: MealSlot,
          title: z.string(),
          cuisine: z.string(),
          mainProtein: z.string(),
          servings: z.number(),
          // null = water. A few meals a week get a homemade drink from catalog ingredients.
          drink: z
            .object({ name: z.string(), kind: DrinkKind, ingredients: z.array(LlmIngredient), sugarG: z.number(), how: z.string() })
            .nullable()
            .optional(),
          // Snack meals: where in the day Mama puts this one.
          moment: z.enum(["midmorning", "afternoon", "evening"]).nullable().optional(),
        }),
      ),
    }),
  ),
});
export type LlmSkeleton = z.infer<typeof LlmSkeleton>;

export const LlmDayRecipes = z.object({
  recipes: z.array(LlmRecipe),
});
export type LlmDayRecipes = z.infer<typeof LlmDayRecipes>;

export const LlmSwap = z.object({
  recipes: z.array(LlmRecipe),
});
export type LlmSwap = z.infer<typeof LlmSwap>;
