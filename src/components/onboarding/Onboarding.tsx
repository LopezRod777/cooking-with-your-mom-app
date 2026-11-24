"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/lib/useAppState";
import { saveState } from "@/lib/store";
import { Profile, type AppState, type Location } from "@/lib/schemas";
import { isComplete } from "@/lib/energy";
import { AUTOPLAN_KEY } from "@/components/week/autoplan";
import { PeopleEditor } from "@/components/people/PeopleEditor";
import { Button } from "../ui/Button";
import { Field, inputClass } from "../ui/Field";
import { ProgressSegments } from "../ui/Progress";
import { StickyNote } from "../ui/StickyNote";
import { LOCATION_ERROR, parseLocation } from "../location";
import {
  blankDraft,
  draftToProfile,
  hasMeal,
  summarize,
  type Draft,
} from "./draft";
import {
  AllergySection,
  BudgetSection,
  MealTimesSection,
  CuisineSection,
  DaysSection,
  DislikeSection,
  KitchenSection,
  PetsSection,
  DrinksSection,
  MealsSection,
  SkillSection,
  TimeSection,
} from "./sections";

const TOTAL_STEPS = 8;
const FINISH = TOTAL_STEPS + 1;

const CREAM = "text-[#fff6ea]";

// Keyed by step; "7b" is step 7 once pets are answered "No": the drinks question is what's left, so the photo
// becomes a lotería-style board of drink cards (original art, no brands).
const PHOTOS: Record<string, string> = {
  1: "/media/groceries.jpg",
  2: "/media/table-together.jpg",
  4: "/media/kitchen-hands.jpg",
  5: "/media/chicken-rice-bowl.jpg",
  6: "/media/kitchen-hands.jpg",
  7: "/media/pet-kitchen.jpg",
  "7b": "/media/loteria-drinks.jpg",
  8: "/media/chicken-rice-bowl.jpg",
  [FINISH]: "/media/hero.jpg",
};

const css = `
@keyframes ob-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes ob-fade { from { opacity: 0; } to { opacity: 1; } }
.ob-up { animation: ob-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.ob-fade { animation: ob-fade 240ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.ob-photo { transition: opacity 240ms ease; }
@media (prefers-reduced-motion: reduce) {
  .ob-up, .ob-fade { animation: none; }
  .ob-photo { transition: none; }
}
/* The onboarding owns the full screen: no app header over the photo. */
body header { display: none; }
`;

function Em({ children, tone = "saffron" }: { children: ReactNode; tone?: "saffron" | "tomato" }) {
  return <em className={`italic ${tone === "saffron" ? "text-saffron" : "text-tomato"}`}>{children}</em>;
}

