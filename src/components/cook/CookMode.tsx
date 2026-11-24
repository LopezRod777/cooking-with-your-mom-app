"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppState } from "@/lib/useAppState";
import { dateKey } from "@/lib/pets/energy";
import { PET_FOODS } from "@/lib/pets/foods";
import { portionSteps } from "@/lib/pets/cookForBoth";
import { alreadyFed, appendFeed, cookFeedEntry, cookFeedId } from "@/lib/pets/feed";
import { useDishImages } from "@/lib/images/useDishImages";
import { stepActionFor } from "@/lib/stepAction";
import { flowStep } from "@/lib/stepText";
import { scaleRecipe } from "@/lib/nutrition";
import { peopleFor } from "@/lib/people";
import { PlatesCard, kidNoteFor } from "@/components/recipe/PlatesCard";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import {
  cancelFinishedFor,
  cancelTimer,
  formatMMSS,
  isDone,
  readTimers,
  remaining,
  runningTimersFor,
  startTimer,
  timerKey,
  writeTimers,
  type Timers,
} from "@/lib/timers";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DishPhoto } from "@/components/ui/DishPhoto";
import { Progress } from "@/components/ui/Progress";
import { StickyNote } from "@/components/ui/StickyNote";
import { useOffline } from "@/lib/offline/useOffline";
import { AskMom } from "./AskMom";
import { COOK_TOKENS } from "./cookStyle";
import { useNow, useWakeLock } from "./hooks";
import { playAlert, unlockAudio, vibrate } from "./sound";
import { StepClip } from "./StepClip";
import { StepTimer, TimerBar } from "./Timers";

// While a timer runs, show the calm "rest" clip (steam), unless the pan or pot is
// what she is watching: boil, sear and bake keep their own clip.
const KEEP_OWN_CLIP_WHILE_TIMING = new Set(["boil", "sear", "bake"]);

const INTRO = -1;

// The step on screen, per recipe, for this tab only. A reload lands on the same step.
const cookStepKey = (recipeId: string) => `cwym:cook:${recipeId}`;

