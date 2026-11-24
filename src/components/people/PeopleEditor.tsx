"use client";

import { useEffect, useId, useState } from "react";
import { SPORTS, SPORT_ORDER, cmFromFtIn, estimateFor, ftInFromCm, isComplete, kgFromLb, lbFromKg } from "@/lib/energy";
import { blankPerson } from "@/lib/people";
import { GOALS, isChild, isMinor, type Person, type SportId } from "@/lib/schemas";
import { ChoiceTile } from "@/components/ui/Choice";
import { Field, inputClass } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";

const MAX_PEOPLE = 6;
const newId = () => `p${Math.random().toString(36).slice(2, 8)}`;
const smallInput = `${inputClass} h-14 px-4 text-[20px]`;
const RELATIONS = [["partner", "Partner"], ["child", "Kid"], ["friend", "Friend"], ["roommate", "Roommate"], ["parent", "Parent"], ["other", "Someone else"]] as const;
const ACTIVITY = [["sedentary", "Mostly indoors"], ["moderate", "Runs around"], ["active", "Always moving"]] as const;

// Who's eating, one card per person: name, sex, age, height, weight, training (and sport, days, minutes when
// regular), goal. Mama turns this into a daily kcal and protein estimate per person and sizes their plate from it.
// Used by onboarding step 2 and by Settings; `onChange` receives the whole list every time.
export function PeopleEditor({ people, onChange, showEstimates = true, allowClear = false }: { people: Person[]; onChange: (people: Person[]) => void; showEstimates?: boolean; allowClear?: boolean }) {
  const update = (id: string, patch: Partial<Person>) => onChange(people.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  // "− 1 +": plus opens a card for the next person, minus drops the last one. No text button (the owner, 2026-11-03).
  const setCount = (n: number) => {
    if (n > people.length) {
      const first = people[0]?.goal;
      const goal = first && first !== "grow" ? first : ("eat_well" as const);
      const extra = Array.from({ length: n - people.length }, () => ({ ...blankPerson(newId()), goal }));
      onChange([...people, ...extra]);
    } else if (n < people.length) {
      onChange(people.slice(0, Math.max(n, allowClear ? 0 : 1)));
    }
  };
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p className="text-[18px] font-semibold">How many at the table?</p>
        <Stepper label="people" value={people.length} min={allowClear ? 0 : 1} max={MAX_PEOPLE} onChange={setCount} />
      </div>
      <ul className="grid gap-5">
        {people.map((person, i) => (
          <li key={person.id}>
            <PersonCard
              person={person}
              index={i}
              canRemove={i > 0 || (allowClear && people.length === 1)}
              showEstimate={showEstimates}
              onChange={(patch) => update(person.id, patch)}
              onRemove={() => onChange(people.filter((p) => p.id !== person.id))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Whole numbers only (age, feet, inches, pounds, days, minutes). Out-of-range text stays visible but reports null,
// so the card is not complete until it is fixed. An external change to `value` (server refresh, conflict resolved
// with "theirs") replaces the text.
function NumberInput({ id, describedBy, value, onChange, min, max, suffix }: { id: string; describedBy?: string; value: number | null; onChange: (n: number | null) => void; min: number; max: number; suffix: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const shown = text === "" ? null : Number(text);
    if (value !== shown && !(value === null && (shown === null || shown < min || shown > max))) setText(value === null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const invalid = text !== "" && (Number(text) < min || Number(text) > max);
  return (
    <div className="relative">
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        inputMode="numeric"
        pattern="[0-9]*"
        className={`${smallInput} pr-12 ${invalid ? "border-tomato" : ""}`}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, "").slice(0, 3);
          setText(t);
          const n = Number(t);
          onChange(t !== "" && n >= min && n <= max ? n : null);
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-muted">{suffix}</span>
    </div>
  );
}

function PersonCard({ person, index, canRemove, showEstimate, onChange, onRemove }: { person: Person; index: number; canRemove: boolean; showEstimate: boolean; onChange: (patch: Partial<Person>) => void; onRemove: () => void }) {
  const label = person.name.trim() || `Person ${index + 1}`;
  const ftIn = person.heightCm === null ? { ft: null as number | null, in: null as number | null } : ftInFromCm(person.heightCm);
  const [ft, setFt] = useState<number | null>(ftIn.ft);
  const [inch, setInch] = useState<number | null>(ftIn.in);
  const setHeight = (f: number | null, i: number | null) => {
    setFt(f);
    setInch(i);
    // 7 ft 7 in and up is over the schema's 230 cm; report null so the card stays incomplete.
    const cm = f === null ? null : cmFromFtIn(f, i ?? 0);
    onChange({ heightCm: cm !== null && cm <= 230 ? cm : null });
  };
  const est = estimateFor(person);
  // The inches box has no visible heading (the owner: the bold "and" read like a label); screen readers still get "Inches".
  const inchId = useId();
  const complete = isComplete(person);
  // Under 16: Age and "Active?" only (energy comes from the age table, no weight or height).
  const child = isMinor(person);
  const minor = isMinor(person);
  const young = isChild(person);
  // Under 16 the goal list is only "Eat to grow" and "Just eat well"; a goal that falls outside it moves to the default.
  const goals = minor ? GOALS.filter((g) => g.id === "grow" || g.id === "eat_well") : GOALS.filter((g) => g.id !== "grow");
  const setAge = (n: number | null) => {
    if (n === null) return onChange({ age: null });
    // A kid's default is "Eat to grow"; the parent can still pick "Just eat well".
    if (isMinor({ age: n }) && !isMinor(person)) return onChange({ age: n, goal: "grow" });
    if (!isMinor({ age: n }) && person.goal === "grow") return onChange({ age: n, goal: "eat_well" });
    onChange({ age: n });
  };
  return (
    <div data-testid="person-card" className="grid gap-5 rounded-[22px] border border-line bg-panel p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Name">
          {(id, describedBy) => (
            <input id={id} aria-describedby={describedBy} className={smallInput} value={person.name} maxLength={24} autoComplete="off" onChange={(e) => onChange({ name: e.target.value })} />
          )}
        </Field>
        {canRemove && (
          <Button variant="ghost" size="md" onClick={onRemove} aria-label={`Remove ${label}`}>
            Remove
          </Button>
        )}
      </div>

      {index > 0 && (
        // Card 0 is the person signed in; "Who is this?" only makes sense for everyone else.
        <div role="group" aria-label={`Who is this, ${label}`} className="grid gap-2">
          <p className="text-[18px] font-semibold">Who is this?</p>
          <div className="grid grid-cols-3 gap-2">
            {RELATIONS.map(([value, text]) => (
              <ChoiceTile key={value} compact selected={person.relation === value} onClick={() => onChange({ relation: value })}>
                {text}
              </ChoiceTile>
            ))}
          </div>
        </div>
      )}

      <div role="group" aria-label={`Sex, ${label}`} className="grid gap-2">
        <p className="text-[18px] font-semibold">Sex</p>
        <div className="grid grid-cols-3 gap-2">
          <ChoiceTile compact selected={person.sex === "woman"} onClick={() => onChange({ sex: "woman" })}>{minor ? "Girl" : "Woman"}</ChoiceTile>
          <ChoiceTile compact selected={person.sex === "man"} onClick={() => onChange({ sex: "man" })}>{minor ? "Boy" : "Man"}</ChoiceTile>
          <ChoiceTile compact selected={person.sex === "unspecified"} onClick={() => onChange({ sex: "unspecified" })}>Rather not say</ChoiceTile>
        </div>
      </div>

      {person.sex === "unspecified" ? (
        <p className="text-[17px] leading-snug text-muted">No numbers, then: {label} gets a regular plate and Mama plans the week the same way. Details can be added any time in Settings.</p>
      ) : (
        <>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Age">{(id, d) => <NumberInput id={id} describedBy={d} value={person.age} onChange={setAge} min={2} max={100} suffix="yr" />}</Field>
        {!child && <Field label="Weight">{(id, d) => <NumberInput id={id} describedBy={d} value={person.weightKg === null ? null : lbFromKg(person.weightKg)} onChange={(n) => onChange({ weightKg: n === null ? null : kgFromLb(n) })} min={70} max={600} suffix="lb" />}</Field>}
      </div>

      {child ? (
        <div role="group" aria-label={`Active, ${label}`} className="grid gap-2">
          <p className="text-[18px] font-semibold">Active?</p>
          <div className="grid grid-cols-3 gap-2">
            {ACTIVITY.map(([value, text]) => (
              <ChoiceTile key={value} compact selected={person.activity === value} onClick={() => onChange({ activity: value })}>
                {text}
              </ChoiceTile>
            ))}
          </div>
        </div>
      ) : (
        <>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label="Height">{(id, d) => <NumberInput id={id} describedBy={d} value={ft} onChange={(n) => setHeight(n, inch)} min={4} max={7} suffix="ft" />}</Field>
        <div className="grid min-w-0 gap-2">
          <label htmlFor={inchId} className="sr-only">Inches</label>
          <NumberInput id={inchId} value={inch} onChange={(n) => setHeight(ft, n)} min={0} max={11} suffix="in" />
        </div>
      </div>

      <div role="group" aria-label={`Training, ${label}`} className="grid gap-2">
        <p className="text-[18px] font-semibold">Do you workout?</p>
        <div className="grid grid-cols-3 gap-2">
          {(["none", "sometimes", "regular"] as const).map((t) => (
            <ChoiceTile key={t} compact selected={person.training === t} onClick={() => onChange({ training: t })}>
              {t === "none" ? "No" : t === "sometimes" ? "Now and then" : "Yes"}
            </ChoiceTile>
          ))}
        </div>
      </div>

      {(person.training === "regular" || person.training === "sometimes") && (
        <div role="group" aria-label={`Sports, ${label}`} className="grid gap-2">
          <p className="text-[18px] font-semibold">Which? <span className="font-normal text-muted">Pick what fits.</span></p>
          <div className="flex flex-wrap gap-2">
            {SPORT_ORDER.map((s: SportId) => {
              const on = person.sports.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => onChange({ sports: on ? person.sports.filter((x) => x !== s) : [...person.sports, s] })} className={`min-h-12 rounded-full border px-4 text-[17px] font-semibold ${on ? "border-tomato bg-tomato text-white" : "border-line bg-paper text-ink"}`}>
                  {SPORTS[s].label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {person.training === "regular" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Days a week">{(id, d) => <NumberInput id={id} describedBy={d} value={person.daysPerWeek} onChange={(n) => onChange({ daysPerWeek: n === null ? null : Math.round(n) })} min={1} max={7} suffix="days" />}</Field>
          <Field label="Each time">{(id, d) => <NumberInput id={id} describedBy={d} value={person.minutesPerSession} onChange={(n) => onChange({ minutesPerSession: n === null ? null : Math.round(n) })} min={10} max={240} suffix="min" />}</Field>
        </div>
      )}

        </>
      )}
        </>
      )}

      <div role="group" aria-label={`Goal, ${label}`} className="grid gap-2">
        <p className="text-[18px] font-semibold">Goal</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {goals.map((g) => (
            <ChoiceTile key={g.id} compact selected={person.goal === g.id} onClick={() => onChange({ goal: g.id })}>
              {g.label}
            </ChoiceTile>
          ))}
        </div>
      </div>

      {showEstimate && (
        <p data-testid="person-estimate" className="text-[17px] leading-snug text-muted">
          {est && complete
            ? young
              ? <>{label} is still growing, so Mama keeps the plate full, <span className="font-semibold text-ink">about {est.kcal.toLocaleString("en-US")} kcal a day</span>, and never trims it.</>
              : <>Mama&apos;s estimate for {label}: <span className="font-semibold text-ink">about {est.kcal.toLocaleString("en-US")} kcal</span> and <span className="font-semibold text-ink">{est.proteinG} g protein</span> a day.</>
            : person.sex === "unspecified"
              ? <>No estimate for {label}: a regular plate.{" "}<button type="button" className="font-semibold text-ink underline underline-offset-4" onClick={() => onChange({ sex: null })}>Add the details</button></>
              : <><button type="button" data-testid="skip-details" className="font-semibold text-ink underline underline-offset-4" onClick={() => onChange({ sex: "unspecified" })}>Skip the details for {label}</button></>}
        </p>
      )}
    </div>
  );
}
