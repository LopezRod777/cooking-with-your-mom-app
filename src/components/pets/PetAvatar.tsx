"use client";

import { useState } from "react";
import type { Pet } from "@/lib/schemas";

// 96 px circle, 72 px on phones. Photo from the owner-only route; placeholder with the initial when there is none.
export function PetAvatar({ pet, className = "" }: { pet: Pick<Pet, "id" | "name" | "photo">; className?: string }) {
  // Remember the src that failed so a replaced photo (new updatedAt) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = pet.photo
    ? `/api/pets/photo?petId=${encodeURIComponent(pet.id)}&v=${encodeURIComponent(pet.photo.updatedAt)}`
    : null;
  const box = `h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full sm:h-24 sm:w-24 ${className}`;

  if (src && src !== failedSrc) {
    return (
      // Served by our own route with a private, owner-scoped blob: next/image optimization does not apply.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={pet.name}
        width={96}
        height={96}
        className={`${box} object-cover`}
        onError={() => setFailedSrc(src)}
        data-testid="pet-avatar-photo"
      />
    );
  }

  const initial = pet.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      role="img"
      aria-label={pet.name}
      data-testid="pet-avatar-placeholder"
      className={`${box} grid place-items-center bg-saffron-soft font-display text-[36px] leading-none text-ink sm:text-[40px]`}
    >
      <span aria-hidden="true">{initial}</span>
    </div>
  );
}