function readCookStep(recipeId: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(cookStepKey(recipeId));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

// null removes the entry (intro is the default when nothing is saved).
function writeCookStep(recipeId: string, step: number | null): void {
  try {
    if (step === null) window.sessionStorage.removeItem(cookStepKey(recipeId));
    else window.sessionStorage.setItem(cookStepKey(recipeId), String(step));
  } catch {
    // Storage can be blocked. The step still works in memory.
  }
}

// Pet's plate: "set aside before seasoning" is cosmetic, per recipe, pet and day, for this tab only.
const plateAsideKey = (recipeId: string, petId: string, date: string) => `cwym:plate:${recipeId}:${petId}:${date}`;

function readPlateAside(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writePlateAside(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage can be blocked. The mark still holds in memory for this visit.
  }
}

const foodLabel = (foodId: string) => PET_FOODS.find((f) => f.id === foodId)?.shortLabel ?? foodId;

// `id` comes as a prop only from the no-signal screens, where the route has no params.
export function CookMode({ id: idProp }: { id?: string } = {}) {
  const offline = useOffline();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState, hydrated] = useAppState();
  useDishImages(state, setState, hydrated);

  const id = idProp ?? (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? ""));
  const base = state.plan?.recipes[id] ?? state.favoriteRecipes[id];

  const plannedServings = state.plan?.days
    .flatMap((d) => d.meals)
    .find((m) => m.recipeId === id)?.servings;
  const requested = Number(searchParams.get("servings"));
  const servings =
    Number.isInteger(requested) && requested >= 1 && requested <= 8
      ? requested
      : (plannedServings ?? base?.servings ?? 1);
  const recipe = useMemo(
    () => (base && base.servings !== servings ? scaleRecipe(base, servings) : base),
    [base, servings],
  );

  const [step, setStep] = useState(INTRO);
  const [ready, setReady] = useState<number[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  const [timers, setTimers] = useState<Timers>({});
  const [timersLoaded, setTimersLoaded] = useState(false);
  const [stepLoaded, setStepLoaded] = useState(false);
  const restoredStep = useRef(false);
  const notified = useRef<Set<string>>(new Set());
  const [asideMarked, setAsideMarked] = useState<string[]>([]);

  const total = recipe?.steps.length ?? 0;
  const finished = total > 0 && step === total;
  const onStepScreen = step >= 0 && step < total;
  const now = useNow(Object.keys(timers).length > 0);

  // Load timers once, after mount. Timers already done at load do not beep again.
  useEffect(() => {
    const saved = readTimers();
    const at = Date.now();
    for (const [key, t] of Object.entries(saved)) {
      if (isDone(t, at)) notified.current.add(key);
    }
    setTimers(saved);
    setTimersLoaded(true);
  }, []);

  useEffect(() => {
    if (timersLoaded) writeTimers(timers);
  }, [timers, timersLoaded]);

  // Restore the saved step once the recipe is known. Intro only when nothing is saved.
  useEffect(() => {
    if (!hydrated || restoredStep.current) return;
    restoredStep.current = true;
    const saved = readCookStep(id);
    if (saved !== null && recipe && saved <= total) setStep(saved);
    setStepLoaded(true);
  }, [hydrated, id, recipe, total]);

  useEffect(() => {
    if (stepLoaded) writeCookStep(id, step === INTRO ? null : step);
  }, [id, step, stepLoaded]);

  // Alert once per finished timer, whichever step is on screen.
  useEffect(() => {
    if (now === null) return;
    for (const [key, t] of Object.entries(timers)) {
      if (isDone(t, now) && !notified.current.has(key)) {
        notified.current.add(key);
        playAlert();
        vibrate();
      }
    }
  }, [now, timers]);

  useWakeLock(onStepScreen);

  function go(next: number) {
    if (!recipe) return;
    const clamped = Math.min(total, Math.max(INTRO, next));
    if (clamped === total) {
      // Finishing: finished timers are done with. Running ones stay, and the finish screen says so.
      setTimers((prev) => cancelFinishedFor(prev, recipe.id, Date.now()));
    }
    setStep(clamped);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (askOpen) {
        if (e.key === "Escape") setAskOpen(false);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askOpen, step, total, recipe]);

  if (!hydrated || !timersLoaded || !stepLoaded) return null;

  if (!recipe) {
    return (
      <div className="grid gap-6 py-10">
        <Card>
          <p className="text-[20px]">We could not find that recipe.</p>
        </Card>
        <Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-full border-2 border-line px-6 text-[18px] font-semibold">
          Back to my week
        </Link>
      </div>
    );
  }

  // One plate per pet that can still get a portion from this recipe today, or already has it logged.
  const plateNow = new Date();
  const plateDay = dateKey(plateNow);
  const plates = state.pets.flatMap((pet) => {
    const fedId = cookFeedId(recipe.id, pet.id, plateDay);
    const logged = pet.extrasLog.find((e) => e.id === fedId);
    const entry = cookFeedEntry(pet, recipe, plateNow);
    if (!logged && !entry) return [];
    const plate = logged
      ? { kcal: logged.kcal, parts: logged.components ?? [] }
      : entry && { kcal: entry.kcal, parts: entry.components };
    if (!plate) return [];
    return [{ pet, fed: alreadyFed(pet, fedId), asideKey: plateAsideKey(recipe.id, pet.id, plateDay), ...plate }];
  });
  const asideDone = (key: string) => asideMarked.includes(key) || readPlateAside(key);

  const plateBars = onStepScreen
    ? plates
        .filter((p) => !asideDone(p.asideKey))
        .map((p) => (
          <div
            key={p.pet.id}
            data-testid="pet-plate-bar"
            data-pet={p.pet.id}
            className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border-2 border-line bg-panel px-4 py-2 text-[17px]"
          >
            <p className="min-w-0">{p.pet.name}&apos;s plate: set aside before seasoning</p>
            <button
              type="button"
              onClick={() => {
                writePlateAside(p.asideKey);
                setAsideMarked((prev) => (prev.includes(p.asideKey) ? prev : [...prev, p.asideKey]));
              }}
              className="min-h-12 flex-none rounded-full border-2 border-line px-4 font-semibold"
            >
              Set aside ✓
            </button>
          </div>
        ))
    : null;

  // Same handler as the Pets tab: the entry is rebuilt from the pet as it is in state now, then appendFeed checks it.
  const feedPet = (petId: string) => {
    const at = new Date();
    setState((prev) => ({
      ...prev,
      pets: prev.pets.map((p) => {
        if (p.id !== petId) return p;
        const entry = cookFeedEntry(p, recipe, at);
        return entry ? appendFeed(p, entry, at) : p;
      }),
    }));
  };

  const feedButtons = plates.map((p) => (
    <button
      key={p.pet.id}
      type="button"
      data-testid="feed-pet"
      data-pet={p.pet.id}
      disabled={p.fed}
      onClick={() => feedPet(p.pet.id)}
      className="min-h-14 w-full rounded-full border-2 border-line px-6 text-[19px] font-semibold disabled:opacity-60"
    >
      {p.fed ? `Fed ✓ · ${p.kcal} kcal` : `I fed ${p.pet.name}`}
    </button>
  ));

  const favorite = isFavorite(state, recipe.id);
  const minutes = recipe.prepMinutes + recipe.cookMinutes;
  const current = step >= 0 && step < total ? recipe.steps[step] : undefined;
  const key = timerKey(recipe.id, step);
  const timer = timers[key];
  const timerRunning = timer !== undefined && !(now !== null && isDone(timer, now));
  const ownAction = current ? stepActionFor(current) : undefined;
  const clipAction =
    ownAction && timerRunning && !KEEP_OWN_CLIP_WHILE_TIMING.has(ownAction) ? "rest" : ownAction;
  const otherTimers = Object.entries(timers)
    .filter(([k]) => k.startsWith(`${recipe.id}:`) && k !== key)
    .map(([k, timer]) => ({ index: Number(k.slice(k.lastIndexOf(":") + 1)), timer }))
    .sort((a, b) => a.index - b.index);

  function startStepTimer(seconds: number) {
    unlockAudio();
    setTimers((prev) => startTimer(prev, key, seconds, `Step ${step + 1}`, Date.now()));
  }

  function dismissStepTimer() {
    setTimers((prev) => cancelTimer(prev, key));
  }

  function toggleFav() {
    if (!base) return;
    setState((prev) => toggleFavorite(prev, base));
  }

  let body: ReactNode;
  let footer: ReactNode;

  if (step === INTRO) {
    body = (
      <div className="grid gap-6">
        <section className="relative -mx-5 overflow-hidden bg-[#15110e] lg:mx-0 lg:rounded-[28px]">
          <div className="relative aspect-[4/3] sm:aspect-[21/9]">
            <DishPhoto recipe={recipe} priority sizes="(min-width: 1024px) 1024px, 100vw" />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(21,17,14,0.97)_0%,rgba(21,17,14,0.72)_50%,rgba(21,17,14,0.1)_100%)]" />
          </div>
          <div className="absolute inset-x-0 bottom-0 grid gap-3 px-5 pb-6 lg:px-8">
            <p className="text-[17px] text-muted">
              {recipe.cuisine} · serves {recipe.servings} · {minutes} min
            </p>
            <h1 className="font-display text-[36px] leading-tight text-ink lg:text-[44px]">{recipe.title}</h1>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className="text-[22px] font-semibold">Get these ready</h2>
          <ul className="grid gap-2">
            {recipe.ingredients.map((ing, i) => {
              const checked = ready.includes(i);
              return (
                <li key={`${ing.key}-${i}`}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-4 rounded-2xl border-2 border-line bg-panel px-4 py-3 text-[19px]">
                    <input
                      type="checkbox"
                      className="h-7 w-7 flex-none accent-[var(--color-tomato)]"
                      checked={checked}
                      onChange={() =>
                        setReady((prev) => (checked ? prev.filter((n) => n !== i) : [...prev, i]))
                      }
                    />
                    <span>{ing.display}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
        {recipe.equipment.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-[22px] font-semibold">Equipment</h2>
            <ul className="flex flex-wrap gap-2">
              {recipe.equipment.map((item) => (
                <li
                  key={item}
                  className="inline-flex min-h-12 items-center rounded-full border-2 border-line px-4 text-[18px]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}
        {plates.map((p) => (
          <section
            key={p.pet.id}
            data-testid="pet-plate"
            data-pet={p.pet.id}
            className="grid gap-3 rounded-[24px] border-2 border-line bg-panel p-5"
          >
            <h2 className="text-[22px] font-semibold">{p.pet.name}&apos;s plate</h2>
            <ul className="grid gap-1 text-[18px]">
              {p.parts.map((part) => (
                <li key={part.foodId}>
                  {part.grams} g {foodLabel(part.foodId)}
                </li>
              ))}
            </ul>
            <div className="grid gap-1 text-[17px] text-muted">
              {portionSteps(p.pet.name).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            {p.fed && <p className="text-[18px] font-semibold">Fed ✓ · {p.kcal} kcal</p>}
          </section>
        ))}
      </div>
    );
    footer = (
      <Button fullWidth onClick={() => go(0)}>
        Start
      </Button>
    );
  } else if (finished) {
    const stillRunning = runningTimersFor(timers, recipe.id, now ?? Date.now())[0];
    body = (
      <div className="grid gap-8 pt-6">
        <h1 className="font-display text-[44px] leading-tight lg:text-[56px]">That&apos;s dinner. Nice work.</h1>
        <StickyNote signed>Look at you go. Proud of you.</StickyNote>
        {kidNoteFor(recipe, peopleFor(state)) && (
          <p data-testid="kid-note" className="font-hand text-[19px] leading-snug text-muted">{kidNoteFor(recipe, peopleFor(state))}</p>
        )}
        <PlatesCard recipe={recipe} servings={servings} people={peopleFor(state)} compact />
        {feedButtons}
        {stillRunning && (
          <p role="status" className="text-[18px] font-semibold">
            A timer is still running: Step {stillRunning.index + 1}, {formatMMSS(remaining(stillRunning.timer, now ?? Date.now()))} left{" "}
            <button
              type="button"
              onClick={() => go(stillRunning.index)}
              className="ml-1 font-semibold text-tomato underline underline-offset-4"
            >
              Go to it
            </button>
          </p>
        )}
        <button
          type="button"
          onClick={toggleFav}
          aria-pressed={favorite}
          className="inline-flex min-h-14 items-center gap-3 self-start rounded-full border-2 border-line px-6 text-[19px] font-semibold"
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" className={favorite ? "text-tomato" : ""}>
            <path d="M12 20.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 7.8a4.1 4.1 0 0 1 7.5 2.6c0 5.5-7.5 10.1-7.5 10.1z" />
          </svg>
          {favorite ? "Saved to favorites" : "Save to favorites"}
        </button>
      </div>
    );
    footer = (
      <>
        <Button fullWidth onClick={() => router.push("/")}>
          Back to my week
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onClick={() => {
            setReady([]);
            setTimers((prev) => cancelFinishedFor(prev, recipe.id, Date.now()));
            setStep(INTRO);
          }}
        >
          Cook it again
        </Button>
      </>
    );
  } else if (current) {
    // Phone: top bar, progress, clip, text, timer. Desktop: clip left, the rest right.
    body = (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2 lg:items-start lg:gap-10">
        <div className="grid gap-6 lg:col-start-2 lg:row-start-1">
          <TimerBar
            items={otherTimers}
            now={now}
            onJump={(index) => setStep(index)}
          />
          <Progress current={step + 1} total={total} />
        </div>
        {clipAction && (
          <StepClip
            key={clipAction}
            action={clipAction}
            className="lg:col-start-1 lg:row-span-2 lg:row-start-1"
          />
        )}
        <div className="grid gap-6 lg:col-start-2 lg:row-start-2">
          <p className="text-[26px] leading-snug lg:text-[32px] lg:leading-snug">{flowStep(current.text)}</p>
          {current.tempF !== undefined && (
            <p className="inline-flex min-h-12 w-fit items-center rounded-full border-2 border-line px-5 text-[18px] font-semibold tabular-nums">
              {current.tempF}°F
            </p>
          )}
          {current.timerSeconds !== undefined && (
            <StepTimer
              totalSeconds={current.timerSeconds}
              timer={timer}
              now={now}
              onStart={() => startStepTimer(current.timerSeconds ?? 0)}
              onDismiss={dismissStepTimer}
            />
          )}
          {step === total - 1 && feedButtons}
        </div>
      </div>
    );
    footer = (
      <>
        <Button fullWidth onClick={() => go(step + 1)}>
          {step === total - 1 ? "Finish" : "Next step"}
        </Button>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Button variant="ghost" size="md" onClick={() => go(step - 1)}>
            Back
          </Button>
          <Button variant="secondary" size="md" fullWidth disabled={offline} onClick={() => setAskOpen(true)}>
            {offline ? "Ask Mama · no signal" : "Ask Mama"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <div
      style={COOK_TOKENS}
      className="fixed inset-0 z-50 flex flex-col bg-paper text-ink"
    >
      <header className="flex flex-none items-center justify-between px-5 pb-1 pt-[max(12px,env(safe-area-inset-top))]">
        <Link href={`/recipe/${recipe.id}`} className="inline-flex min-h-12 items-center text-[18px] font-semibold text-muted">
          ← Recipe
        </Link>
        <p className="max-w-[60%] truncate text-[16px] text-muted">{recipe.title}</p>
      </header>
      {plateBars && <div className="flex-none grid gap-2 px-5 pb-2">{plateBars}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pb-8 pt-4 lg:max-w-5xl lg:px-8">{body}</div>
      </main>
      <footer className="flex-none border-t border-line bg-paper px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto grid max-w-3xl gap-3 lg:max-w-5xl">{footer}</div>
      </footer>
      {askOpen && current && (
        <AskMom
          recipe={recipe}
          stepIndex={step}
          stepText={current.text}
          allergies={state.profile.allergies}
          dislikes={state.profile.dislikes}
          onClose={() => setAskOpen(false)}
        />
      )}
    </div>
  );
}
