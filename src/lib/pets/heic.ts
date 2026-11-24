// iPhone photos arrive as HEIC. Chrome and Firefox cannot decode them, so the form converts them to JPEG in the
// browser before resizing. The decoder (heic-to, libheif in wasm) is loaded only when a HEIC file is picked.

export function looksLikeHeic(file: { type: string; name: string }): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence" || type === "image/heif-sequence") {
    return true;
  }
  return /\.(heic|heif|hif)$/i.test(file.name);
}

// Browser only.
export async function heicToJpeg(file: Blob): Promise<Blob> {
  const { heicTo } = await import("heic-to/next");
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
}
