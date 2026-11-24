"use client";

import { useState } from "react";
import { WANT_LABEL, applyMove, snooze, suggest, todayKey, type Answers } from "@/lib/checkins";
import { personLabel } from "@/lib/people";
import { WANTS, type AppState, type CheckIn, type Person, type Want } from "@/lib/schemas";
import { ChoiceTile } from "@/components/ui/Choice";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";

const newId = () => `c${Math.random().toString(36).slice(2, 8)}`;

// Two weeks in: three taps, an optional weight, what they want more of. Mama answers with a suggestion; nothing
// changes until the person taps Apply. One person at a time.
export function CheckinCard({ person, index, state, pending = null, onSave, onLater }: { person: Person; index: number; state: AppState; pending?: CheckIn | null; onSave: (next: AppState) => void; onLater: (next: AppState) => void }) {
  const label = personLabel(person, index);
  const [energy, setEnergy] = useState<Answers["energy"] | null>(null);
  const [hunger, setHunger] = useState<Answers["hunger"] | null>(null);
  const [meals, setMeals] = useState<Answers["meals"] | null>(null);
  const [weight, setWeight] = useState("");
  const [wants, setWants] = useState<Want[]>([]);
  // The saved check-in waiting for a decision lives in state, so the card survives re-renders and reloads.
  const result = pending;
  const weightLb = weight === "" ? null : Number(weight);
  const weightOk = weightLb === null || (Number.isInteger(weightLb) && weightLb >= 70 && weightLb <= 600);
  const ready = energy && hunger && meals && weightOk;

  function save() {
    if (!energy || !hunger || !meals || !weightOk) return;
    const answers: Answers = { energy, hunger, meals, weightLb, wants };
    const suggestion = suggest(person, answers, state.checkins);
    const checkin: CheckIn = { id: newId(), personId: person.id, at: todayKey(), ...answers, suggested: suggestion.move, why: suggestion.why, applied: false, kept: false };
    onSave({ ...state, checkins: [...state.checkins, checkin].slice(-60) });
  }
  function decide(apply: boolean) {
    if (!result) return;
    const people = apply ? state.people.map((p) => (p.id === person.id ? applyMove(p, result.suggested) : p)) : state.people;
    const checkins = state.checkins.map((c) => (c.id === result.id ? { ...c, applied: apply, kept: !apply } : c));
    onSave({ ...state, people, checkins });
  }

  if (result) {
    return (
      <section data-testid="checkin-result" aria-label="Check-in" className="grid gap-4 rounded-[22px] border border-line bg-panel p-5">
        <h2 className="text-[22px] font-semibold">Thanks, {label}.</h2>
        <p className="text-[18px] leading-snug">{result.why}</p>
        {result.suggested !== "hold" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="md" onClick={() => decide(true)}>{result.suggested === "up" ? "Add 150 kcal" : "Take 150 kcal off"}</Button>
            <Button size="md" variant="ghost" onClick={() => decide(false)}>Keep as is</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" variant="ghost" onClick={() => decide(false)}>Got it</Button>
            <p className="text-[16px] text-muted">Next check-in in two weeks. You can look back in Settings.</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section data-testid="checkin-card" aria-label="Check-in" className="grid gap-5 rounded-[22px] border border-line bg-panel p-5">
      <div>
        <h2 className="text-[22px] font-semibold">Two weeks in, {label}. How is it going?</h2>
        <p className="text-[16px] text-muted">Three taps. Mama only suggests; nothing changes unless you say so.</p>
      </div>
      <Row label="Energy" options={[["low", "Low"], ["ok", "Okay"], ["high", "Good"]]} value={energy} onChange={setEnergy} />
      <Row label="Hunger" options={[["hungry", "Hungry"], ["fine", "Fine"], ["stuffed", "Stuffed"]]} value={hunger} onChange={setHunger} />
      <Row label="The meals" options={[["meh", "Meh"], ["fine", "Fine"], ["love", "Love them"]]} value={meals} onChange={setMeals} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight today (optional)" error={weightOk ? null : "70 to 600 lb, whole number"}>
          {(id, d) => (
            <div className="relative">
              <input id={id} aria-describedby={d} inputMode="numeric" pattern="[0-9]*" className={`${inputClass} h-14 px-4 pr-12 text-[20px]`} value={weight} placeholder="160" onChange={(e) => setWeight(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-muted">lb</span>
            </div>
          )}
        </Field>
      </div>
      <div role="group" aria-label="Want more of" className="grid gap-2">
        <p className="text-[18px] font-semibold">Want more of… <span className="font-normal text-muted">up to 3</span></p>
        <div className="flex flex-wrap gap-2">
          {WANTS.map((w) => {
            const on = wants.includes(w);
            return (
              <button key={w} type="button" aria-pressed={on} disabled={!on && wants.length >= 3} onClick={() => setWants(on ? wants.filter((x) => x !== w) : [...wants, w])} className={`min-h-12 rounded-full border px-4 text-[17px] font-semibold disabled:opacity-40 ${on ? "border-tomato bg-tomato text-white" : "border-line bg-paper text-ink"}`}>
                {WANT_LABEL[w]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="md" disabled={!ready} onClick={save}>Save</Button>
        <Button size="md" variant="ghost" onClick={() => onLater({ ...state, people: state.people.map((p) => (p.id === person.id ? snooze(p) : p)) })}>Later</Button>
      </div>
    </section>
  );
}

function Row<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="grid gap-2">
      <p className="text-[18px] font-semibold">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map(([v, text]) => (
          <ChoiceTile key={v} compact selected={value === v} onClick={() => onChange(v)}>{text}</ChoiceTile>
        ))}
      </div>
    </div>
  );
}
