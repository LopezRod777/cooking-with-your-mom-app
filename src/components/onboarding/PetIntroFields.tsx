"use client";

import { useState, type ChangeEvent } from "react";
import type { PetIntro } from "@/lib/schemas";
import { resizeToSquareJpeg, PHOTO_SIZE } from "@/lib/pets/photo";
import { heicToJpeg, looksLikeHeic } from "@/lib/pets/heic";
import { PetAvatar } from "@/components/pets/PetAvatar";
import { ChoiceTile } from "../ui/Choice";
import { Field, inputClass } from "../ui/Field";

export const newPetId = () => crypto.randomUUID().slice(0, 12);

// First-pet card inside onboarding: name, dog or cat, photo; all optional. Weight and breed are asked in Pets, where
// they matter. The photo is staged on the server (draft key) and committed when onboarding finishes; `photoDraft` is
// the staged version, kept outside the profile.
export function PetIntroFields({
  intro,
  photoDraft,
  onChange,
  onPhotoDraft,
}: {
  intro: PetIntro;
  photoDraft: string | null;
  onChange: (next: PetIntro) => void;
  onPhotoDraft: (version: string | null) => void;
}) {
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);

  async function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      let jpeg: Blob;
      try {
        jpeg = await resizeToSquareJpeg(file, PHOTO_SIZE);
      } catch (err) {
        if (!looksLikeHeic(file)) throw err;
        jpeg = await resizeToSquareJpeg(await heicToJpeg(file), PHOTO_SIZE);
      }
      const body = new FormData();
      body.append("petId", intro.id);
      body.append("file", jpeg, "photo.jpg");
      const res = await fetch("/api/pets/photo?draft=1", { method: "POST", body });
      if (res.status === 413) throw new Error("too_large");
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const data = (await res.json()) as { updatedAt: string };
      onPhotoDraft(data.updatedAt);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      if (reason === "too_large") setPhotoError("That photo is too big. Try a smaller one.");
      else if (!reason.startsWith("upload")) setPhotoError("We couldn't open that photo. Try a JPEG or PNG.");
      else setPhotoError("That photo did not save. Try again.");
    } finally {
      setPhotoBusy(false);
    }
  }

  const name = intro.name?.trim() || "";
  const hasPhoto = photoDraft !== null && photoDraft !== failedDraft;

  return (
    <div data-testid="pet-intro" className="grid gap-5 rounded-[22px] border border-line bg-panel p-5">
      <p className="text-[16px] leading-snug text-muted">
        Optional. Weight and breed come later, in Pets.
      </p>

      <Field label="Their name">
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            className={inputClass}
            value={intro.name ?? ""}
            maxLength={24}
            placeholder=""
            autoComplete="off"
            onChange={(e) => onChange({ ...intro, name: e.target.value })}
          />
        )}
      </Field>

      <div role="group" aria-label="Dog or cat" className="grid grid-cols-2 gap-3">
        {(["dog", "cat"] as const).map((s) => (
          <ChoiceTile key={s} compact selected={intro.species === s} onClick={() => onChange({ ...intro, species: s })}>
            {s === "dog" ? "Dog" : "Cat"}
          </ChoiceTile>
        ))}
      </div>

      <div role="group" aria-label="Photo" className="grid gap-2">
        <div className="flex flex-wrap items-center gap-4">
          {hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/pets/photo?petId=${encodeURIComponent(intro.id)}&draft=1&v=${encodeURIComponent(photoDraft)}`}
              alt={name || "Your pet"}
              width={96}
              height={96}
              className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full object-cover"
              onError={() => setFailedDraft(photoDraft)}
              data-testid="pet-intro-photo"
            />
          ) : (
            <PetAvatar pet={{ id: intro.id, name: name || "?", photo: undefined }} />
          )}
          <label
            className={[
              "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-ink/25 bg-paper px-6 text-[18px] font-semibold text-ink transition-transform duration-150 active:scale-[0.97]",
              photoBusy ? "pointer-events-none opacity-40" : "",
            ].join(" ")}
          >
            {photoBusy ? "Saving…" : hasPhoto ? "Replace photo" : "Add a photo"}
            <input type="file" accept="image/*" className="sr-only" disabled={photoBusy} onChange={onPhotoPicked} data-testid="pet-intro-photo-input" />
          </label>
        </div>
        {photoError && (
          <p role="alert" className="text-[17px] font-semibold text-tomato">
            {photoError}
          </p>
        )}
      </div>

    </div>
  );
}
