"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { lock as lockPairings } from "@/components/pairings/usePairingsGate";
import { DrinksBudgetField } from "@/components/pairings/PairingsPage";
import { useOffline } from "@/lib/offline/useOffline";
import { useAppState, useRecoveredFrom, useSync } from "@/lib/useAppState";
import { DEFAULT_KITCHEN, DEFAULT_STATE, type AppState } from "@/lib/schemas";
import { flush, forgetLocalCache, getSnapshot, purgeLocalCopies, readRecoveryBackup, saveState } from "@/lib/store";
import { PeopleEditor } from "@/components/people/PeopleEditor";
import { DevicesCard } from "@/components/settings/DevicesCard";
import { useAdmin } from "@/components/AdminContext";
import { houseProteinG, peopleFor, personLabel, realAdults } from "@/lib/people";
import { Button } from "@/components/ui/Button";
import { KitchenTiles } from "@/components/kitchen/KitchenTiles";
import { draftToProfile, profileToDraft, type Draft } from "@/components/onboarding/draft";
import {
  AllergySection,
  BudgetSection,
  CuisineSection,
  DaysSection,
  DietSection,
  DrinksSection,
  GoalSection,
  DislikeSection,
  MealDrinksSection,
  MealsSection,
  PetsSection,
  ProteinSection,
  ServingsSection,
  SkillSection,
  TimeSection, MealTimesSection } from "@/components/onboarding/sections";

const LOCATION_PRIVACY =
  "A ZIP or city you add is looked up once on OpenStreetMap (Nominatim) and then remembered. If that lookup fails, a ZIP falls back to a built-in table. The saved location (ZIP or city and its coordinates) is stored in your account. Nearby places come from OpenStreetMap's Overpass, which receives your coordinates rounded to about 100 m and the radius you chose. Live prices, when available, are requested from Kroger with the store you picked.";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-8 border-t border-line pt-8">
      <h2 className="text-[28px] leading-tight">{title}</h2>
      {children}
    </section>
  );
}

function snapshot(draft: Draft | null, drinks: number | null): string {
  return JSON.stringify({ draft, drinks });
}