function BackLink({ onClick, onPhoto }: { onClick: () => void; onPhoto: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-ml-2 inline-flex min-h-12 items-center gap-1.5 px-2 text-[18px] font-semibold ${
        onPhoto ? CREAM : "text-ink"
      }`}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      Back
    </button>
  );
}

// Rough time left: about 15 seconds a step, shown in whole minutes so it never promises precision.
function minutesLeft(step: number): string {
  const secs = (TOTAL_STEPS - Math.min(step, TOTAL_STEPS) + 1) * 15;
  return secs > 60 ? `about ${Math.ceil(secs / 60)} min` : "about 1 min";
}

function Counter({ step, onPhoto }: { step: number; onPhoto: boolean }) {
  return (
    <span
      className={`text-[16px] font-semibold uppercase tracking-[0.14em] ${onPhoto ? CREAM : "text-muted"}`}
    >
      {Math.min(step, TOTAL_STEPS)} / {TOTAL_STEPS}
      <span className="normal-case tracking-normal opacity-80"> · {minutesLeft(step)}</span>
    </span>
  );
}

function PhotoPanel({
  step,
  photoKey,
  onBack,
  headline,
  mom,
}: {
  step: number;
  photoKey: string;
  onBack: () => void;
  headline: ReactNode;
  mom?: string;
}) {
  return (
    <div className="relative isolate h-[42svh] min-h-[300px] overflow-hidden bg-[#1c140e] lg:sticky lg:top-0 lg:h-[100svh]">
      {Object.entries(PHOTOS).map(([k, src]) => (
        // Decorative photos: empty alt on purpose. All layers stay mounted so the swap crossfades.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={k}
          src={src}
          alt=""
          className="ob-photo absolute inset-0 -z-10 h-full w-full object-cover"
          style={{ opacity: k === photoKey ? 1 : 0 }}
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(28,20,14,0.82)_0%,rgba(28,20,14,0.3)_55%,rgba(28,20,14,0)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(to_bottom,rgba(28,20,14,0.45),rgba(28,20,14,0))]" />
      <div className="absolute inset-x-0 top-0 px-5 pt-[max(12px,env(safe-area-inset-top))] lg:px-10">
        <ProgressSegments current={step} total={TOTAL_STEPS} onDark />
        <div className="mt-2 flex items-center justify-between">
          <BackLink onClick={onBack} onPhoto />
          {step <= TOTAL_STEPS && <Counter step={step} onPhoto />}
        </div>
      </div>
      <div key={step} className="ob-fade absolute inset-x-0 bottom-0 grid gap-2 px-5 pb-6 lg:px-10 lg:pb-14">
        <h1 className={`text-[36px] leading-[1.06] sm:text-[38px] lg:max-w-[14ch] lg:text-[56px] ${CREAM}`}>
          {headline}
        </h1>
        {mom && (
          <p className={`font-[family-name:var(--font-hand)] text-[22px] leading-tight text-[#fff6ea]/90 lg:text-[26px]`}>
            {mom}
          </p>
        )}
      </div>
    </div>
  );
}

