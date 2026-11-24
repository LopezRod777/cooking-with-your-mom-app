import { z } from "zod";
import { CATALOG_KEYS } from "./catalog";

export const MealSlot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealSlot = z.infer<typeof MealSlot>;

// When the person eats. "HH:MM" 24 h for the three meals; the snack is a moment of the day, "any", or "mama":
// Mama places each snack by what it is (a smoothie mid-morning, a sandwich in the afternoon).
export const SnackTime = z.enum(["mama", "midmorning", "afternoon", "evening", "any"]);
export type SnackTime = z.infer<typeof SnackTime>;
export const SnackMoment = z.enum(["midmorning", "afternoon", "evening"]);
export type SnackMoment = z.infer<typeof SnackMoment>;
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const MealTimesWire = z.object({ breakfast: Clock, lunch: Clock, dinner: Clock, snack: SnackTime });
export const MealTimes = z
  .object({ breakfast: Clock.default("08:00"), lunch: Clock.default("13:00"), dinner: Clock.default("19:30"), snack: SnackTime.default("mama") })
  .default({ breakfast: "08:00", lunch: "13:00", dinner: "19:30", snack: "mama" });
export type MealTimes = z.infer<typeof MealTimes>;

export const KITCHEN_TOOLS = ["stove", "oven", "microwave", "airFryer", "blender", "toaster", "riceCooker", "multiCooker"] as const;
export type KitchenTool = (typeof KITCHEN_TOOLS)[number];
// What the student has in the apartment. null = never asked (accounts from before the question).
export const Kitchen = z.object({ stove: z.boolean(), oven: z.boolean(), microwave: z.boolean(), airFryer: z.boolean(), blender: z.boolean(), toaster: z.boolean(), riceCooker: z.boolean(), multiCooker: z.boolean() });
export type Kitchen = z.infer<typeof Kitchen>;
// First view of the question: a typical student kitchen.
export const DEFAULT_KITCHEN: Kitchen = { stove: true, oven: false, microwave: true, airFryer: false, blender: false, toaster: false, riceCooker: false, multiCooker: false };

export const PetIntro = z.object({
  id: z.string().min(6).max(24),
  name: z.string().trim().max(24).optional(),
  species: z.enum(["dog", "cat"]).optional(),
  weightKg: z.number().min(0.5).max(90).optional(),
  breed: z.string().trim().max(40).optional(),
  photo: z.object({ key: z.string().max(200), updatedAt: z.iso.datetime() }).optional(),
});
export type PetIntro = z.infer<typeof PetIntro>;

// Profile lists go into every AI prompt. Trimmed (never rejected) so stored profiles keep loading.
const capList = (list: string[]): string[] => list.slice(0, 40).map((item) => item.slice(0, 80));