export default function SettingsPage() {
  const [state, setState, hydrated, saveError] = useAppState();
  const recoveredFrom = useRecoveredFrom();
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();
  const offline = useOffline();
  const [unsent, setUnsent] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Signing out erases this device's copy: what has not gone up goes first, and if it cannot, the person is told once.
  async function leave() {
    setLeaving(true);
    await flush();
    if (getSnapshot().sync.dirty) await flush();
    if (getSnapshot().sync.dirty && !unsent) {
      setLeaving(false);
      return setUnsent(true);
    }
    await lockPairings("signout");
    forgetLocalCache();
    // Still signed in (signal lost on the last step): start the page over so this device keeps a copy again.
    await signOut().catch(() => window.location.reload());
  }
  // Admins get the door link here too: the phone has no rail.
  const admin = useAdmin();
  const email = user?.primaryEmailAddress?.emailAddress;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Hooks stay above the "Loading…" return below.
  const sync = useSync();
  const [deleting, setDeleting] = useState(false);
  // Kept outside the onboarding draft: draftToProfile does not carry the drinks budget.
  const [drinks, setDrinks] = useState<number | null>(null);
  const loaded = useRef(false);
  // Snapshot of what is saved, so the button can say whether anything changed since.
  const [baseline, setBaseline] = useState<string>("");
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 4000);
    return () => clearTimeout(t);
  }, [savedFlash]);

  useEffect(() => {
    if (!hydrated || loaded.current) return;
    loaded.current = true;
    setDraft(profileToDraft(state.profile));
    setDrinks(state.profile.drinksBudgetUsd);
    setBaseline(snapshot(profileToDraft(state.profile), state.profile.drinksBudgetUsd));
  }, [hydrated, state]);

  function applyState(next: AppState) {
    setState(next);
    saveState(next);
    setDraft(profileToDraft(next.profile));
    setDrinks(next.profile.drinksBudgetUsd);
    setBaseline(snapshot(profileToDraft(next.profile), next.profile.drinksBudgetUsd));
  }

  if (!draft) {
    return <p className="text-[18px] text-muted">Loading your settings…</p>;
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const canSave = draft.daysToPlan !== null && Object.values(draft.slots).some(Boolean);
  const dirty = snapshot(draft, drinks) !== baseline;

  function save() {
    if (!draft) return;
    const next: AppState = { ...state, profile: { ...draftToProfile(draft, true), drinksBudgetUsd: drinks } };
    setState(next);
    saveState(next);
    setMessage({ tone: "ok", text: "Saved, your next plan will use these." });
    setBaseline(snapshot(draft, drinks));
    setSavedFlash(true);
  }

  function downloadOlderCopy() {
    const raw = readRecoveryBackup();
    if (raw === null) {
      setMessage({ tone: "error", text: "That older copy is no longer on this device." });
      return;
    }
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cooking-with-your-mom-older-copy.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function startOver() {
    purgeLocalCopies();
    applyState(DEFAULT_STATE);
    router.push("/start");
  }

  return (
    <div className="grid gap-8 pb-32 lg:pb-8">
      <h1 className="text-[40px] leading-tight">
        Your <em className="italic text-saffron">settings</em>
      </h1>

      {saveError && (
        <p role="alert" className="rounded-2xl bg-saffron-soft px-5 py-4 text-[18px] font-semibold text-ink">
          Your changes are not being saved on this device. Export a backup.
        </p>
      )}

      <Section title="Your week">
        {realAdults(state.people).length > 0 ? (
          <p className="text-[17px] leading-snug text-muted">Each grown-up&apos;s goal is on their card under &ldquo;Who&apos;s eating&rdquo;; Mama plans the week from those.</p>
        ) : (
          <GoalSection draft={draft} patch={patch} />
        )}
        <ProteinSection draft={draft} patch={patch} />
        <DaysSection draft={draft} patch={patch} />
        <MealsSection draft={draft} patch={patch} />
        <ServingsSection draft={draft} patch={patch} helper="How many servings Mama cooks per meal. Who eats them, and how big a plate, is just below." />
      </Section>

      <Section title="Who's eating">
        {deleting && (
          <p role="status" data-testid="deletion-status" className="text-[16px] font-semibold">
            {sync.dirty || sync.status === "saving" ? "Deleted here. Removing it from the server…" : sync.lastError ? "Deleted here. The server copy goes when you are back online." : "Deleted here and on the server."}
          </p>
        )}
        <p className="text-[16px] leading-relaxed text-muted">
          Mama sizes each plate from this: everyone gets the same protein and vegetables, the side (rice, potatoes, pasta, beans) follows each person&apos;s estimate. Saved as you type.
        </p>
        <PeopleEditor
          people={peopleFor(state)}
          onChange={(people) => {
            // The cooking yield follows the people; the protein target follows their estimates when there are any.
            const before = peopleFor(state);
            const removed = before.filter((p) => !people.some((q) => q.id === p.id)).map((p) => p.id);
            const next: AppState = {
              ...state,
              people,
              checkins: removed.length ? state.checkins.filter((c) => !removed.includes(c.personId)) : state.checkins,
              profile: { ...state.profile, servingsPerMeal: Math.max(1, people.length), proteinTargetG: houseProteinG(people) ?? state.profile.proteinTargetG },
            };
            setState(next);
            saveState(next);
            // People autosave: the saved truth moves, the baseline follows it; unsaved edits elsewhere stay dirty.
            setBaseline(snapshot(profileToDraft(next.profile), drinks));
            // Deletion contract: a removed person also leaves every local copy, and the
            // server copy is pushed now; the line below says when the server has it.
            if (removed.length) {
              purgeLocalCopies();
              setDeleting(true);
            }
            // Only the derived fields move; unsaved edits elsewhere on the page stay.
            setDraft((d) => (d ? { ...d, servingsPerMeal: next.profile.servingsPerMeal, proteinTargetG: next.profile.proteinTargetG } : d));
          }}
          allowClear
        />
      </Section>

      {state.checkins.length > 0 && (
        <Section title="Check-ins">
          <ul data-testid="checkin-history" className="grid gap-2">
            {[...state.checkins].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8).map((c) => {
              const i = state.people.findIndex((p) => p.id === c.personId);
              const who = i >= 0 ? personLabel(state.people[i], i) : "Someone";
              return (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-[17px]">
                  <span className="font-semibold">{c.at} · {who}</span>
                  <span className="text-muted">
                    energy {c.energy} · hunger {c.hunger} · meals {c.meals}{c.weightLb !== null ? ` · ${c.weightLb} lb` : ""} · {c.suggested === "hold" ? "held" : c.applied ? `${c.suggested === "up" ? "+" : "−"}150 kcal applied` : `${c.suggested} suggested, kept as is`}
                  </span>
                </li>
              );
            })}
          </ul>
          <div>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                const next: AppState = { ...state, checkins: [] };
                setState(next);
                saveState(next);
                purgeLocalCopies();
              }}
            >
              Delete all check-ins
            </Button>
          </div>
        </Section>
      )}

      <Section title="Your tracker">
        <DevicesCard />
      </Section>

      <Section title="Food you love">
        <CuisineSection draft={draft} patch={patch} />
      </Section>

      <Section title="Never and rather not">
        <DietSection draft={draft} patch={patch} />
        <AllergySection draft={draft} patch={patch} />
        <DislikeSection draft={draft} patch={patch} />
      </Section>

      <Section title="Time and money">
        <TimeSection draft={draft} patch={patch} />
        <BudgetSection draft={draft} patch={patch} />
        <MealTimesSection draft={draft} patch={patch} />
        <DrinksBudgetField value={drinks} onChange={setDrinks} />
        <SkillSection draft={draft} patch={patch} />
      </Section>

      <Section title="Your kitchen">
        <p className="text-[16px] leading-relaxed text-muted">Mama cooks with what you have and flags any recipe that still needs something else.</p>
        <KitchenTiles value={draft.kitchen ?? DEFAULT_KITCHEN} onChange={(kitchen) => patch({ kitchen })} />
      </Section>

      <Section title="Pets and drinks">
        <PetsSection draft={draft} patch={patch} />
        <DrinksSection draft={draft} patch={patch} />
        <MealDrinksSection draft={draft} patch={patch} />
      </Section>

      <Section title="Where you cook">
        <p className="text-[18px] text-ink">
          {state.location ? `Cooking in ${state.location.label}.` : "No location set yet."}
        </p>
        <p className="text-[16px] leading-relaxed text-muted">
          Change it, add another place or set a radius from the location pill at the top of the app.
        </p>
        <p className="text-[16px] leading-relaxed text-muted">
          <strong className="font-semibold text-ink">Location &amp; privacy.</strong> {LOCATION_PRIVACY}
        </p>
      </Section>

      <Section title="Your account">
        {email && <p className="text-[18px] text-ink">Signed in as {email}</p>}
        {admin && (
          <Link href="/admin" data-testid="settings-admin" className="inline-flex min-h-12 items-center rounded-full border border-ink/25 bg-white px-5 text-[17px] font-semibold text-ink">
            Waitlist: who&rsquo;s at the door
          </Link>
        )}
        {unsent && (
          <p role="alert" className="text-[17px] leading-snug text-tomato">
            Your last change hasn&apos;t gone up yet. Signing out now loses it.
          </p>
        )}
        <Button variant="ghost" size="md" fullWidth disabled={offline || leaving} onClick={() => void leave()}>
          {offline ? "Sign out · needs signal" : unsent ? "Sign out anyway" : "Sign out"}
        </Button>
      </Section>

      <Section title="Pairings (21+)">
        <Link href="/pairings" className="inline-flex min-h-12 items-center rounded-full border border-ink/25 bg-white px-5 text-[17px] font-semibold text-ink">
          Open pairings for drinks with your meals
        </Link>
      </Section>

      <Section title="Your data">
        {recoveredFrom && (
          <div className="grid gap-3 rounded-2xl bg-saffron-soft px-5 py-4">
            <p className="text-[18px] text-ink">
              Mama found an older copy of your data from{" "}
              {new Date(recoveredFrom).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
            </p>
            <Button variant="ghost" size="md" fullWidth onClick={downloadOlderCopy}>
              Download it
            </Button>
          </div>
        )}
        <div className="grid gap-3">
          {confirmReset ? (
            <div className="grid gap-3">
              <p className="text-[18px] text-ink">
                This erases your plan, favorites and answers. There is no undo.
              </p>
              <Button variant="primary" size="md" fullWidth onClick={startOver}>
                Yes, erase everything
              </Button>
              <Button variant="ghost" size="md" fullWidth onClick={() => setConfirmReset(false)}>
                Keep my data
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="md" fullWidth onClick={() => setConfirmReset(true)}>
              Start over
            </Button>
          )}
        </div>
      </Section>

      {message && message.tone === "error" && (
        <p
          role="status"
          className={[
            "rounded-2xl px-5 py-4 text-[18px] font-semibold",
            "bg-saffron-soft text-ink",
          ].join(" ")}
        >
          {message.text}
        </p>
      )}

      <div className="sticky bottom-20 z-20 grid gap-2 lg:static">
        {savedFlash && (
          <p role="status" data-testid="save-status" className="rounded-2xl bg-basil-soft px-5 py-3 text-center text-[17px] font-semibold text-basil-text shadow-lg">
            Saved, your next plan will use these.
          </p>
        )}
        <Button fullWidth disabled={!canSave || !dirty} onClick={save} className="shadow-lg" data-testid="save-changes">
          {dirty ? "Save changes" : "All saved"}
        </Button>
      </div>
    </div>
  );
}
