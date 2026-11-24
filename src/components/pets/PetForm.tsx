"use client";

import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { Pet, RESTRICTION_KINDS, type PetIntro, type Restriction, type RestrictionKind } from "@/lib/schemas";
import type { PetSpecies } from "@/lib/pets/classify";
import { resizeToSquareJpeg, PHOTO_SIZE } from "@/lib/pets/photo";
import { heicToJpeg, looksLikeHeic } from "@/lib/pets/heic";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { ChoiceTile } from "@/components/ui/Choice";
import { PetAvatar } from "./PetAvatar";

const LB_PER_KG = 2.20462;
const MAX_RESTRICTIONS = 8; // Pet.restrictions max in the schema

const RESTRICTION_LABELS: Record<RestrictionKind, string> = {
  chicken: "Chicken",
  beef: "Beef",
  turkey: "Turkey",
  fish: "Fish",
  egg: "Egg",
  grain: "Grain",
  dairy: "Dairy",
  pancreatitis: "Pancreatitis",
  kidney: "Kidney disease",
  diabetes: "Diabetes",
  other: "Other",
};
type Unit = "lb" | "kg";
type Size = "small" | "medium" | "large";

function Group({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div role="group" aria-labelledby={id} aria-describedby={error ? errorId : undefined} className="grid gap-2">
      <p id={id} className="text-[18px] font-semibold text-ink">
        {label}
      </p>
      {children}
      {error && (
        <p id={errorId} role="alert" className="text-[17px] font-semibold text-tomato">
          {error}
        </p>
      )}
    </div>
  );
}

function kgToDisplay(kg: number, unit: Unit): string {
  const v = unit === "lb" ? kg * LB_PER_KG : kg;
  return String(Math.round(v * 10) / 10);
}