export const Profile = z.object({
  version: z.literal(1),
  proteinTargetG: z.int().min(40).max(300).default(120),
  daysToPlan: z.union([z.literal(3), z.literal(5), z.literal(7)]).default(5),
  slots: z
    .object({
      breakfast: z.boolean(),
      lunch: z.boolean(),
      dinner: z.boolean(),
      snack: z.boolean(),
    })
    .default({ breakfast: true, lunch: true, dinner: true, snack: false }),
  mealTimes: MealTimes,
  servingsPerMeal: z.int().min(1).max(6).default(2),
  cuisines: z.array(z.string()).transform(capList).default([]),
  allergies: z.array(z.string()).transform(capList).default([]),
  dislikes: z.array(z.string()).transform(capList).default([]),
  diet: z
    .enum(["none", "vegetarian", "vegan", "pescatarian", "kosher", "halal", "carnivore", "keto", "paleo", "mediterranean"])
    .default("none"),
  // "maintain" was shipped briefly; stored values fall back to the default and the tile is gone.
  // "stronger" and "clean_bulk" had the same numbers (×1.10, 1.6 g/kg), so they are one goal now; old rows read as clean_bulk.
  goal: z
    .enum(["grow", "eat_well", "lean", "rapid_fat_loss", "stronger", "clean_bulk"])
    .catch("eat_well")
    .default("eat_well")
    .transform((g): "grow" | "eat_well" | "lean" | "rapid_fat_loss" | "clean_bulk" => (g === "stronger" ? "clean_bulk" : g)),
  maxMinutesPerMeal: z.int().min(10).max(120).default(30),
  weeklyBudgetUsd: z.int().min(20).max(400).default(100),
  // Weekly budget for drinks, apart from food. null = not set. Asked in onboarding when pairings are wanted; edited in Settings and the pairings header.
  drinksBudgetUsd: z.number().int().min(0).max(300).nullable().default(null),
  // Kitchen tools in the apartment. null = not asked yet. Asked in onboarding and Settings ("Your kitchen").
  kitchen: Kitchen.nullable().default(null),
  // Pets at home. null = not asked yet (the Pets tab shows); false hides the Pets tab. Asked in onboarding and Settings.
  hasPets: z.boolean().nullable().default(null),
  // Drink pairings wanted (21+). null = not asked: the Pairings tab shows only while the session gate is open;
  // true shows it always (the page still asks the age self-declaration); false hides it. Asked in onboarding and Settings.
  drinkPairings: z.boolean().nullable().default(null),
  // Mama suggests a homemade drink with some meals (PlannedMeal.drink) and shops for it. Off unless the person turns it on in Settings.
  mealDrinks: z.boolean().default(false),
  // "Cook for your pet too?" null = not asked. false hides the Pets tab even with pets at home.
  cookForPets: z.boolean().nullable().default(null),
  // What onboarding learned about the first pet before a full card exists. The Pets tab pre-fills its form
  // from it and clears it on save. All fields but the id are optional ("add it later").
  petIntro: PetIntro.nullable().default(null),
  skill: z.enum(["beginner", "comfortable"]).default("beginner"),
  onboarded: z.boolean().default(false),
});
export type Profile = z.infer<typeof Profile>;

export const DIETS = [
  { id: "none", label: "No special diet", rule: "" },
  { id: "vegetarian", label: "Vegetarian", rule: "no meat, poultry, fish or seafood" },
  { id: "vegan", label: "Vegan", rule: "no animal products at all (no meat, fish, dairy, eggs, honey)" },
  { id: "pescatarian", label: "Pescatarian", rule: "no meat or poultry; fish and seafood are fine" },
  { id: "kosher", label: "Kosher", rule: "no pork or shellfish, never mix meat and dairy in one meal, meat must be kosher" },
  { id: "halal", label: "Halal", rule: "no pork or alcohol, meat must be halal" },
  {
    id: "carnivore",
    label: "Carnivore",
    rule: "animal foods only: meat, poultry, fish, seafood, eggs and dairy, seasoned with salt; no vegetables, fruit, grains, legumes, nuts, seeds, sugar or plant oils (cook in butter)",
  },
  {
    id: "keto",
    label: "Keto",
    rule: "very low carb: no grains, bread, tortillas, pasta, rice, oats, potatoes, sweet potatoes, corn, beans, lentils, sugar, honey or syrup, and no fruit except small amounts of berries or avocado; fat and protein carry each meal",
  },
  {
    id: "paleo",
    label: "Paleo",
    rule: "no grains, legumes (including peanuts, soy and tofu), dairy, refined sugar or seed oils; meat, fish, eggs, vegetables, fruit, nuts, seeds and olive oil are fine",
  },
  {
    id: "mediterranean",
    label: "Mediterranean",
    rule: "mostly vegetables, legumes, whole grains, fish and olive oil; poultry and dairy in moderation, red meat rarely, little added sugar",
  },
] as const;

// One goal at a time. "Just eat well" is the neutral option (no cut, no bulk); the other four shape portions.
export const GOALS = [
  { id: "grow", label: "Eat to grow", rule: "still growing: nutrient-dense meals every day with dairy, leafy greens and iron-rich foods, generous portions, never a cut" },
  { id: "eat_well", label: "Just eat well", rule: "" },
  { id: "lean", label: "Get lean", rule: "lighter meals: lean proteins, lots of vegetables, modest carbs and oils; keep protein at the target" },
  {
    id: "rapid_fat_loss",
    label: "Rapid fat loss",
    rule: "a firm cut, harder than Get lean: protein at the target in every meal, the plate mostly vegetables, minimal added fats and no added sugar, carbs small and around training; still real meals, never skipped ones",
  },
  {
    id: "clean_bulk",
    label: "Build muscle",
    rule: "lean mass gain: MORE food than a normal plate, about 10 to 15 percent more energy per serving than Just eat well, never a cut: generous whole-food carbs on every plate (rice, quinoa, potatoes, oats, whole-grain bread), protein at the target every day, lean proteins, little added fat, nothing junky",
  },
] as const;

