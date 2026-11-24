"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DEFAULT_KITCHEN, DIETS, GOALS, type MealTimes, type SnackTime } from "@/lib/schemas";
import { SNACK_TIME_LABELS } from "@/lib/mealTimes";
import { KitchenTiles } from "@/components/kitchen/KitchenTiles";
import { ChoiceTile } from "../ui/Choice";
import { Stepper } from "../ui/Stepper";
import { Button } from "../ui/Button";
import { Field, inputClass } from "../ui/Field";
import {
  ALLERGY_OPTIONS,
  CUISINES,
  DISLIKE_OPTIONS,
  SLOT_LABELS,
  customTerms,
  groupSelected,
  toggleGroup,
  type AvoidOption,
  type Draft,
} from "./draft";
import { PetIntroFields, newPetId } from "./PetIntroFields";

type Patch = (p: Partial<Draft>) => void;

// A block that appears after a Yes sits under the sticky Continue bar on a phone, so nothing says "there is more".
// Scroll it to the middle of the screen the moment it mounts.
function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, []);
  return (
    <div ref={ref} className="grid gap-8">
      {children}
    </div>
  );
}

function Group({
  question,
  helper,
  hideQuestion = false,
  children,
}: {
  question: string;
  helper?: string;
  hideQuestion?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className={`mb-1 font-hand text-[30px] font-semibold leading-[1.05] text-ink${hideQuestion ? " sr-only" : ""}`}>{question}</legend>
      {helper && <p className="-mt-1.5 mb-1 text-[16px] leading-snug text-muted">{helper}</p>}
      {children}
    </fieldset>
  );
}

function Tiles({ cols, children }: { cols: 2 | 3 | 4; children: ReactNode }) {
  const c = cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-4";
  return <div className={`grid gap-2.5 ${c}`}>{children}</div>;
}

export function ProteinSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group
      question="How much protein do you want each day?"
      helper="Most plans land at 100 to 160 g a day."
    >
      <Stepper
        label="grams of protein per day"
        value={draft.proteinTargetG}
        min={60}
        max={250}
        step={10}
        suffix="g"
        onChange={(n) => patch({ proteinTargetG: n })}
      />
    </Group>
  );
}

export function DaysSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="How many days should I plan?">
      <Tiles cols={3}>
        {([3, 5, 7] as const).map((n) => (
          <ChoiceTile
            key={n}
            compact
            selected={draft.daysToPlan === n}
            onClick={() => patch({ daysToPlan: n })}
          >
            {n} days
          </ChoiceTile>
        ))}
      </Tiles>
    </Group>
  );
}

export function MealsSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="Which meals?">
      <Tiles cols={2}>
        {SLOT_LABELS.map(([key, label]) => (
          <ChoiceTile
            key={key}
            selected={draft.slots[key]}
            onClick={() => patch({ slots: { ...draft.slots, [key]: !draft.slots[key] } })}
          >
            {label}
          </ChoiceTile>
        ))}
      </Tiles>
    </Group>
  );
}

export function ServingsSection({ draft, patch, helper }: { draft: Draft; patch: Patch; helper?: string }) {
  return (
    <Group question="How many people are you cooking for?" helper={helper}>
      <Stepper
        label="people"
        value={draft.servingsPerMeal}
        min={1}
        max={6}
        onChange={(n) => patch({ servingsPerMeal: n })}
      />
    </Group>
  );
}

