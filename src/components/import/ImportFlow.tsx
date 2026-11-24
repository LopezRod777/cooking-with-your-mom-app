"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { ChoiceTile } from "@/components/ui/Choice";
import { BasedOn } from "@/components/recipe/BasedOn";
import { WhoIsEating, namesOf, tablePeople, withCompanion } from "@/components/people/WhoIsEating";
import { Field, inputClass } from "@/components/ui/Field";
import { StickyNote } from "@/components/ui/StickyNote";
import { ChoppingLoader } from "@/components/week/ChoppingLoader";
import { dayLabels, postJson, SLOT_LABELS, swapMealRecipe } from "@/components/week/plan-utils";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import { missingEquipment, needsLine } from "@/lib/ai/kitchen";
import { needsMamaVersion, versionReasons } from "@/lib/import/version";
import { peopleForRequest } from "@/lib/people";
import { planPets } from "@/lib/pets/planPets";
import { findSavedId, pickId } from "@/lib/import/saved";
import { flowStep } from "@/lib/stepText";
import { perServing, scaleRecipe } from "@/lib/nutrition";
import { Recipe, type Person, type RecipeSource } from "@/lib/schemas";
import { useAppState } from "@/lib/useAppState";

const ImportResponse = z.union([
  z.object({
    needsText: z.literal(true),
    reason: z.string().optional(),
    title: z.string().optional(),
    author: z.string().optional(),
    image: z.string().optional(),
    platform: z.enum(["tiktok", "instagram", "youtube", "web", "text"]).optional(),
    url: z.string().optional(),
    videoUrl: z.string().optional(),
    likes: z.number().optional(),
    views: z.number().optional(),
    durationS: z.number().optional(),
  }),
  z.object({ recipe: Recipe }),
]);

const NEEDS_TEXT_COPY = "That site won't let Mama in. Paste the caption or recipe text and she'll do the rest.";
const BUSY_COPY = "Mama's hands are full right now. Try that link again in a minute, or paste the recipe.";
const SLOW_AFTER_MS = 45_000;
const NO_RECIPE_COPY = "I watched it, but there's no recipe in there. Paste it if you have it.";

type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; step: "reading" | "adapting" }
  | { kind: "needsText"; message?: string; video?: SourceVideoProps }
  | { kind: "result"; recipe: Recipe; mine?: Recipe; mineError?: string; forIds: string[]; adapting?: boolean };

const PLATFORM_LABEL: Record<RecipeSource["platform"], string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  web: "recipe site",
  text: "pasted text",
};

const SOCIAL = new Set<RecipeSource["platform"]>(["tiktok", "instagram", "youtube"]);

const compactNumber = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export type SourceVideoProps = {
  videoUrl: string;
  poster?: string;
  url: string;
  platform: RecipeSource["platform"];
  author?: string;
  likes?: number;
};

// The creator's video, with sound on demand: no autoplay, she taps to watch. Portrait (9:16) is the
// default; the box switches to landscape (16:9) once the metadata says the video is wider than tall.
export function SourceVideo({ videoUrl, poster, url, platform, author, likes }: SourceVideoProps) {
  const [portrait, setPortrait] = useState(true);
  const by = author ? `From ${author} on ${PLATFORM_LABEL[platform]}` : `From ${PLATFORM_LABEL[platform]}`;
  const credit =
    likes === undefined ? by : `${by} · ${compactNumber(likes)} ${likes === 1 ? "like" : "likes"}`;

  return (
    <figure className="mx-auto grid w-full max-w-xl gap-3">
      <div
        className="mx-auto w-full overflow-hidden rounded-[20px] bg-black"
        style={{
          aspectRatio: portrait ? "9 / 16" : "16 / 9",
          maxHeight: 420,
          maxWidth: portrait ? 236 : undefined,
        }}
      >
        <video
          src={videoUrl}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setPortrait(v.videoHeight >= v.videoWidth);
          }}
          className="h-full w-full object-contain"
        />
      </div>
      <figcaption className="text-[18px] text-muted">
        {credit}
        {" · "}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-ink underline underline-offset-4"
        >
          Watch the original
        </a>
      </figcaption>
    </figure>
  );
}

const textareaClass =
  "min-h-[160px] w-full rounded-[18px] border border-ink/25 bg-paper p-5 text-[20px] leading-snug text-ink placeholder:text-muted/70 focus:border-tomato focus:outline-none";