export const Location = z.object({
  label: z.string(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  city: z.string().optional(),
  state: z.string().regex(/^[A-Za-z]{2}$/).optional(),
});
export type Location = z.infer<typeof Location>;

export const RecipeIngredient = z.object({
  key: z.enum(CATALOG_KEYS as [string, ...string[]]),
  grams: z.number().positive(),
  display: z.string().max(60),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

export const StepAction = z.enum([
  "chop", "stir", "sear", "boil", "whisk", "season", "rinse", "bake", "plate", "rest",
]);
export type StepAction = z.infer<typeof StepAction>;

export const RecipeStep = z.object({
  text: z.string().max(400),
  timerSeconds: z.int().min(30).max(7200).optional(),
  tempF: z.int().min(150).max(550).optional(),
  action: StepAction.optional(),
  imageUrl: z.string().url().optional(),
});
export type RecipeStep = z.infer<typeof RecipeStep>;

export const RecipeSource = z.object({
  url: z.string().url(),
  platform: z.enum(["tiktok", "instagram", "youtube", "web", "text"]),
  title: z.string().max(200).optional(),
  author: z.string().max(120).optional(),
  image: z.string().url().optional(),
  ratingValue: z.number().min(0).max(5).optional(),
  ratingCount: z.int().min(0).optional(),
  videoUrl: z.string().url().optional(),
  likes: z.int().min(0).optional(),
  views: z.int().min(0).optional(),
  durationS: z.number().min(0).optional(),
  // Pages Mama read when the source did not give the full recipe (web lookup). Public pages, shown as credit.
  basedOn: z.array(z.object({ url: z.string().url(), title: z.string().max(120).optional() })).max(3).optional(),
});
export type RecipeSource = z.infer<typeof RecipeSource>;

export const Recipe = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().max(60),
  cuisine: z.string(),
  slot: MealSlot,
  servings: z.int().min(1).max(8),
  prepMinutes: z.int(),
  cookMinutes: z.int(),
  ingredients: z.array(RecipeIngredient).min(2).max(20),
  equipment: z.array(z.string()).max(8),
  // Tools the student marked as missing that this recipe still needs; set by plan generation, shown as a chip.
  needsEquipment: z.array(z.enum(KITCHEN_TOOLS)).max(8).optional(),
  steps: z.array(RecipeStep).min(2).max(14),
  substitutions: z
    .array(
      z.object({
        ingredientKey: z.string(),
        swapWith: z.string(),
        note: z.string().max(120),
      }),
    )
    .max(6),
  momTip: z.string().max(160).optional(),
  // One line for the little ones, present only when minors are at the table.
  kidNote: z.string().max(90).optional(),
  // One line from Mama on what changes between the lighter and the heartier plate; present only when plates differ.
  plateNote: z.string().max(120).optional(),
  healthierIdeas: z.array(z.string().max(140)).max(4).optional(),
  source: RecipeSource.optional(),
  imageUrl: z.string().url().optional(),
  imageKey: z.enum([
    "chicken-rice-bowl",
    "breakfast-wrap",
    "greek-yogurt-bowl",
    "taco-bowl",
    "meal-prep",
    "groceries",
    "kitchen-hands",
    "hero",
  ]),
});
export type Recipe = z.infer<typeof Recipe>;

// A homemade non-alcoholic drink that goes with a planned meal (water needs no entry). Ingredients are for the
// meal's servings and go to the shopping list; protein is computed from the catalog, sugar is Mama's estimate.
export const DrinkKind = z.enum(["smoothie", "shake", "agua_fresca", "juice"]);
export type DrinkKind = z.infer<typeof DrinkKind>;
export const Drink = z.object({
  name: z.string().min(1).max(60),
  kind: DrinkKind,
  ingredients: z.array(RecipeIngredient).min(1).max(8),
  sugarG: z.int().min(0).max(120),
  how: z.string().max(240),
});
export type Drink = z.infer<typeof Drink>;

export const PlannedMeal = z.object({
  slot: MealSlot,
  recipeId: z.string(),
  servings: z.int().min(1).max(8),
  drink: Drink.nullable().default(null),
  // Snack meals only: where Mama put it in the day (used when the profile's snack setting is "mama").
  moment: SnackMoment.nullable().default(null),
});
export type PlannedMeal = z.infer<typeof PlannedMeal>;

export const PlanDay = z.object({
  dayIndex: z.int().min(0).max(7),
  label: z.string(),
  // Grace day: the day the account joined, dinner only, outside the days the profile asked for.
  grace: z.boolean().default(false),
  meals: z.array(PlannedMeal),
});
export type PlanDay = z.infer<typeof PlanDay>;

export const WeekPlan = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  days: z.array(PlanDay).min(1).max(8),
  recipes: z.record(z.string(), Recipe),
});
export type WeekPlan = z.infer<typeof WeekPlan>;

