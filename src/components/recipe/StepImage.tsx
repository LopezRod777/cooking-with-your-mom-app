"use client";

/* Step photos come from our Blob host, so they are plain <img> tags, not next/image (same as DishPhoto). */
/* eslint-disable @next/next/no-img-element */

import type { StepAction } from "@/lib/schemas";
import { STEP_ACTION_LABEL } from "@/lib/stepAction";

// One photo per step, or a placeholder while it is being made (or after it failed).
export function StepImage({
  imageUrl,
  action,
  status,
}: {
  imageUrl?: string;
  action: StepAction;
  status: "pending" | "failed";
}) {
  if (!imageUrl) {
    if (status === "failed") {
      return (
        <div data-testid="step-image-failed" className="flex aspect-[4/3] w-full items-center justify-center rounded-[16px] bg-panel px-4 text-center">
          <p className="font-hand text-[22px] leading-tight text-muted">Mama couldn&apos;t get this photo right now, try again in a bit.</p>
        </div>
      );
    }
    return (
      <div data-testid="step-image-pending" role="status" aria-live="polite" className="flex aspect-[4/3] w-full items-center justify-center rounded-[16px] bg-panel animate-pulse">
        <p className="font-hand text-[24px] text-muted">Snapping the photo…</p>
      </div>
    );
  }
  const label = STEP_ACTION_LABEL[action];
  return (
    <figure
      data-testid="step-image"
      role="img"
      aria-label={label}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-[16px] bg-panel"
    >
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <figcaption
        data-testid="step-image-label"
        className="absolute bottom-2 left-2 rounded-full bg-[#fff6ea]/92 px-3 py-0.5 text-[14px] font-semibold text-[#2a1d14]"
      >
        {label}
      </figcaption>
    </figure>
  );
}
