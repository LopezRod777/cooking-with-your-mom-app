// Vercel Blob storage for the weekly snapshot. Server-only.
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { z } from "zod";
import { TrendingPost } from "./apify";

export const LATEST_PATH = "trending/latest.json";

export const Snapshot = z.object({
  generatedAt: z.iso.datetime(),
  hashtags: z.object({ tiktok: z.array(z.string()), instagram: z.array(z.string()) }),
  posts: z.array(TrendingPost),
  stats: z.object({
    fetched: z.number().int().min(0),
    keptAsRecipe: z.number().int().min(0),
    cost: z.object({ tiktokItems: z.number().int().min(0), instagramItems: z.number().int().min(0) }),
    errors: z.array(z.string()).optional(),
  }),
});
export type Snapshot = z.infer<typeof Snapshot>;

const WRITE = {
  access: "public" as const,
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 300,
  contentType: "application/json",
};

// Writes trending/latest.json (what the app reads) and trending/<UTC date>.json (history).
export async function saveTrending(snapshot: Snapshot): Promise<{ latestUrl: string; dayUrl: string }> {
  const body = JSON.stringify(snapshot, null, 2);
  const day = snapshot.generatedAt.slice(0, 10);
  const [latest, dayBlob] = await Promise.all([
    put(LATEST_PATH, body, WRITE),
    put(`trending/${day}.json`, body, WRITE),
  ]);
  return { latestUrl: latest.url, dayUrl: dayBlob.url };
}

export async function loadTrending(): Promise<Snapshot | null> {
  let meta: { url: string };
  try {
    meta = await head(LATEST_PATH);
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
  const res = await fetch(meta.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`trending latest.json HTTP ${res.status}`);
  const parsed = Snapshot.safeParse(await res.json());
  if (!parsed.success) throw new Error("trending latest.json does not match the snapshot schema");
  return parsed.data;
}
