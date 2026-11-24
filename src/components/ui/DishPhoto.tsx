"use client";

/* Dish photos come from Blob or from source sites (any host), so they are plain <img> tags, not next/image. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { categoryImageFor, publicImageFor } from "@/lib/images/pick";
import type { Recipe } from "@/lib/schemas";

// Underneath: a quiet warm surface with a slow sheen, never a photo of another dish (a stock "category" photo
// showed a pita plate under a penne card; the owner, 2026-11-03). The dish photo fades in over it (300 ms) when it arrives.
// Cards load lazily at low fetch priority. `priority` (hero, Tonight) stays eager.
// Blob URLs have no width variants yet, so every card gets the full 1200 px asset.
// Serving smaller variants per `sizes` is a later step.
export function DishPhoto({
  recipe,
  sizes,
  priority = false,
}: {
  recipe: Recipe;
  sizes: string;
  priority?: boolean;
}) {
  const src = publicImageFor(recipe);
  const category = categoryImageFor(recipe);
  const isDish = src !== category;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // A cached image can finish loading before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoadedSrc(src);
  }, [src]);

  return (
    <>
      <div aria-hidden="true" data-testid="dish-placeholder" className="cwym-dish-wait absolute inset-0" />
      <style>{`
        .cwym-dish-wait { background: linear-gradient(135deg, #efe6d8 0%, #e6d9c6 45%, #efe6d8 100%); overflow: hidden; }
        .cwym-dish-wait::after { content: ""; position: absolute; inset: -40% -60%; background: linear-gradient(100deg, transparent 40%, rgba(255,250,240,0.55) 50%, transparent 60%); transform: translateX(-60%); animation: cwym-sheen 2.4s ease-in-out infinite; }
        @keyframes cwym-sheen { to { transform: translateX(60%); } }
        @media (prefers-reduced-motion: reduce) { .cwym-dish-wait::after { animation: none; } }
      `}</style>
      {isDish && (
        <img
          ref={imgRef}
          key={src}
          src={src}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "auto" : "async"}
          fetchPriority={priority ? undefined : "low"}
          onLoad={() => setLoadedSrc(src)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${
            loadedSrc === src ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </>
  );
}
