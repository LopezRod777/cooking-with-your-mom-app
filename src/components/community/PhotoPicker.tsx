"use client";

/* Community photos are served by our own route; a plain <img> keeps the same markup as the feed. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";

export type PhotoDraft = { photoId: string; w: number; h: number; state: "ok" | "review" };

const LONG_SIDE = 1280;
const FIRST_QUALITY = 0.82;
const RETRY_QUALITY = 0.7;
const MAX_BYTES = 1_500_000;
const HINT_KEY = "cwym:v1:photo-hint-seen";
const FALLBACK = "That didn't go through. Try again in a minute.";
const CANT_READ = "Mama can't read that file. A plain photo works.";

const MESSAGES: Record<number, string> = {
  413: "That photo's too big, honey. Try a smaller one.",
  415: CANT_READ,
  422: "That one doesn't go on the table, honey.",
  429: "Easy, honey. Give it a minute.",
};

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality),
  );
}

// Decodes, scales the long side to 1280 px and re-encodes as JPEG. Drawing on the canvas drops EXIF (GPS, device model).
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await encode(canvas, FIRST_QUALITY);
  if (blob.size > MAX_BYTES) blob = await encode(canvas, RETRY_QUALITY);
  return blob;
}

export function PhotoPicker({
  disabled,
  photo,
  onPhoto,
  onNote,
  onBusy,
}: {
  disabled: boolean;
  photo: PhotoDraft | null;
  onPhoto: (p: PhotoDraft | null) => void;
  onNote: (msg: string | null) => void;
  /** True while the photo is going up; the composer holds Send until it lands. */
  onBusy?: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Shown the first time the picker is opened on this device; deferred so nothing is set during the effect body.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setShowHint(!localStorage.getItem(HINT_KEY));
      } catch {
        // Storage blocked (private window): the line just stays hidden.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function open() {
    if (showHint) {
      setShowHint(false);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        // Nothing to do: the hint is only a one-time line.
      }
    }
    inputRef.current?.click();
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    onBusy?.(true);
    onNote(null);
    try {
      let blob: Blob;
      try {
        blob = await shrink(file);
      } catch {
        onNote(CANT_READ);
        return;
      }
      const body = new FormData();
      body.append("photo", blob, "photo.jpg");
      const res = await fetch("/api/community/photo", { method: "POST", body });
      if (res.ok) {
        const j = (await res.json()) as PhotoDraft;
        onPhoto({ photoId: j.photoId, w: j.w, h: j.h, state: j.state });
      } else {
        onNote(MESSAGES[res.status] ?? FALLBACK);
      }
    } catch {
      onNote(FALLBACK);
    } finally {
      setUploading(false);
    onBusy?.(false);
    }
  }

  const showCard = uploading || photo !== null || showHint;

  return (
    <div className="shrink-0">
      {/* The strip spans the composer (its nearest positioned ancestor), like an attachment preview in a chat app. */}
      {showCard && (
        <div className="absolute inset-x-0 bottom-full mb-2 grid gap-2 rounded-2xl bg-paper p-3 shadow-[0_8px_24px_-12px_rgba(35,26,20,0.35)] ring-1 ring-line">
          {photo && (
            <div className="flex items-center gap-2">
              <img
                src={`/api/community/photo/${photo.photoId}`}
                alt=""
                width={72}
                height={72}
                className={`h-[72px] w-[72px] rounded-[12px] object-cover ${photo.state === "review" ? "border border-dashed border-saffron" : ""}`}
                data-testid="photo-thumb"
              />
              <button
                type="button"
                onClick={() => onPhoto(null)}
                aria-label="Remove photo"
                data-testid="photo-remove"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[18px] font-semibold text-muted active:bg-ink/5"
              >
                ✕
              </button>
            </div>
          )}
          {uploading && <p className="px-1 font-hand text-[22px] leading-tight text-ink">Mama&apos;s looking at it…</p>}
          {showHint && !photo && !uploading && <p className="px-1 text-[13px] leading-snug text-muted">Food, your kitchen, your plate. No one else without asking them.</p>}
        </div>
      )}
      <button
        type="button"
        onClick={open}
        disabled={disabled || uploading}
        aria-label="Add a photo"
        data-testid="photo-button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-saffron-soft text-ink transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
      {/* No `capture`: with it, iPhone and Android open the camera only and the photo library is unreachable. */}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onChange(e)} data-testid="photo-input" />
    </div>
  );
}
