// Pet photo helpers shared by the client (resize) and the photo route (key, limits).
// Pure functions only: no DOM at module level, so the server and vitest can import it.

export const PHOTO_SIZE = 512;
export const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;
// Request-level guard, checked from content-length before the body is parsed.
export const PHOTO_REQUEST_MAX_BYTES = 2 * 1024 * 1024;
// Input limits for the decoder: anything wider or taller than this is refused.
export const PHOTO_INPUT_MAX_SIDE = 8000;
export const PHOTO_INPUT_MAX_PIXELS = 40_000_000;
export const PET_ID_PATTERN = /^[A-Za-z0-9_-]{6,24}$/;

// Final photo: what Save commits and what the card shows.
export function photoKey(userId: string, petId: string): string {
  return `pets/${userId}/${petId}.jpg`;
}

// Staged photo: what the form uploads on pick. Only commit moves it to photoKey.
export function draftKey(userId: string, petId: string): string {
  return `pets/${userId}/${petId}.draft.jpg`;
}

export type SquareCrop = { sx: number; sy: number; side: number };

// Largest centered square inside a w x h image.
export function squareCrop(w: number, h: number): SquareCrop {
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

// Browser only: center-crops to a square and encodes a JPEG at quality 0.82.
export async function resizeToSquareJpeg(file: Blob, size: number = PHOTO_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas is not available");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("could not encode the photo");
    return blob;
  } finally {
    bitmap.close();
  }
}
