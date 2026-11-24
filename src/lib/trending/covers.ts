// Copies each kept post's thumbnail into our public Blob so the cards never hotlink a platform CDN
// (those URLs expire and block hotlinking). Server-only; also used by scripts/live/trending.mjs.
import { put } from "@vercel/blob";
import sharp from "sharp";
import type { TrendingPost } from "./apify";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const WIDTH = 720;
const CONCURRENCY = 4;

export type CoverDeps = {
  // Downloads the source; null when it is not an image or too big.
  download: (url: string) => Promise<Buffer | null>;
  // Stores the JPEG and returns its public URL.
  store: (path: string, jpeg: Buffer) => Promise<string>;
};

export async function downloadImage(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_SOURCE_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.byteLength > MAX_SOURCE_BYTES || buf.byteLength === 0 ? null : buf;
}

export async function storeCover(path: string, jpeg: Buffer): Promise<string> {
  const blob = await put(path, jpeg, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/jpeg",
    cacheControlMaxAge: 60 * 60 * 24 * 30,
  });
  return blob.url;
}

export const coverPath = (post: Pick<TrendingPost, "platform" | "id">) =>
  `trending/covers/${post.platform}-${post.id.replace(/[^A-Za-z0-9_-]/g, "")}.jpg`;

/** Returns the same posts with `image` set where the thumbnail could be copied; failures leave the post as is. */
export async function attachCovers(
  posts: TrendingPost[],
  deps: CoverDeps = { download: downloadImage, store: storeCover },
): Promise<TrendingPost[]> {
  const out = [...posts];
  let next = 0;
  const worker = async () => {
    while (next < out.length) {
      const i = next++;
      const post = out[i];
      if (!post.cover) continue;
      try {
        const source = await deps.download(post.cover);
        if (!source) continue;
        const jpeg = await sharp(source).rotate().resize({ width: WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        const image = await deps.store(coverPath(post), jpeg);
        out[i] = { ...post, image };
      } catch {
        // No image for this card; the feed still ships.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, out.length) }, worker));
  return out;
}