function CuisineTile({
  name,
  selected,
  onToggle,
}: {
  name: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={[
        "group relative aspect-[4/3] w-full select-none overflow-hidden rounded-[20px] bg-saffron-soft text-left transition duration-[120ms] active:scale-[0.98]",
        selected ? "ring-[3px] ring-saffron" : "",
      ].join(" ")}
    >
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/media/cuisines/${name.toLowerCase()}.jpg`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition duration-200"
          style={{ filter: selected ? "none" : "saturate(0.85)" }}
        />
      )}
      {!failed && (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_top,rgba(28,20,14,0.78),rgba(28,20,14,0)_62%)]"
        />
      )}
      <span
        className={[
          "absolute bottom-3 left-3.5 right-3 text-[20px] font-semibold leading-tight",
          failed ? "text-note-ink" : "text-[#fff6ea]",
        ].join(" ")}
      >
        {name}
      </span>
      {selected && (
        <span
          aria-hidden="true"
          className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-tomato text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      )}
    </button>
  );
}

export function CuisineSection({
  draft,
  patch,
  hideQuestion = false,
}: {
  draft: Draft;
  patch: Patch;
  hideQuestion?: boolean;
}) {
  const toggle = (c: string) =>
    patch({
      cuisines: draft.cuisines.includes(c)
        ? draft.cuisines.filter((x) => x !== c)
        : [...draft.cuisines, c],
    });
  return (
    <Group question="What do you love to eat?" hideQuestion={hideQuestion}>
      <div className="grid grid-cols-2 gap-3 p-[3px] md:grid-cols-3 min-[1200px]:grid-cols-5">
        {CUISINES.map((c) => (
          <CuisineTile key={c} name={c} selected={draft.cuisines.includes(c)} onToggle={() => toggle(c)} />
        ))}
      </div>
    </Group>
  );
}

function AvoidGroup({
  question,
  helper,
  options,
  list,
  tone,
  onChange,
}: {
  question: string;
  helper?: string;
  tone: "ink" | "tomato";
  options: AvoidOption[];
  list: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState("");
  const extras = customTerms(options, list);

  function add() {
    const term = text.trim().toLowerCase();
    setText("");
    if (!term || list.includes(term)) return;
    onChange([...list, term]);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  }

  return (
    <Group question={question} helper={helper}>
      <Tiles cols={2}>
        {options.map((o) => (
          <ChoiceTile
            key={o.label}
            tone={tone}
            selected={groupSelected(o.terms, list)}
            onClick={() => onChange(toggleGroup(o.terms, list))}
          >
            {o.label}
          </ChoiceTile>
        ))}
        {extras.map((t) => (
          <ChoiceTile
            key={t}
            tone={tone}
            selected
            aria-label={`Remove ${t}`}
            onClick={() => onChange(list.filter((x) => x !== t))}
          >
            {t} ×
          </ChoiceTile>
        ))}
      </Tiles>
      <Field label="Something else?" helper="Type it and press Enter.">
        {(id, describedBy) => (
          <div className="flex gap-3">
            <input
              id={id}
              aria-describedby={describedBy}
              className={inputClass}
              value={text}
              placeholder=""
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
            <Button variant="ghost" size="md" className="h-16 flex-none rounded-[18px] px-6" onClick={add}>
              Add
            </Button>
          </div>
        )}
      </Field>
    </Group>
  );
}

export function GoalSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="What's the goal right now?">
      <Tiles cols={2}>
        {GOALS.filter((g) => g.id !== "grow").map((g) => (
          <ChoiceTile key={g.id} selected={draft.goal === g.id} onClick={() => patch({ goal: g.id })}>
            {g.label}
          </ChoiceTile>
        ))}
      </Tiles>
    </Group>
  );
}

export function DietSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="Any diet Mama should respect?">
      <Tiles cols={2}>
        {DIETS.map((d) => (
          <ChoiceTile key={d.id} selected={draft.diet === d.id} onClick={() => patch({ diet: d.id })}>
            {d.label}
          </ChoiceTile>
        ))}
      </Tiles>
    </Group>
  );
}

export function AllergySection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <AvoidGroup
      question="Allergies"
      tone="tomato"
      options={ALLERGY_OPTIONS}
      list={draft.allergies}
      onChange={(allergies) => patch({ allergies })}
    />
  );
}

export function DislikeSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <AvoidGroup
      question="Rather not?"
      tone="ink"
      options={DISLIKE_OPTIONS}
      list={draft.dislikes}
      onChange={(dislikes) => patch({ dislikes })}
    />
  );
}

export function TimeSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="How long can a meal take?">
      <Tiles cols={2}>
        {[15, 30, 45, 60].map((m) => (
          <ChoiceTile
            key={m}
            selected={draft.maxMinutesPerMeal === m}
            onClick={() => patch({ maxMinutesPerMeal: m })}
          >
            {m} min
          </ChoiceTile>
        ))}
      </Tiles>
    </Group>
  );
}

export function BudgetSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  const current = draft.weeklyBudgetUsd ?? 150;
  // The $150 shown is the answer until changed (the owner, 2026-11-03), so Continue is live on arrival; + / − and the
  // tiles adjust it.
  const persisted = useRef(false);
  useEffect(() => {
    if (persisted.current || draft.weeklyBudgetUsd !== null) return;
    persisted.current = true;
    patch({ weeklyBudgetUsd: 150 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Group question="Weekly grocery budget?">
      <Tiles cols={3}>
        {[50, 75, 100, 150, 200].map((b) => (
          <ChoiceTile
            key={b}
            compact
            selected={draft.weeklyBudgetUsd === b}
            onClick={() => patch({ weeklyBudgetUsd: b })}
          >
            ${b}
          </ChoiceTile>
        ))}
      </Tiles>
      <p className="mt-2 text-[16px] leading-snug text-muted">Or a different amount?</p>
      <Stepper
        label="weekly budget in dollars"
        value={current}
        min={20}
        max={400}
        step={5}
        prefix="$"
        onChange={(n) => patch({ weeklyBudgetUsd: n })}
      />
    </Group>
  );
}

const MEAL_ROWS: { key: "breakfast" | "lunch" | "dinner"; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

// iOS-style switch: 44px hit area, 44×26 track, 22px knob.
function SlotSwitch({ on, label, testId, onToggle }: { on: boolean; label: string; testId: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} on`}
      data-testid={testId}
      onClick={onToggle}
      className="flex h-12 w-12 flex-none items-center justify-center"
    >
      <span className={`relative block h-[26px] w-[44px] rounded-full ${on ? "bg-saffron" : "bg-line"}`}>
        <span
          className={`absolute left-[2px] top-[2px] block h-[22px] w-[22px] rounded-full bg-white shadow transition-transform duration-150 ${on ? "translate-x-[18px]" : ""}`}
        />
      </span>
    </button>
  );
}