export function PetForm({
  initial,
  prefill = null,
  currentMonth,
  onSave,
  onCancel,
}: {
  initial: Pet | null;
  // What onboarding learned about the first pet (name, species, weight, breed, committed photo). Add mode only.
  prefill?: PetIntro | null;
  currentMonth: string;
  onSave: (pet: Pet) => void;
  onCancel: () => void;
}) {
  // Fixed for the life of the form so a photo staged before Save belongs to the pet being saved.
  const [petId] = useState(() => initial?.id ?? prefill?.id ?? crypto.randomUUID().slice(0, 12));
  // Photo edits are staged until Save: `photo` is the saved one, `draftVersion` a picked (uploaded, uncommitted) one.
  const [photo, setPhoto] = useState<Pet["photo"]>(initial?.photo ?? prefill?.photo);
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? "");
  const [breed, setBreed] = useState(initial?.breed ?? prefill?.breed ?? "");
  const [species, setSpecies] = useState<PetSpecies | null>(initial?.species ?? prefill?.species ?? null);
  const [unit, setUnit] = useState<Unit>("lb");
  const startKg = initial?.weightKg ?? prefill?.weightKg;
  const [weight, setWeight] = useState(startKg === undefined ? "" : kgToDisplay(startKg, "lb"));
  const [born, setBorn] = useState(initial?.bornYearMonth ?? "");
  const [neutered, setNeutered] = useState<boolean | null>(initial?.neutered ?? null);
  const [size, setSize] = useState<Size | null>(initial?.expectedAdultSize ?? null);
  const [kinds, setKinds] = useState<RestrictionKind[]>(
    () => RESTRICTION_KINDS.filter((k) => initial?.restrictions.some((r) => r.kind === k)),
  );
  const [otherText, setOtherText] = useState(initial?.restrictions.find((r) => r.kind === "other")?.text ?? "");
  const [errors, setErrors] = useState<Partial<Record<"name" | "species" | "weight" | "born" | "neutered" | "size" | "restrictions", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const showDraft = draftVersion !== null && !removePhoto;
  const showSaved = draftVersion === null && !removePhoto && photo !== undefined;
  const hasPhoto = showDraft || showSaved;

  async function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      // Safari decodes HEIC itself; Chrome and Firefox do not, so iPhone photos go through the wasm converter first.
      let jpeg: Blob;
      try {
        jpeg = await resizeToSquareJpeg(file, PHOTO_SIZE);
      } catch (err) {
        if (!looksLikeHeic(file)) throw err;
        jpeg = await resizeToSquareJpeg(await heicToJpeg(file), PHOTO_SIZE);
      }
      const body = new FormData();
      body.append("petId", petId);
      body.append("file", jpeg, "photo.jpg");
      const res = await fetch("/api/pets/photo?draft=1", { method: "POST", body });
      if (res.status === 413) throw new Error("too_large");
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const data = (await res.json()) as { key: string; updatedAt: string };
      setDraftVersion(data.updatedAt);
      setRemovePhoto(false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      if (reason === "too_large") setPhotoError("That photo is too big. Try a smaller one.");
      else if (!reason.startsWith("upload")) setPhotoError("We couldn't open that photo. Try a JPEG or PNG, or pick it from your phone.");
      else setPhotoError("That photo did not save. Try again.");
    } finally {
      setPhotoBusy(false);
    }
  }

  // Only marks the removal; the server copy goes away on Save.
  function markPhotoRemoved() {
    setPhotoError(null);
    setRemovePhoto(true);
  }

  // Drops a staged draft (best effort) and leaves the saved pet untouched.
  function cancel() {
    if (draftVersion !== null) {
      fetch(`/api/pets/photo?petId=${encodeURIComponent(petId)}&draft=1`, { method: "DELETE", keepalive: true }).catch(() => {});
    }
    onCancel();
  }

  function toggleKind(kind: RestrictionKind) {
    setKinds((list) => {
      if (list.includes(kind)) return list.filter((k) => k !== kind);
      return list.length >= MAX_RESTRICTIONS ? list : [...list, kind];
    });
  }

  function changeUnit(next: Unit) {
    const n = Number(weight);
    if (weight.trim() !== "" && Number.isFinite(n) && n > 0) {
      const kg = unit === "lb" ? n / LB_PER_KG : n;
      setWeight(kgToDisplay(kg, next));
    }
    setUnit(next);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (photoBusy) return;
    const next: typeof errors = {};
    const trimmed = name.trim();
    if (!trimmed) next.name = "Add a name.";
    else if (trimmed.length > 24) next.name = "Keep the name under 24 characters.";
    if (!species) next.species = "Pick dog or cat.";
    const n = Number(weight);
    const kg = Math.round((unit === "lb" ? n / LB_PER_KG : n) * 10) / 10;
    if (weight.trim() === "" || !Number.isFinite(n) || kg < 0.5 || kg > 90) {
      next.weight = unit === "lb" ? "Enter a weight between 1 and 198 lb." : "Enter a weight between 0.5 and 90 kg.";
    }
    if (!born) next.born = "Pick the month they were born.";
    else if (born > currentMonth) next.born = "Pick a month that has already passed.";
    if (neutered === null) next.neutered = "Choose yes or no.";
    if (species === "dog" && !size) next.size = "Pick the expected adult size.";
    const otherTrimmed = otherText.trim();
    if (kinds.includes("other") && !otherTrimmed) next.restrictions = "Write what the restriction is.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || !species || neutered === null) return;

    // Photo first: a removed photo is deleted, a staged one is committed to its final key.
    let savedPhoto = photo;
    if (removePhoto || draftVersion !== null) {
      setPhotoBusy(true);
      setPhotoError(null);
      try {
        if (removePhoto) {
          const res = await fetch(`/api/pets/photo?petId=${encodeURIComponent(petId)}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`delete ${res.status}`);
          savedPhoto = undefined;
        } else {
          const res = await fetch("/api/pets/photo/commit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ petId }),
          });
          if (!res.ok) throw new Error(`commit ${res.status}`);
          const data = (await res.json()) as { key: string; updatedAt: string };
          savedPhoto = { key: data.key, updatedAt: data.updatedAt };
        }
        setPhoto(savedPhoto);
        setDraftVersion(null);
        setRemovePhoto(false);
      } catch {
        setPhotoError(removePhoto ? "The photo could not be removed. Try again." : "That photo did not save. Try another one.");
        return;
      } finally {
        setPhotoBusy(false);
      }
    }

    const id = petId;
    const restrictions: Restriction[] = kinds.map((kind) =>
      kind === "other" ? { kind, text: otherTrimmed } : { kind },
    );
    // Spread the existing pet first so extrasLog survives an edit; the form owns the rest.
    const candidate = {
      ...initial,
      id,
      name: trimmed,
      breed: breed.trim() || undefined,
      photo: savedPhoto,
      species,
      weightKg: kg,
      bornYearMonth: born,
      neutered,
      expectedAdultSize: species === "dog" && size ? size : undefined,
      restrictions,
    };
    const parsed = Pet.safeParse(candidate);
    if (!parsed.success) {
      setFormError("Some details are not valid. Check the form and try again.");
      return;
    }
    onSave(parsed.data);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={initial ? `Edit ${initial.name}` : "Add a pet"}
      className="grid gap-6 rounded-[24px] border border-line bg-paper p-6"
    >
      <h2 className="font-display text-[28px] leading-tight">
        {initial ? `Edit ${initial.name}` : prefill?.name?.trim() ? `Finish ${prefill.name.trim()}'s card` : "Add a pet"}
      </h2>
      {!initial && prefill && (
        <p className="text-[17px] leading-snug text-muted">
          From your setup. A birth month and neutered yes or no size the portions; the rest is filled in.
        </p>
      )}

      {formError && (
        <p role="alert" className="rounded-2xl bg-saffron-soft px-5 py-4 text-[18px] font-semibold text-ink">
          {formError}
        </p>
      )}

      <Field label="Name" error={errors.name}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={errors.name ? true : undefined}
            className={inputClass}
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>

      <Group label="Photo (optional)" error={photoError}>
        <div className="flex flex-wrap items-center gap-4">
          {showDraft && draftVersion !== failedDraft ? (
            // The staged photo is served from the draft key; PetAvatar only knows the saved one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/pets/photo?petId=${encodeURIComponent(petId)}&draft=1&v=${encodeURIComponent(draftVersion!)}`}
              alt={name.trim() || "?"}
              width={96}
              height={96}
              className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full object-cover sm:h-24 sm:w-24"
              onError={() => setFailedDraft(draftVersion)}
              data-testid="pet-avatar-photo"
            />
          ) : (
            <PetAvatar pet={{ id: petId, name: name.trim() || "?", photo: showSaved ? photo : undefined }} />
          )}
          <div className="flex flex-wrap gap-3">
            <label
              className={[
                "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-ink/25 bg-paper px-6 text-[18px] font-semibold text-ink transition-transform duration-150 active:scale-[0.97]",
                photoBusy ? "pointer-events-none opacity-40" : "",
              ].join(" ")}
            >
              {hasPhoto ? "Replace photo" : "Add a photo"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={photoBusy}
                onChange={onPhotoPicked}
              />
            </label>
            {hasPhoto && (
              <Button variant="ghost" size="md" disabled={photoBusy} onClick={markPhotoRemoved}>
                Remove photo
              </Button>
            )}
          </div>
        </div>
      </Group>

      <Field label="Breed (optional)">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            className={inputClass}
            value={breed}
            maxLength={40}
            onChange={(e) => setBreed(e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>

      <Group label="Species" error={errors.species}>
        <div className="grid grid-cols-2 gap-3">
          {(["dog", "cat"] as const).map((s) => (
            <ChoiceTile
              key={s}
              compact
              selected={species === s}
              onClick={() => {
                setSpecies(s);
                if (s === "cat") setSize(null);
              }}
            >
              {s === "dog" ? "Dog" : "Cat"}
            </ChoiceTile>
          ))}
        </div>
      </Group>

      <Field label="Weight" error={errors.weight}>
        {(id, describedBy) => (
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={errors.weight ? true : undefined}
              className={inputClass}
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Weight unit">
              {(["lb", "kg"] as const).map((u) => (
                <ChoiceTile
                  key={u}
                  compact
                  className="min-w-16"
                  selected={unit === u}
                  onClick={() => changeUnit(u)}
                >
                  {u}
                </ChoiceTile>
              ))}
            </div>
          </div>
        )}
      </Field>

      <Field label="Born" error={errors.born}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={errors.born ? true : undefined}
            className={inputClass}
            type="month"
            value={born}
            max={currentMonth}
            onChange={(e) => setBorn(e.target.value)}
          />
        )}
      </Field>

      <Group label="Neutered or spayed?" error={errors.neutered}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { v: true, label: "Yes" },
            { v: false, label: "No" },
          ].map((o) => (
            <ChoiceTile key={o.label} compact selected={neutered === o.v} onClick={() => setNeutered(o.v)}>
              {o.label}
            </ChoiceTile>
          ))}
        </div>
      </Group>

      {species === "dog" && (
        <Group label="Expected adult size" error={errors.size}>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { v: "small", label: "Small, under 22 lb" },
                { v: "medium", label: "Medium, 22 to 55 lb" },
                { v: "large", label: "Large, over 55 lb" },
              ] as const
            ).map((o) => (
              <ChoiceTile key={o.v} compact selected={size === o.v} onClick={() => setSize(o.v)}>
                {o.label}
              </ChoiceTile>
            ))}
          </div>
        </Group>
      )}

      <Group label="Any restrictions?" error={errors.restrictions}>
        <p className="text-[16px] leading-snug text-muted">
          Pick every one that applies. Allergies remove those foods; medical ones mean Mama only suggests extras with your vet&apos;s OK.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RESTRICTION_KINDS.map((kind) => {
            const on = kinds.includes(kind);
            const full = !on && kinds.length >= MAX_RESTRICTIONS;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggleKind(kind)}
                className={[
                  "min-h-12 rounded-2xl border px-3 py-2 text-[17px] font-semibold leading-tight transition duration-150 disabled:opacity-40",
                  on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink",
                ].join(" ")}
              >
                {RESTRICTION_LABELS[kind]}
              </button>
            );
          })}
        </div>
        {kinds.includes("other") && (
          <Field label="Describe the restriction">
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                value={otherText}
                maxLength={60}
                onChange={(e) => setOtherText(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        )}
      </Group>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={photoBusy}>
          Save pet
        </Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