export const DISTANCE_STEPS = [0.5, 1, 2, 3, 5, 7.5, 10] as const;

export const RESTRICTION_KINDS = [
  "chicken",
  "beef",
  "turkey",
  "fish",
  "egg",
  "grain",
  "dairy",
  "pancreatitis",
  "kidney",
  "diabetes",
  "other",
] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

export const Restriction = z
  .object({
    kind: z.enum(RESTRICTION_KINDS),
    text: z.string().max(60).optional(),
  })
  .refine((r) => r.text === undefined || r.kind === "other", { message: "text: only with kind other" });
export type Restriction = z.infer<typeof Restriction>;

export const SavedLocation = z.object({
  id: z.string().min(6).max(24),
  label: z.string().max(40),
  zip: z.string().regex(/^\d{5}$/).optional(),
  city: z.string().optional(),
  state: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusMiles: z.union(DISTANCE_STEPS.map((n) => z.literal(n))).optional(),
});
export type SavedLocation = z.infer<typeof SavedLocation>;

export const PreferredStore = z.object({
  id: z.string().max(80),
  name: z.string().max(80),
  brand: z.string().max(40).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // undefined: aún no buscada; null: buscada y no es tienda Kroger; texto: locationId de Kroger.
  krogerLocationId: z.string().max(20).nullable().optional(),
});
export type PreferredStore = z.infer<typeof PreferredStore>;

export const Places = z.object({
  saved: z
    .array(SavedLocation)
    .max(5)
    .refine((list) => new Set(list.map((l) => l.id)).size === list.length, { message: "places.saved: ids must be unique" }),
  activeId: z.string().optional(),
  preferredStore: PreferredStore.optional(),
});
export type Places = z.infer<typeof Places>;

export const Pet = z.object({
  id: z.string().min(6).max(24),
  name: z.string().trim().min(1).max(24),
  species: z.enum(["dog", "cat"]),
  weightKg: z.number().min(0.5).max(90),
  bornYearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  neutered: z.boolean(),
  expectedAdultSize: z.enum(["small", "medium", "large"]).optional(),
  breed: z.string().trim().max(40).optional(),
  // Private blob pets/<userId>/<id>.jpg. updatedAt busts the browser cache on replace.
  photo: z.object({ key: z.string().max(200), updatedAt: z.iso.datetime() }).optional(),
  restrictions: z.array(Restriction).max(8).default([]),
  extrasLog: z
    .array(
      z.object({
        id: z.string().max(24).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kcal: z.number().min(0).max(5000),
        label: z.string().max(60),
        foodId: z.string().max(40).optional(),
        grams: z.number().min(0).max(2000).optional(),
        components: z
          .array(
            z.object({
              foodId: z.string().max(40),
              grams: z.number().min(0).max(2000),
              kcal: z.number().min(0).max(5000),
            }),
          )
          .max(8)
          .optional(),
      }),
    )
    .max(60)
    .default([]),
});
export type Pet = z.infer<typeof Pet>;

// Shared by AppState (default []) and AppStateWire (required): the field and its rules are the same.
const PetList = z
  .array(Pet)
  .max(6)
  .refine((pets) => new Set(pets.map((p) => p.id)).size === pets.length, { message: "pets: ids must be unique" });