// When they eat. Defaults stand until changed, so this never blocks Continue. A meal that is off has no clock.
// The snack is placed by moment, and only shows its moments while it is on.
export function MealTimesSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  const t = draft.mealTimes;
  const set = (next: Partial<MealTimes>) => patch({ mealTimes: { ...t, ...next } });
  const toggleSlot = (key: "breakfast" | "lunch" | "dinner" | "snack") =>
    patch({ slots: { ...draft.slots, [key]: !draft.slots[key] } });
  const rowClass = "flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-white px-4 py-2";
  return (
    <Group question="When do you usually eat?">
      <div className="grid gap-2">
        {MEAL_ROWS.map(({ key, label }) => {
          const on = draft.slots[key];
          return (
            <div key={key} className={rowClass}>
              <SlotSwitch on={on} label={label} testId={`meal-on-${key}`} onToggle={() => toggleSlot(key)} />
              <span className={`flex-1 text-[17px] font-semibold ${on ? "text-ink" : "text-muted"}`}>{label}</span>
              {on ? (
                <input
                  type="time"
                  value={t[key]}
                  step={900}
                  aria-label={`${label} time`}
                  data-testid={`meal-time-${key}`}
                  onChange={(e) => {
                    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) set({ [key]: e.target.value } as Partial<MealTimes>);
                  }}
                  className="min-h-12 rounded-xl border border-line bg-paper px-3 text-[17px] text-ink"
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {draft.slots.snack && (
        <>
          <p className="mt-3 text-[16px] leading-snug text-muted">And the snack?</p>
          <Tiles cols={2}>
            {(Object.keys(SNACK_TIME_LABELS) as SnackTime[]).map((k) => (
              <ChoiceTile key={k} compact selected={t.snack === k} onClick={() => set({ snack: k })}>
                {SNACK_TIME_LABELS[k]}
              </ChoiceTile>
            ))}
          </Tiles>
        </>
      )}
    </Group>
  );
}

export function SkillSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="How comfortable are you in the kitchen?">
      <Tiles cols={2}>
        <ChoiceTile selected={draft.skill === "beginner"} onClick={() => patch({ skill: "beginner" })}>
          Still learning
        </ChoiceTile>
        <ChoiceTile selected={draft.skill === "comfortable"} onClick={() => patch({ skill: "comfortable" })}>
          I manage
        </ChoiceTile>
      </Tiles>
    </Group>
  );
}

// Onboarding passes `intro` so the first pet's card shows under "Cook for your pet too?"; Settings leaves it out
// (pets are managed in the Pets tab).
export function PetsSection({ draft, patch, intro = false }: { draft: Draft; patch: Patch; intro?: boolean }) {
  return (
    <>
      <Group question="Any pets at home?">
        <Tiles cols={2}>
          <ChoiceTile selected={draft.hasPets === true} onClick={() => patch({ hasPets: true })}>
            Yes
          </ChoiceTile>
          <ChoiceTile selected={draft.hasPets === false} onClick={() => patch({ hasPets: false })}>
            No
          </ChoiceTile>
        </Tiles>
      </Group>
      {draft.hasPets === true && (
        <Reveal>
          <Group
            question="Cook for your pet too?"
            helper="Adds a Pets tab: plain plates, sized for them."
          >
            <Tiles cols={2}>
              <ChoiceTile
                selected={draft.cookForPets === true}
                onClick={() => patch({ cookForPets: true, petIntro: draft.petIntro ?? { id: newPetId() } })}
              >
                Yes
              </ChoiceTile>
              <ChoiceTile selected={draft.cookForPets === false} onClick={() => patch({ cookForPets: false })}>
                No
              </ChoiceTile>
            </Tiles>
          </Group>
        </Reveal>
      )}
      {intro && draft.hasPets === true && draft.cookForPets === true && draft.petIntro && (
        <Reveal>
          <Group question="Tell Mama about them">
            <PetIntroFields
              intro={draft.petIntro}
              photoDraft={draft.petPhotoDraft}
              onChange={(petIntro) => patch({ petIntro })}
              onPhotoDraft={(petPhotoDraft) => patch({ petPhotoDraft })}
            />
          </Group>
        </Reveal>
      )}
    </>
  );
}

// Starts low on purpose (the owner, 2026-11-03): $15 is the default, the tiles and + / − go up from there.
const DRINK_BUDGETS = [15, 25, 50, 100, 150];

// `withBudget` asks the weekly drinks budget right under "Yes" (onboarding). Settings has its own budget field.
export function DrinksSection({ draft, patch, withBudget = false }: { draft: Draft; patch: Patch; withBudget?: boolean }) {
  const current = draft.drinksBudgetUsd ?? 15;
  // The age on the first card already answers the 21+ part; the tile only repeats it when the age was skipped.
  const firstAge = draft.people?.[0]?.age ?? null;
  const knownAdult = firstAge !== null && firstAge >= 21;
  return (
    <>
      <Group
        question="Drink pairings with your meals?"
        helper="Wine, beer or a cocktail that fits the dish."
      >
        <Tiles cols={2}>
          <ChoiceTile
            selected={draft.drinkPairings === true}
            // Onboarding: the $15 shown under "Yes" counts as the budget until changed.
            onClick={() => patch({ drinkPairings: true, ...(withBudget && draft.drinksBudgetUsd === null ? { drinksBudgetUsd: 15 } : {}) })}
          >
            {knownAdult ? "Yes" : "Yes, I\u2019m 21+"}
          </ChoiceTile>
          <ChoiceTile selected={draft.drinkPairings === false} onClick={() => patch({ drinkPairings: false })}>
            No
          </ChoiceTile>
        </Tiles>
      </Group>
      {withBudget && draft.drinkPairings === true && (
        <Reveal>
        <Group question="How much for drinks a week?" helper="Apart from groceries.">
          <Tiles cols={3}>
            {DRINK_BUDGETS.map((b) => (
              <ChoiceTile
                key={b}
                compact
                selected={draft.drinksBudgetUsd === b}
                onClick={() => patch({ drinksBudgetUsd: b })}
              >
                ${b}
              </ChoiceTile>
            ))}
          </Tiles>
          <p className="mt-2 text-[16px] leading-snug text-muted">Or a different amount?</p>
          <Stepper
            label="weekly drinks budget in dollars"
            value={current}
            min={0}
            max={300}
            step={5}
            prefix="$"
            onChange={(n) => patch({ drinksBudgetUsd: n })}
          />
        </Group>
        </Reveal>
      )}
    </>
  );
}

export function MealDrinksSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <Group question="Should Mama suggest a drink with your meals?" helper="Homemade, no alcohol. Adds its ingredients to your list.">
      <Tiles cols={2}>
        <ChoiceTile selected={draft.mealDrinks} onClick={() => patch({ mealDrinks: true })}>
          Yes
        </ChoiceTile>
        <ChoiceTile selected={!draft.mealDrinks} onClick={() => patch({ mealDrinks: false })}>
          No
        </ChoiceTile>
      </Tiles>
    </Group>
  );
}

export function KitchenSection({ draft, patch }: { draft: Draft; patch: Patch }) {
  // Persist the default selection once, so a student who taps Next without changes still has a kitchen saved.
  const persisted = useRef(false);
  useEffect(() => {
    if (persisted.current || draft.kitchen !== null) return;
    persisted.current = true;
    patch({ kitchen: DEFAULT_KITCHEN });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Group question="What's in your kitchen?">
      <KitchenTiles value={draft.kitchen ?? DEFAULT_KITCHEN} onChange={(kitchen) => patch({ kitchen })} />
    </Group>
  );
}
