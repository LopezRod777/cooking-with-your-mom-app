import { describe, expect, it } from "vitest";
import { looksLikeHeic } from "./heic";

describe("looksLikeHeic", () => {
  it("matches iPhone HEIC/HEIF by mime type", () => {
    expect(looksLikeHeic({ type: "image/heic", name: "IMG_0001.HEIC" })).toBe(true);
    expect(looksLikeHeic({ type: "image/heif", name: "photo" })).toBe(true);
    expect(looksLikeHeic({ type: "image/heic-sequence", name: "live" })).toBe(true);
  });
  it("falls back to the extension when the browser reports no type", () => {
    expect(looksLikeHeic({ type: "", name: "IMG_0001.heic" })).toBe(true);
    expect(looksLikeHeic({ type: "", name: "IMG_0001.HIF" })).toBe(true);
  });
  it("leaves JPEG, PNG and WebP alone", () => {
    expect(looksLikeHeic({ type: "image/jpeg", name: "rex.jpg" })).toBe(false);
    expect(looksLikeHeic({ type: "image/png", name: "rex.png" })).toBe(false);
    expect(looksLikeHeic({ type: "", name: "rex.webp" })).toBe(false);
  });
});