export function Onboarding() {
  const [state, setState, hydrated] = useAppState();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  // Returning with people already on the account (Settings → Start over keeps none, but a reload mid-setup does).
  const peopleSeeded = useRef(false);
  useEffect(() => {
    if (peopleSeeded.current || !hydrated || state.people.length === 0) return;
    peopleSeeded.current = true;
    setDraft((d) => ({ ...d, people: state.people }));
  }, [hydrated, state.people]);
  const [locText, setLocText] = useState("");
  const [locError, setLocError] = useState<string | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locHint, setLocHint] = useState<string | null>(null);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  function go(to: number) {
    setStep(to);
    window.scrollTo({ top: 0 });
  }

  function skipOnboarding() {
    // Like finish(): the drinks budget is set elsewhere, so the skip keeps whatever the profile already has.
    const next: AppState = {
      ...state,
      profile: {
        ...Profile.parse({ version: 1, onboarded: true }),
        drinksBudgetUsd: state.profile.drinksBudgetUsd,
        kitchen: state.profile.kitchen,
        mealDrinks: state.profile.mealDrinks,
      },
    };
    setState(next);
    saveState(next);
    router.push("/");
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    const profile = draftToProfile(draft, true);
    // A pet photo picked in step 7 is only staged on the server; commit it now so the Pets tab can show it.
    if (profile.petIntro && draft.petPhotoDraft !== null) {
      try {
        const res = await fetch("/api/pets/photo/commit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ petId: profile.petIntro.id }),
        });
        if (res.ok) {
          const data = (await res.json()) as { key: string; updatedAt: string };
          profile.petIntro = { ...profile.petIntro, photo: { key: data.key, updatedAt: data.updatedAt } };
        }
      } catch {
        // The card still saves without the photo; it can be added in Pets.
      }
    }
    const next: AppState = {
      ...state,
      // The kitchen keeps the existing value when the draft has none. The drinks budget comes from step 7 when
      // pairings were wanted; otherwise whatever the profile already had stays.
      profile: {
        ...profile,
        drinksBudgetUsd: profile.drinkPairings === true ? profile.drinksBudgetUsd : state.profile.drinksBudgetUsd,
        kitchen: draft.kitchen ?? state.profile.kitchen,
        mealDrinks: state.profile.mealDrinks,
      },
      location: location ?? state.location,
      people: draft.people,
    };
    // Write now, before navigating: the shell re-reads storage on navigation.
    setState(next);
    saveState(next);
    // Mama starts the first plan herself on the Week tab (one-shot flag; see WeekPage).
    try {
      window.sessionStorage.setItem(AUTOPLAN_KEY, "1");
    } catch {
      // Without storage the Week tab simply shows "Plan my week".
    }
    router.push("/");
  }

  // Step 1: the browser's position → nearest ZIP (server, local table) → the field, so the usual Continue applies.
  function useMyLocation() {
    if (locating) return;
    if (!("geolocation" in navigator)) {
      setLocError("Your browser can't share a location. Type your ZIP.");
      return;
    }
    setLocating(true);
    setLocError(null);
    setLocHint(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/geocode", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
          const data = (await res.json().catch(() => null)) as { status?: string; zip?: string; approx?: boolean } | null;
          if (res.ok && data?.status === "ok" && data.zip) {
            setLocText(data.zip);
            setLocHint(data.approx ? `Closest guess: ${data.zip}. Fix it if it's off.` : `Found ${data.zip}. Fix it if it's off.`);
          } else setLocError("Couldn't match a ZIP. Type it in.");
        } catch {
          setLocError("Couldn't match a ZIP. Type it in.");
        } finally {
          setLocating(false);
        }
      },
      async (err) => {
        // Browser said no (1 denied, 2 unavailable, 3 timeout). Try the connection-based guess before giving up.
        try {
          const res = await fetch("/api/geocode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ip: true }) });
          const data = (await res.json().catch(() => null)) as { status?: string; city?: string; region?: string } | null;
          if (res.ok && data?.status === "ok" && data.city && data.region) {
            // City-level only: connection location never fills the ZIP field.
            setLocHint(`Looks like you're around ${data.city}, ${data.region}. Type your ZIP so Mama gets the right stores.`);
            return;
          }
        } catch {
          // Fall through to the message.
        } finally {
          setLocating(false);
        }
        // 1 = permission denied, 2 = position unavailable, 3 = timeout. Say what to do, not just that it failed.
        setLocError(
          err.code === 1
            ? "Your browser kept your location private. Allow it for this site, or type your ZIP."
            : err.code === 2
              ? "Your device can't place you right now. Type your ZIP."
              : "That took too long. Type your ZIP.",
        );
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  // Step 7 is the only required step that can be left for later: pets and drinks stay unanswered and Settings asks again.
  function skipForNow() {
    patch({ hasPets: null, cookForPets: null, petIntro: null, petPhotoDraft: null, drinkPairings: null, drinksBudgetUsd: null });
    go(step + 1);
  }

  function continueFrom() {
    if (step === 1) {
      const parsed = parseLocation(locText);
      if (!parsed) {
        setLocError(LOCATION_ERROR);
        return;
      }
      setLocation(parsed);
    }
    go(step + 1);
  }

  // Under 21 on the first card: pairings are not offered, the answer is "No" without asking.
  const firstAge = draft.people[0]?.age ?? null;
  const under21 = firstAge !== null && firstAge < 21;
  useEffect(() => {
    if (step === 7 && under21 && draft.drinkPairings !== false) patch({ drinkPairings: false, drinksBudgetUsd: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, under21]);
  const canContinue =
    step === 1
      ? locText.trim().length > 0
      : step === 2
        ? draft.people.length > 0 && draft.people.every(isComplete)
        : step === 5
          ? draft.maxMinutesPerMeal !== null && draft.daysToPlan !== null && hasMeal(draft)
          : step === 7
            ? draft.hasPets !== null &&
              (draft.hasPets === false || draft.cookForPets !== null) &&
              draft.drinkPairings !== null &&
              (draft.drinkPairings === false || draft.drinksBudgetUsd !== null)
            : step === 8
              ? draft.weeklyBudgetUsd !== null && draft.skill !== null
              : true;

  const cta =
    step < FINISH ? (
      <div className="grid gap-2">
        <Button size="xl" fullWidth disabled={!canContinue} onClick={continueFrom}>
          Continue
        </Button>
        {step === 7 && draft.hasPets === null && draft.drinkPairings === null && (
          <button
            type="button"
            onClick={skipForNow}
            className="min-h-12 justify-self-center px-4 text-[17px] font-semibold text-muted underline underline-offset-4"
          >
            Skip for now
          </button>
        )}
      </div>
    ) : (
      <Button size="xl" fullWidth disabled={finishing} onClick={() => void finish()}>
        Plan my week
      </Button>
    );

  const footer = (
    <div className="sticky bottom-0 -mx-5 mt-auto bg-gradient-to-t from-paper from-70% to-transparent px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 lg:static lg:mx-0 lg:w-full lg:max-w-[560px] lg:bg-none lg:px-0 lg:pb-0 lg:pt-4">
      {cta}
    </div>
  );

  if (step === 0) {
    return (
      <section className="relative isolate flex min-h-[100svh] flex-1 flex-col justify-end overflow-hidden text-[#fff6ea]">
        <style>{css}</style>
        {/* Decorative photo: alt text is empty on purpose. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/media/hero.jpg"
          alt=""
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgba(28,20,14,0.9)_0%,rgba(28,20,14,0.6)_45%,rgba(28,20,14,0.15)_100%)]" />
        {/* Dark band behind the brand line, so it reads on any photo (phone and desktop). */}
        <div className="absolute inset-x-0 top-0 -z-10 h-36 bg-[linear-gradient(to_bottom,rgba(28,20,14,0.7),rgba(28,20,14,0))]" />
        <p className="absolute left-5 top-[max(20px,env(safe-area-inset-top))] font-[family-name:var(--font-display)] text-[24px] text-[#fff6ea] [text-shadow:0_1px_2px_rgba(0,0,0,0.6),0_0_18px_rgba(0,0,0,0.45)] lg:left-10 lg:text-[28px]">
          Cooking with your Mom
        </p>
        <div className="ob-up mx-auto grid w-full max-w-xl gap-6 px-5 pb-10 pt-28">
          <h1 className="text-[52px] leading-[1.02] sm:text-[64px]">
            Dinner&apos;s <Em>handled</Em>, honey.
          </h1>
          <StickyNote signed>
            Eat your protein. And don&apos;t pay more for chicken than you have to.
          </StickyNote>
          <Button size="xl" fullWidth onClick={() => go(1)}>
            Let&apos;s set you up
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="justify-self-center border-[#fff6ea]/50! bg-transparent! text-[#fff6ea]!"
            onClick={skipOnboarding}
          >
            I&apos;ve done this before
          </Button>
        </div>
      </section>
    );
  }

  // Step 3: the cuisine grid is the imagery, so the header sits on paper.
  if (step === 3) {
    return (
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[1100px] flex-1 flex-col px-5 lg:px-10">
        <style>{css}</style>
        <div className="pt-[max(12px,env(safe-area-inset-top))]">
          <ProgressSegments current={step} total={TOTAL_STEPS} />
          <div className="mt-2 flex items-center justify-between">
            <BackLink onClick={() => go(2)} onPhoto={false} />
            <Counter step={step} onPhoto={false} />
          </div>
        </div>
        <div key={step} className="ob-up flex flex-1 flex-col gap-6 pt-3">
          <h1 className="text-[38px] leading-[1.06] text-ink lg:text-[52px]">
            What do you <Em tone="tomato">love</Em> to eat?
          </h1>
          <CuisineSection draft={draft} patch={patch} hideQuestion />
          {footer}
        </div>
      </div>
    );
  }

  const headline: Record<number, ReactNode> = {
    1: (
      <>
        Where are you <Em>cooking</Em> this week?
      </>
    ),
    2: (
      <>
        Who&apos;s <Em>eating</Em>?
      </>
    ),
    4: (
      <>
        Anything we <Em>must</Em> avoid?
      </>
    ),
    5: (
      <>
        How much <Em>time</Em> per meal?
      </>
    ),
    6: (
      <>
        What do you <Em>cook</Em> with?
      </>
    ),
    7: (
      <>
        Two <Em>quick</Em> ones.
      </>
    ),
    8: (
      <>
        How much to <Em>spend</Em> this week?
      </>
    ),
    [FINISH]: (
      <>
        All set, <Em>honey.</Em>
      </>
    ),
  };
  const mom: Record<number, string> = {
    1: "So Mama knows which stores are near you.",
    2: "So nobody leaves the table hungry. Skip the details if you'd rather not; nobody else sees them.",
    4: "Allergies are hard rules, honey.",
    5: "Be honest. I won't judge. Then tell me which meals and how many days.",
    6: "Tell Mama what you've got. She'll cook with that.",
    7: "Yes or no is enough. Details only if you say yes.",
    8: "Be honest. I won't judge.",
  };

  return (
    <div className="flex min-h-[100svh] flex-1 flex-col lg:grid lg:grid-cols-2">
      <style>{css}</style>
      <PhotoPanel step={step} photoKey={step === 7 && draft.hasPets === false && !under21 ? "7b" : String(step)} onBack={() => go(step - 1)} headline={headline[step]} mom={mom[step]} />
      <div className="flex flex-1 flex-col lg:min-h-[100svh] lg:items-center lg:justify-center lg:py-14">
        <div key={step} className="ob-up flex w-full max-w-[560px] flex-1 flex-col gap-8 px-5 pt-8 lg:flex-none lg:px-0 lg:pt-0">
          {step === 1 && (
            <Field
              label="What ZIP code or city are you in?"
              hand
              error={locError}
            >
              {(id, describedBy) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={locError ? true : undefined}
                  className={inputClass}
                  value={locText}
                  autoComplete="postal-code"
                  onChange={(e) => {
                    setLocText(e.target.value);
                    if (locError) setLocError(null);
                    if (locHint) setLocHint(null);
                  }}
                />
              )}
            </Field>
          )}
          {step === 1 && (
            <div className="grid gap-3">
              <Button variant="ghost" size="md" className="justify-self-start" disabled={locating} onClick={useMyLocation}>
                {locating ? "Finding you…" : "Use my location"}
              </Button>
              {locHint && (
                <p role="status" className="text-[16px] leading-snug text-muted">
                  {locHint}
                </p>
              )}
            </div>
          )}

          {step === 2 && <PeopleEditor people={draft.people} onChange={(people) => patch({ people })} />}

          {step === 4 && (
            <>
              <AllergySection draft={draft} patch={patch} />
              <DislikeSection draft={draft} patch={patch} />
            </>
          )}

          {step === 5 && (
            <>
              <TimeSection draft={draft} patch={patch} />
              <DaysSection draft={draft} patch={patch} />
              <MealsSection draft={draft} patch={patch} />
            </>
          )}

          {step === 6 && <KitchenSection draft={draft} patch={patch} />}

          {step === 7 && (
            <>
              <PetsSection draft={draft} patch={patch} intro />
              {!under21 && <DrinksSection draft={draft} patch={patch} withBudget />}
            </>
          )}

          {step === 8 && (
            <>
              <BudgetSection draft={draft} patch={patch} />
              <MealTimesSection draft={draft} patch={patch} />
              <SkillSection draft={draft} patch={patch} />
            </>
          )}

          {step === FINISH && (
            <>
              <div className="grid gap-3 text-[20px] leading-snug text-ink">
                {summarize(draft, location?.label ?? state.location?.label ?? "your area").map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <StickyNote signed>Perfect. Give me a minute to plan your week.</StickyNote>
            </>
          )}

          {footer}
        </div>
      </div>
    </div>
  );
}
