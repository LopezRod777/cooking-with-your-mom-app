"use client";

import Link from "next/link";
import { useState } from "react";
import { ChoiceTile } from "@/components/ui/Choice";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { blankPerson, houseProteinG, peopleFor, personLabel, realAdults } from "@/lib/people";
import { GOALS, isMinor, Person, type AppState } from "@/lib/schemas";

// The people who count as a table: grown-ups whose card says something, and children. Blank cards are not people.
export function tablePeople(people: Person[]): Person[] {
  const adults = new Set(realAdults(people).map((p) => p.id));
  return people.filter((p) => adults.has(p.id) || isMinor(p));
}

// A new companion joins the household, as if added in Settings: a blank plate becomes theirs when there is one, never more than six; the cooking yield and the protein target follow.
export function withCompanion(prev: AppState, p: Person): AppState {
  const base = peopleFor(prev);
  const blankAt = base.findIndex((b) => b.name.trim() === "" && b.sex === null && b.weightKg === null && b.age === null);
  const people = blankAt >= 0 ? base.map((b, i) => (i === blankAt ? p : b)) : base.length >= 6 ? base : [...base, p];
  if (people === base) return prev;
  return { ...prev, people, profile: { ...prev.profile, servingsPerMeal: Math.max(1, people.length), proteinTargetG: houseProteinG(people) ?? prev.profile.proteinTargetG } };
}

// "Diego" / "Diego and Noor" / "Diego, Noor and Mateo"
export function namesOf(people: Person[], all: Person[]): string {
  const names = people.map((p) => personLabel(p, all.indexOf(p)));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function tileLabel(p: Person, all: Person[]): string {
  const who = personLabel(p, all.indexOf(p));
  if (isMinor(p)) return `${who} · kid`;
  const goal = GOALS.find((g) => g.id === p.goal)?.label ?? "Just eat well";
  return `${who} · ${goal}`;
}

const newId = () => `p${Math.random().toString(36).slice(2, 8)}`;
const ADULT_GOALS = GOALS.filter((g) => g.id !== "grow");

// A new companion in three taps: name, grown-up or kid, goal (or age). Height and weight can come later in Settings.
function QuickAddPerson({ onAdd, onCancel }: { onAdd: (p: Person) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [kid, setKid] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [goal, setGoal] = useState<Person["goal"]>("eat_well");
  const ready = name.trim().length > 0 && (!kid || (Number.isInteger(age) && age !== null && age >= 2 && age <= 15));
  function add() {
    const p = Person.parse({
      ...blankPerson(newId()),
      name: name.trim(),
      relation: kid ? "child" : null,
      sex: kid ? null : "unspecified",
      age: kid ? age : null,
      goal: kid ? "grow" : goal,
      addedAt: new Date().toISOString().slice(0, 10),
    });
    onAdd(p);
  }
  return (
    <div data-testid="quick-add" className="grid gap-4 rounded-[20px] border border-line p-5">
      <label className="grid gap-2 text-[18px] font-semibold">
        Name
        <input className={`${inputClass} h-14 px-4 text-[20px]`} value={name} maxLength={24} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <ChoiceTile type="button" compact selected={!kid} onClick={() => setKid(false)}>Grown-up</ChoiceTile>
        <ChoiceTile type="button" compact selected={kid} onClick={() => setKid(true)}>Kid</ChoiceTile>
      </div>
      {kid ? (
        <label className="grid gap-2 text-[18px] font-semibold">
          Age
          <input className={`${inputClass} h-14 w-28 px-4 text-[20px]`} type="number" inputMode="numeric" step={1} min={2} max={15} value={age ?? ""} onChange={(e) => setAge(e.target.value === "" ? null : Number(e.target.value))} />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {ADULT_GOALS.map((g) => (
            <ChoiceTile key={g.id} type="button" compact selected={goal === g.id} onClick={() => setGoal(g.id as Person["goal"])}>{g.label}</ChoiceTile>
          ))}
        </div>
      )}
      <p className="text-[16px] leading-snug text-muted">Height and weight can wait for Settings.</p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="md" disabled={!ready} onClick={add}>Add</Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// Tiles for who this dish is for. All on by default (the caller passes the ids); the last one cannot be turned off.
export function WhoIsEating({
  people,
  all,
  selected,
  onChange,
  onAdd,
  disabled = false,
  title = "Who's eating this one?",
}: {
  people: Person[];
  all: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onAdd?: (p: Person) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [adding, setAdding] = useState(false);
  function toggle(id: string) {
    if (selected.includes(id)) {
      if (selected.length === 1) return;
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange(people.filter((p) => p.id === id || selected.includes(p.id)).map((p) => p.id));
    }
  }
  return (
    <section data-testid="who-eating" className="grid gap-3">
      <h2 className="text-[20px] font-semibold">{title}</h2>
      <div className="flex flex-wrap gap-3">
        {people.map((p) => (
          <ChoiceTile
            key={p.id}
            type="button"
            data-testid="who-tile"
            aria-pressed={selected.includes(p.id)}
            selected={selected.includes(p.id)}
            disabled={disabled}
            onClick={() => toggle(p.id)}
          >
            {tileLabel(p, all)}
          </ChoiceTile>
        ))}
        {onAdd && all.length < 6 && !adding && (
          <ChoiceTile type="button" data-testid="who-add" selected={false} disabled={disabled} onClick={() => setAdding(true)}>
            + Someone new
          </ChoiceTile>
        )}
      </div>
      {onAdd && adding && <QuickAddPerson onAdd={(p) => { setAdding(false); onAdd(p); }} onCancel={() => setAdding(false)} />}
      {!onAdd && (
        <Link href="/settings" className="min-h-12 justify-self-start text-[18px] font-semibold underline underline-offset-4">
          Add someone
        </Link>
      )}
    </section>
  );
}
