"use client";

import { useEffect, useRef, useState } from "react";
import type { StepAction } from "@/lib/schemas";
import { STEP_ACTION_LABEL } from "@/lib/stepAction";

// Looping clip of the action. Mount with key={action} so each clip starts fresh.
// Reduced motion: poster only, never autoplays. Tab hidden: paused.
// If the clip file fails to load, the whole block is hidden (no broken box).
export function StepClip({ action, className = "" }: { action: StepAction; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Read synchronously: this component only mounts on the client (CookMode waits for hydration).
  const [reduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;
    const onVisibility = () => {
      if (document.hidden) video.pause();
      else void video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
    };
  }, [reduced]);

  if (failed) return null;

  const label = STEP_ACTION_LABEL[action];
  return (
    <div
      data-testid="step-media"
      role="img"
      aria-label={`${label}, short looping clip`}
      className={[
        "relative aspect-video max-h-[36vh] w-full overflow-hidden rounded-[20px] bg-panel lg:max-h-none",
        className,
      ].join(" ")}
    >
      <video
        ref={videoRef}
        src={`/media/clips/${action}.mp4`}
        poster={`/media/clips/${action}.jpg`}
        muted
        loop
        playsInline
        autoPlay={!reduced}
        preload={reduced ? "none" : "metadata"}
        onError={() => setFailed(true)}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <p
        data-testid="step-media-label"
        className="absolute bottom-3 left-3 rounded-full bg-[#fff6ea]/92 px-3.5 py-1 text-[15px] font-semibold text-[#2a1d14]"
      >
        {label}
      </p>
    </div>
  );
}