// A person at the table. Mama sizes their plate from the body profile (src/lib/energy.ts); nobody picks a plate.
// Sex, age, height and weight stay in the account and never reach the model (see src/lib/ai/prompts.ts).
export const Plate = z.enum(["light", "regular", "hearty"]);
export type Plate = z.infer<typeof Plate>;
export const SPORT_IDS = ["weights", "running", "cycling", "swimming", "soccer", "basketball", "climbing", "hiit", "tennis", "walking", "bodyweight"] as const;
export type SportId = (typeof SPORT_IDS)[number];
// Under 16 = still growing (product decision, the owner, 2026-11-04; see docs/plans/2026-11-04-ninos-en-la-mesa.md).
const stillGrowing = (age: number | null) => age !== null && age < 16;
export const Person = z.object({
  id: z.string().min(1).max(24),
  name: z.string().max(24).default(""),
  // Who this is to the cook (partner, child, friend, ...): labels and order at the table. Never sent as a name.
  relation: z.enum(["partner", "child", "friend", "roommate", "parent", "other"]).nullable().default(null),
  // "unspecified" = rather not say, or skipped the details: no estimate, a regular plate.
  sex: z.enum(["woman", "man", "unspecified"]).nullable().default(null),
  age: z.int().min(2).max(100).nullable().default(null),
  heightCm: z.number().min(120).max(230).nullable().default(null),
  weightKg: z.number().min(30).max(300).nullable().default(null),
  training: z.enum(["none", "sometimes", "regular"]).nullable().default(null),
  // Children only (age 2 to 12): how much they move. null = moderately active. Adults keep training and sports.
  activity: z.enum(["sedentary", "moderate", "active"]).nullable().default(null),
  sports: z.array(z.enum(SPORT_IDS)).max(6).default([]),
  daysPerWeek: z.int().min(1).max(7).nullable().default(null),
  minutesPerSession: z.int().min(10).max(240).nullable().default(null),
  goal: z
    .enum(["grow", "eat_well", "lean", "rapid_fat_loss", "stronger", "clean_bulk"])
    .default("eat_well")
    .transform((g): "grow" | "eat_well" | "lean" | "rapid_fat_loss" | "clean_bulk" => (g === "stronger" ? "clean_bulk" : g)),
  // Applied from check-ins only when the person taps Apply; ±150 per step, capped at ±400 (see src/lib/checkins.ts).
  kcalAdjust: z.int().min(-400).max(400).default(0),
  // Day the person was added (ISO date). The first check-in is due 14 days later.
  addedAt: z.iso.date().nullable().default(null),
  // "Later" on this person's check-in card hides it until this ISO date.
  snoozedUntil: z.iso.date().nullable().default(null),
}).transform((p) =>
  // Saved rows from before the minor rules: a minor is never on a cut or a bulk, and never takes kcal off the table.
  stillGrowing(p.age)
    ? { ...p, goal: p.goal === "lean" || p.goal === "rapid_fat_loss" || p.goal === "clean_bulk" ? ("grow" as const) : p.goal, kcalAdjust: Math.max(0, p.kcalAdjust) }
    : p,
);
export type Person = z.infer<typeof Person>;

// Children 2 to 12 get a table energy target (src/lib/childEnergy.ts); minors 2 to 15 all use the table.
export const isChild = (p: Pick<Person, "age">): boolean => p.age !== null && p.age <= 12;
// Product decision (the owner, 2026-11-04): under 16 = still growing. Sources and Codex suggested 18; see docs/plans/2026-11-04-ninos-en-la-mesa.md.
export const isMinor = (p: Pick<Person, "age">): boolean => stillGrowing(p.age);