export function ImportFlow({ onSaved }: { onSaved?: (recipeId: string) => void } = {}) {
  const [state, setState, hydrated] = useAppState();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);
  const [forIds, setForIds] = useState<string[] | null>(null);
  // Bumped on every read, retable and start-over: a version that arrives late for an older request is dropped.
  const run = useRef(0);
  const asking = useRef<AbortController | null>(null);
  // Leaving the screen hangs up, so the video line does not keep working for nobody.
  useEffect(
    () => () => {
      run.current++;
      asking.current?.abort();
    },
    [],
  );

  const [slow, setSlow] = useState(false);
  const waiting = phase.kind === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [waiting]);

  if (!hydrated) return null;

  const busy = phase.kind === "waiting";
  const table = tablePeople(state.people);
  const picked = table.filter((p) => (forIds ?? table.map((t) => t.id)).includes(p.id));

  const MINE_ERROR: Record<string, string> = {
    diet_violation: "Mama couldn't make a version that fits your diet, so here it is as imported.",
    allergy_violation: "Mama couldn't make a safe version for your allergies, so here it is as imported.",
  };
  // Mama's version for the people picked. Resolves to nothing when there is nothing to adjust; never throws.
  async function adapt(recipe: Recipe, who: Person[]): Promise<{ mine?: Recipe; mineError?: string }> {
    if (!needsMamaVersion(recipe, state.profile, who)) return {};
    try {
      const data = await postJson("/api/import/my-version", {
        recipe,
        profile: state.profile,
        pets: planPets(state.pets),
        people: peopleForRequest(who),
        servings: who.length > 0 ? who.length : recipe.servings,
      });
      const parsed = Recipe.safeParse(data && typeof data === "object" && "recipe" in data ? data.recipe : undefined);
      if (!parsed.success) throw new Error("Mama's version came back a little wrong.");
      const tools = missingEquipment(parsed.data, state.profile.kitchen);
      return { mine: tools.length > 0 ? { ...parsed.data, needsEquipment: tools } : parsed.data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      return { mineError: MINE_ERROR[msg] ?? "Mama couldn't adjust this one, so here it is as imported." };
    }
  }

  // The recipe shows as soon as it is read; Mama's version replaces it when it arrives (about 15 s of Opus).
  async function showAndAdapt(recipe: Recipe, who: Person[]) {
    const mineRun = ++run.current;
    const ids = who.map((p) => p.id);
    const adapting = needsMamaVersion(recipe, state.profile, who);
    setPhase({ kind: "result", recipe, forIds: ids, adapting });
    if (!adapting) return;
    const v = await adapt(recipe, who);
    if (run.current === mineRun) setPhase({ kind: "result", recipe, forIds: ids, ...v });
  }

  async function retable(recipe: Recipe, ids: string[]) {
    setForIds(ids);
    await showAndAdapt(recipe, table.filter((p) => ids.includes(p.id)));
  }

  // A new companion is a household member from now on, as if added in Settings; the new person is picked for this dish.
  function addCompanion(p: Person) {
    setState((prev) => withCompanion(prev, p));
    setForIds([...picked.map((x) => x.id), p.id]);
  }

  async function read(body: { url?: string; text?: string }) {
    const mineRun = ++run.current;
    asking.current?.abort();
    const ctl = new AbortController();
    asking.current = ctl;
    setPhase({ kind: "waiting", step: "reading" });
    try {
      const data = await postJson("/api/import", { ...body, profile: state.profile }, ctl.signal);
      if (run.current !== mineRun) return;
      const parsed = ImportResponse.safeParse(data);
      if (!parsed.success) throw new Error("Mama's recipe came back a little wrong.");
      if ("recipe" in parsed.data) {
        // The import stays as read (a missing tool is flagged); Mama's version for the table comes from adapt().
        const tools = missingEquipment(parsed.data.recipe, state.profile.kitchen);
        const recipe = tools.length > 0 ? { ...parsed.data.recipe, needsEquipment: tools } : parsed.data.recipe;
        await showAndAdapt(recipe, picked);
        return;
      }
      const res = parsed.data;
      const noRecipe = res.reason === "no_recipe_in_video";
      const video =
        noRecipe && res.videoUrl && res.url && res.platform
          ? {
              videoUrl: res.videoUrl,
              poster: res.image,
              url: res.url,
              platform: res.platform,
              author: res.author,
              likes: res.likes,
            }
          : undefined;
      setShowText(true);
      setPhase({ kind: "needsText", message: noRecipe ? NO_RECIPE_COPY : res.reason === "busy" ? BUSY_COPY : undefined, video });
    } catch (err) {
      if (run.current !== mineRun) return;
      setShowText(true);
      setPhase({ kind: "needsText", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  function submitLink(e: FormEvent) {
    e.preventDefault();
    if (link.trim()) void read({ url: link.trim() });
  }

  function submitText(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    void read({ text: text.trim(), url: link.trim() || undefined });
  }

  function startOver() {
    run.current++;
    setPhase({ kind: "idle" });
    setLink("");
    setText("");
    setShowText(false);
  }

  if (phase.kind === "result") {
    const base = phase.forIds.length > 0 && phase.forIds.length !== phase.recipe.servings ? scaleRecipe(phase.recipe, phase.forIds.length) : phase.recipe;
    return (
      <ImportResult
        recipe={base}
        mine={phase.mine}
        mineError={phase.mineError}
        adapting={phase.adapting}
        reasons={versionReasons(phase.recipe, state.profile, table.filter((p) => phase.forIds.includes(p.id)))}
        table={table}
        all={state.people}
        forIds={phase.forIds}
        onRetable={(ids) => void retable(phase.recipe, ids)}
        onReset={startOver}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-8">
      <header className="grid gap-3">
        <h1 className="text-[40px] leading-[1.1]">
          Bring your Mama a{" "}
          <em className="rounded-md bg-saffron-soft px-1.5 italic text-tomato">recipe</em>
        </h1>
        <p className="text-[18px] text-muted">Paste a TikTok, YouTube or recipe link.</p>
      </header>

      {phase.kind === "waiting" ? (
        <div className="grid gap-6 justify-items-center" role="status">
          <StickyNote>
            {phase.step === "reading" ? "Mama is reading… give her a few seconds." : "Mama is fixing it for your table…"}
          </StickyNote>
          <ChoppingLoader label={phase.step === "reading" ? "Reading the recipe" : "Fixing it for your table"} />
          {slow && <p className="text-[18px] text-muted">Still on it. It takes longer when other people are importing too.</p>}
        </div>
      ) : (
        <>
        <form onSubmit={submitLink} className="grid gap-4">
          <Field label="Recipe link">
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                disabled={busy}
              />
            )}
          </Field>
          <Button type="submit" size="xl" fullWidth disabled={busy || !link.trim()}>
            Read it
          </Button>
        </form>
        <WhoIsEating people={table} all={state.people} selected={picked.map((p) => p.id)} onChange={setForIds} onAdd={addCompanion} disabled={busy} />
        </>
      )}

      {phase.kind === "needsText" && phase.video && <SourceVideo {...phase.video} />}

      {phase.kind === "needsText" && (
        <p role="status" className="text-[20px] leading-snug">
          {phase.message ?? NEEDS_TEXT_COPY}
        </p>
      )}

      {phase.kind !== "waiting" && !showText && (
        <button
          type="button"
          onClick={() => setShowText(true)}
          className="min-h-12 justify-self-start text-[18px] font-semibold underline underline-offset-4"
        >
          Or paste the recipe text
        </button>
      )}

      {phase.kind !== "waiting" && showText && (
        <form onSubmit={submitText} className="grid gap-4">
          <Field label="Recipe text">
            {(id, describedBy) => (
              <textarea
                id={id}
                aria-describedby={describedBy}
                className={textareaClass}
                placeholder="Ingredients, then the steps. Copy them from the caption or the page."
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
              />
            )}
          </Field>
          {link.trim() && (
            <p className="text-[16px] leading-snug text-muted break-all">Credit kept for: {link.trim()}</p>
          )}
          <Button type="submit" size="lg" fullWidth disabled={busy || !text.trim()}>
            Read this
          </Button>
        </form>
      )}
    </div>
  );
}

// Mama's lighter ideas for this dish: plain lines, no cards. The recipe itself is not changed.
export function HealthierIdeas({ ideas }: { ideas: string[] }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-[26px] leading-tight">Mama&apos;s ideas to make it lighter</h2>
      <ul className="grid gap-3">
        {ideas.map((idea, i) => (
          <li key={i} className="text-[19px] leading-snug">
            {idea}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ImportResult({
  recipe,
  onReset,
  resetLabel = "Read another",
  onSaved,
  mine,
  mineError,
  adapting = false,
  reasons = [],
  table = [],
  all = [],
  forIds = [],
  onRetable,
}: {
  recipe: Recipe;
  onReset: () => void;
  resetLabel?: string;
  onSaved?: (recipeId: string) => void;
  mine?: Recipe;
  mineError?: string;
  adapting?: boolean;
  reasons?: string[];
  table?: Person[];
  all?: Person[];
  forIds?: string[];
  onRetable?: (ids: string[]) => void;
}) {
  const [state, setState, hydrated] = useAppState();
  const [choosing, setChoosing] = useState(false);
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [made, setMade] = useState<Recipe | null>(null);
  const [making, setMaking] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(forIds);
  const [originalSaved, setOriginalSaved] = useState<string | null>(null);

  if (!hydrated) return null;

  const active = mine ?? recipe;
  const savedId = findSavedId(state, active);

  // A new recipe for this profile. The original is not touched; the new one goes to favorites, same as a save.
  async function makeMine() {
    setMaking(true);
    setMakeError(null);
    try {
      const data = await postJson("/api/import/my-version", {
        recipe,
        profile: state.profile,
        pets: planPets(state.pets),
        people: peopleForRequest(table.filter((p) => forIds.includes(p.id))),
        servings: forIds.length > 0 ? forIds.length : recipe.servings,
      });
      const parsed = Recipe.safeParse(data && typeof data === "object" && "recipe" in data ? data.recipe : undefined);
      if (!parsed.success) throw new Error("Mama's version came back a little wrong.");
      const picked = pickId(parsed.data, state);
      setState((prev) => (isFavorite(prev, picked.id) ? prev : toggleFavorite(prev, picked)));
      setMade(picked);
    } catch (err) {
      setMakeError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setMaking(false);
    }
  }

  function save() {
    const id = savedId ?? pickId(active, state).id;
    setState((prev) => (findSavedId(prev, active) ? prev : toggleFavorite(prev, pickId(active, prev))));
    onSaved?.(id);
  }

  // The original, saved on its own, for when Mama's version is the one on the plate.
  function saveOriginal() {
    const id = findSavedId(state, recipe) ?? pickId(recipe, state).id;
    setState((prev) => (findSavedId(prev, recipe) ? prev : toggleFavorite(prev, pickId(recipe, prev))));
    setOriginalSaved(id);
  }

  function placeAt(di: number, mi: number) {
    const plan = state.plan;
    if (!plan) return;
    setState((prev) =>
      prev.plan
        ? { ...prev, plan: swapMealRecipe(prev.plan, di, mi, pickId(active, prev)) }
        : prev,
    );
    const meal = plan.days[di]?.meals[mi];
    setAdded(`${dayLabels(plan)[di]?.weekday ?? "Day"}, ${meal ? SLOT_LABELS[meal.slot].toLowerCase() : "meal"}`);
    setChoosing(false);
    setDayIdx(null);
  }

  return (
    <div className="grid gap-8">
      {mine && (
        <section data-testid="mama-version" className="mx-auto w-full max-w-xl grid gap-2">
          <p className="font-hand text-[24px] leading-snug">I made this one for your table, honey.</p>
          {reasons.length > 0 && <p className="text-[16px] text-muted">{reasons.join(" · ")}</p>}
        </section>
      )}
      {adapting && (
        <p role="status" data-testid="mine-adapting" className="mx-auto w-full max-w-xl font-hand text-[24px] leading-snug">
          Here it is as posted. I&apos;m fixing it for your table, give me a few seconds…
        </p>
      )}
      {mineError && (
        <p role="status" data-testid="mine-error" className="mx-auto w-full max-w-xl text-[18px] leading-snug">
          {mineError}
        </p>
      )}
      {table.length > 0 && onRetable && (
        <section data-testid="made-for" className="mx-auto w-full max-w-xl grid gap-3">
          <p className="text-[18px] text-muted">
            {mine ? "Made for" : "Cooking for"} {namesOf(table.filter((p) => forIds.includes(p.id)), all)}.{" "}
            <button
              type="button"
              disabled={making || adapting}
              aria-expanded={picking}
              aria-controls="who-picker"
              onClick={() => {
                setDraftIds(forIds);
                setPicking((v) => !v);
              }}
              className="font-semibold text-ink underline underline-offset-4"
            >
              Change
            </button>
          </p>
          {picking && (
            <div id="who-picker" className="grid gap-3">
              <WhoIsEating people={table} all={all} selected={draftIds} onChange={setDraftIds} title="Who's eating this one?" />
              <Button
                size="md"
                disabled={making || (draftIds.length === forIds.length && draftIds.every((id) => forIds.includes(id)))}
                onClick={() => {
                  setPicking(false);
                  onRetable(draftIds);
                }}
                className="justify-self-start"
              >
                Make it for them
              </Button>
            </div>
          )}
        </section>
      )}
      <Preview key={active.id} recipe={active} variant={mine ? "mine" : "original"} />

      {!mine && (
      <section aria-label="Lighter ideas" className="grid gap-5">
        {recipe.healthierIdeas?.length ? <HealthierIdeas ideas={recipe.healthierIdeas} /> : null}
        <div className="grid gap-2">
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            className="min-h-12"
            disabled={making || adapting}
            onClick={makeMine}
          >
            {making ? "Making your version…" : adapting ? "Mama is making your version…" : "Make my version"}
          </Button>
          <p className="text-[16px] leading-snug text-muted">
            A new recipe for your diet and goal. The original stays as it is.
          </p>
          {makeError && (
            <p role="status" className="text-[18px] leading-snug">
              {makeError}
            </p>
          )}
        </div>
      </section>
      )}

      <section aria-label="Save or add" className="grid gap-4">
        {savedId ? (
          <p className="text-[20px] font-semibold text-basil-text" role="status">
            Saved.{" "}
            <Link href={`/recipe/${savedId}`} className="underline underline-offset-4">
              Open recipe
            </Link>
          </p>
        ) : (
          <Button size="lg" fullWidth onClick={save}>
            Save to favorites
          </Button>
        )}

        {state.plan && !added && (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            aria-expanded={choosing}
            onClick={() => {
              setChoosing((v) => !v);
              setDayIdx(null);
            }}
          >
            Add to this week
          </Button>
        )}

        {added && (
          <p className="text-[20px] font-semibold text-basil-text" role="status">
            Added to {added}.{" "}
            <Link href="/" className="underline underline-offset-4">
              See my week
            </Link>
          </p>
        )}

        {choosing && state.plan && (
          <div className="grid gap-5 rounded-[20px] border border-line p-5">
            <p className="text-[18px] font-semibold">Which day?</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {dayLabels(state.plan).map((label, di) => (
                <ChoiceTile
                  key={label.dayIndex}
                  compact
                  selected={dayIdx === di}
                  aria-label={label.weekday}
                  onClick={() => setDayIdx(di)}
                >
                  {label.weekday.slice(0, 3)}
                </ChoiceTile>
              ))}
            </div>
            {dayIdx !== null && state.plan.days[dayIdx] && (
              <>
                <p className="text-[18px] font-semibold">Which meal?</p>
                <div className="grid gap-3">
                  {state.plan.days[dayIdx].meals.map((meal, mi) => (
                    <button
                      key={`${meal.slot}-${mi}`}
                      type="button"
                      onClick={() => placeAt(dayIdx, mi)}
                      className="flex min-h-14 flex-col items-start rounded-2xl border-2 border-line bg-paper px-4 py-3 text-left transition active:scale-[0.98] hover:border-ink"
                    >
                      <span className="text-[18px] font-semibold">{SLOT_LABELS[meal.slot]}</span>
                      <span className="text-[16px] text-muted">
                        Replaces {state.plan?.recipes[meal.recipeId]?.title ?? "this meal"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {mine && (
        <details data-testid="original-details" className="grid gap-6 rounded-[20px] border border-line p-5">
          <summary className="cursor-pointer text-[20px] font-semibold">Before Mama&apos;s changes</summary>
          <Preview key={recipe.id} recipe={recipe} />
          {recipe.healthierIdeas?.length ? <HealthierIdeas ideas={recipe.healthierIdeas} /> : null}
          {originalSaved ? (
            <p className="text-[18px] font-semibold text-basil-text" role="status">
              Original saved.{" "}
              <Link href={`/recipe/${originalSaved}`} className="underline underline-offset-4">
                Open it
              </Link>
            </p>
          ) : (
            <Button variant="secondary" size="md" onClick={saveOriginal} className="justify-self-start">
              Save the original
            </Button>
          )}
        </details>
      )}

      {made && (
        <section aria-label="My version" className="grid gap-6 border-t border-line pt-8">
          <p className="text-[20px] font-semibold text-basil-text" role="status">
            My version is saved.{" "}
            <Link href={`/recipe/${made.id}`} className="underline underline-offset-4">
              Open my version
            </Link>
          </p>
          <Preview key={made.id} recipe={made} />
        </section>
      )}

      <Button variant="ghost" size="md" disabled={making} onClick={onReset} className="justify-self-start">
        {resetLabel}
      </Button>
    </div>
  );
}

function Preview({ recipe, variant = "original" }: { recipe: Recipe; variant?: "original" | "mine" }) {
  const src = recipe.source;
  const fallback = `/media/${recipe.imageKey}.jpg`;
  const [imageFailed, setImageFailed] = useState(false);
  const image = src?.image && !imageFailed ? src.image : fallback;
  const platform = src?.platform ?? "text";
  const credit =
    variant === "mine"
      ? platform === "text"
        ? "Mama's take on the text you pasted"
        : src?.author
          ? `Mama's take on ${src.author}'s recipe · ${PLATFORM_LABEL[platform]}`
          : `Mama's take on a ${PLATFORM_LABEL[platform]} recipe`
      : platform === "text"
        ? "From the text you pasted"
        : src?.author
          ? `From ${src.author} · ${PLATFORM_LABEL[platform]}`
          : `From ${PLATFORM_LABEL[platform]}`;
  const protein = perServing(recipe);
  const minutes = recipe.prepMinutes + recipe.cookMinutes;
  const rating =
    src?.ratingValue !== undefined
      ? `${Math.round(src.ratingValue * 100) / 100} ★${
          src.ratingCount !== undefined ? ` · ${src.ratingCount.toLocaleString("en-US")} ratings` : ""
        }`
      : null;

  return (
    <article className="mx-auto grid w-full max-w-xl gap-6">
      {src?.videoUrl && variant !== "mine" ? (
        <SourceVideo
          videoUrl={src.videoUrl}
          poster={src.image}
          url={src.url}
          platform={platform}
          author={src.author}
          likes={src.likes}
        />
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[20px] bg-panel">
          {/* External creator images are not in next/image's allow-list, so a plain img is used with a local fallback. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        </div>
      )}

      <header className="grid gap-2">
        <h2 className="text-[34px] leading-tight">{recipe.title}</h2>
        {recipe.needsEquipment?.length ? (
          <span
            data-testid="needs-equipment"
            className="w-fit rounded-full bg-[#fde7e2] px-3 py-1 text-[15px] font-semibold text-tomato"
          >
            {needsLine(recipe.needsEquipment)} · you marked none
          </span>
        ) : null}
        {(variant === "mine" || !src?.videoUrl) && (
          <p className="text-[18px] text-muted">
            {credit}
            {src && platform !== "text" && (
              <>
                {" · "}
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-ink underline underline-offset-4"
                >
                  {SOCIAL.has(platform) ? "Watch the original" : "Read the original"}
                </a>
              </>
            )}
          </p>
        )}
        <BasedOn source={src} />
        {rating && <p className="text-[18px] text-muted">{rating}</p>}
      </header>

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="text-[16px] text-muted">Protein per serving</dt>
          <dd className="font-display text-[30px]">{protein ? Math.round(protein.protein_g) : "—"} g</dd>
        </div>
        <div>
          <dt className="text-[16px] text-muted">Time</dt>
          <dd className="font-display text-[30px]">{minutes} min</dd>
        </div>
      </dl>

      {recipe.momTip && <StickyNote signed>{recipe.momTip}</StickyNote>}

      <section className="grid gap-3">
        <h3 className="text-[24px]">Ingredients</h3>
        <ul className="grid gap-2">
          {recipe.ingredients.map((ing, i) => (
            <li key={`${ing.key}-${i}`} className="text-[19px] leading-snug">
              {ing.display}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3">
        <h3 className="text-[24px]">Steps</h3>
        <ol className="grid gap-4">
          {recipe.steps.map((step, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr] gap-3">
              <span className="font-display text-[22px] text-tomato">{i + 1}</span>
              <span className="text-[19px] leading-snug">{flowStep(step.text)}</span>
            </li>
          ))}
        </ol>
        {recipe.kidNote && <p data-testid="kid-note" className="font-hand text-[19px] leading-snug text-muted">{recipe.kidNote}</p>}
        {recipe.plateNote && <p data-testid="plate-note" className="font-hand text-[19px] leading-snug text-muted">{recipe.plateNote}</p>}
      </section>

      {recipe.substitutions.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-[24px]">Swaps</h3>
          <ul className="grid gap-2">
            {recipe.substitutions.map((sub, i) => (
              <li key={i} className="text-[18px] leading-snug text-muted">
                {sub.note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
