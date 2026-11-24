"use client";

import { useEffect, useRef, useState } from "react";

/* Drink photos come from Blob, so they are plain <img> tags, like the pet bowl photos. */
/* eslint-disable @next/next/no-img-element */

// One shared photo per drink style (same for every user). Requests are cached for the page session.
const drinkRequests = new Map<string, Promise<string | null>>();
function drinkPhotoUrl(styleId: string): Promise<string | null> {
  let request = drinkRequests.get(styleId);
  if (!request) {
    request = fetch("/api/dish-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "pairing-drink", styleId }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
        return res.ok && typeof data?.url === "string" ? data.url : null;
      })
      .catch(() => null)
      .then((url) => {
        // A failed photo is asked for again on the next mount.
        if (url === null) drinkRequests.delete(styleId);
        return url;
      });
    drinkRequests.set(styleId, request);
  }
  return request;
}

// 4:3 photo at the top of a drink card. Saffron until the image has loaded, then it fades in.
export function DrinkPhoto({ styleId, name }: { styleId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let alive = true;
    void drinkPhotoUrl(styleId).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [styleId]);

  // A cached image can finish loading before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [url]);

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-[18px] bg-saffron-soft">
      {url && (
        <img
          ref={imgRef}
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