// A two-week check-in, one per person. Answers are three taps, an optional weight and what they want more of.
export const WANTS = ["variety", "faster", "cheaper", "filling", "lighter"] as const;
export type Want = (typeof WANTS)[number];
export const CheckIn = z.object({
  id: z.string().min(1).max(24),
  personId: z.string().min(1).max(24),
  at: z.iso.date(),
  energy: z.enum(["low", "ok", "high"]),
  hunger: z.enum(["hungry", "fine", "stuffed"]),
  meals: z.enum(["meh", "fine", "love"]),
  weightLb: z.int().min(70).max(600).nullable().default(null),
  wants: z.array(z.enum(WANTS)).max(3).default([]),
  // What Mama suggested, her one-line reason, and what the person did with it: applied, or kept as is / dismissed.
  suggested: z.enum(["hold", "up", "down"]),
  why: z.string().max(240).default(""),
  applied: z.boolean().default(false),
  kept: z.boolean().default(false),
});
export type CheckIn = z.infer<typeof CheckIn>;
export const CheckInList = z.array(CheckIn).max(60);
export const PeopleList = z
  .array(Person)
  .max(6)
  .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, { message: "people: ids must be unique" });

const AppStateBase = z.object({
  version: z.literal(1),
  profile: Profile,
  location: Location.nullable(),
  plan: WeekPlan.nullable(),
  favorites: z.array(z.string()),
  favoriteRecipes: z.record(z.string(), Recipe),
  haveAtHome: z.array(z.string()),
  checked: z.array(z.string()),
  // When this account saved its first generated plan (ISO instant). Set once by the Week page; backfilled from plan.createdAt for older states in store.ts migrate().
  firstPlannedAt: z.iso.datetime().nullable().default(null),
});

// Reads accept schemas 2 (before pet photo and breed), 3 (before drinks budget), 4 (before kitchen), 5 (before people's body profile), 6 (before check-ins) 7, 8, 9 and 10. Every parse comes out as 11, so an older cache or server row is upgraded on load. A schema-5 row with stage-1 `people[].plate` parses too: the self-chosen plate is retired (dropped), the body fields start empty.
export const AppState = AppStateBase.extend({
  schema: z
    .union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(11)])
    .default(11)
    .transform((): 11 => 11),
  pets: PetList.default([]),
  places: Places.default({ saved: [] }),
  // Who eats. Empty = one unnamed regular plate per cooked serving (see src/lib/people.ts).
  people: PeopleList.default([]),
  checkins: CheckInList.default([]),
});
export type AppState = z.infer<typeof AppState>;

// PUT body profile: `drinksBudgetUsd` and `kitchen` are required (null is allowed), so a client that predates them is rejected instead of erasing them.
const ProfileWire = Profile.extend({
  drinksBudgetUsd: z.number().int().min(0).max(300).nullable(),
  kitchen: Kitchen.nullable(),
  // 8: meal times; a schema-7 client would reset them to the defaults on every save.
  mealTimes: MealTimesWire,
  // 11: a schema-10 client would reset it to false on every save.
  mealDrinks: z.boolean(),
});

// PUT body state: `schema`, `pets`, `places`, `people` and `profile.drinksBudgetUsd` / `profile.kitchen` are required, so a client that predates them is rejected instead of erasing them.
export const AppStateWire = AppStateBase.extend({
  profile: ProfileWire,
  // 6: people carry a body profile (a schema-5 client would overwrite it); 7: check-ins and kcalAdjust on the
  // state (a schema-6 client would drop them); 8: profile.mealTimes (a schema-7 client would reset them). Older
  // clients are rejected as outdated and reload. 9: people under 13, relation, activity and the "grow" goal (a
  // schema-8 client rejects the age and would drop the new fields on save).
  // 10: 8-day plans (grace day) and firstPlannedAt (a schema-9 client cannot parse 8 days).
  // 11: profile.mealDrinks (a schema-10 client would reset it on every save).
  schema: z.literal(11),
  pets: PetList,
  places: Places,
  people: PeopleList,
  checkins: CheckInList,
});

// Bump when the state shape changes incompatibly. Scopes the one-time "reload for a fresh bundle" flag in store.ts.
export const STATE_SCHEMA_TAG = "v11-mealdrinks";

export const DEFAULT_STATE: AppState = {
  version: 1,
  profile: Profile.parse({ version: 1 }),
  location: null,
  plan: null,
  favorites: [],
  favoriteRecipes: {},
  haveAtHome: [],
  checked: [],
  firstPlannedAt: null,
  pets: [],
  schema: 11,
  places: { saved: [] },
  people: [],
  checkins: [],
};
