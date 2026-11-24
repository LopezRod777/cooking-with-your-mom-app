// Server-only: calls the extract service (services/extract) for a TikTok, Instagram or YouTube link.
// Returns null when the service is not configured, so the caller can fall back to the page path.
import { z } from "zod";
import { hasQuantity } from "./lookup";

export const REMOTE_TIMEOUT_MS = 90_000;
export const BUSY_RETRY_MS = 8_000;
export const NO_RECIPE_MIN_CHARS = 40;

// Loose on purpose: every field is optional or nullable, so a new or missing field never breaks an import.
const RemoteBody = z.object({
  ok: z.boolean(),
  reason: z.string().nullish(),
  platform: z.string().nullish(),
  url: z.string().nullish(),
  id: z.string().nullish(),
  author: z.string().nullish(),
  authorHandle: z.string().nullish(),
  caption: z.string().nullish(),
  likes: z.number().nullish(),
  views: z.number().nullish(),
  comments: z.number().nullish(),
  durationS: z.number().nullish(),
  videoUrl: z.string().nullish(),
  thumbUrl: z.string().nullish(),
  transcript: z.string().nullish(),
  onScreenText: z.array(z.string()).nullish(),
  ingredients: z.array(z.string()).nullish(),
  steps: z.array(z.string()).nullish(),
  dish: z.string().nullish(),
  notes: z.string().nullish(),
  timings: z.record(z.string(), z.unknown()).nullish(),
});

export type RemoteOk = {
  ok: true;
  platform: string;
  url: string;
  id?: string;
  author?: string;
  authorHandle?: string;
  caption?: string;
  likes?: number;
  views?: number;
  comments?: number;
  durationS?: number;
  videoUrl?: string;
  thumbUrl?: string;
  transcript?: string;
  onScreenText: string[];
  ingredients: string[];
  steps: string[];
  dish?: string;
  notes?: string;
  timings?: Record<string, unknown>;
};

export type RemoteFail = { ok: false; reason: string };
export type RemoteExtract = RemoteOk | RemoteFail;

type Deps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const trimmed = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};
const lines = (v: string[] | null | undefined): string[] => (v ?? []).map((s) => s.trim()).filter(Boolean);
const count = (v: number | null | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
const seconds = (v: number | null | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const httpUrl = (v: string | null | undefined): string | undefined => {
  const s = trimmed(v);
  if (!s || s.length > 2048) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

function normalize(b: z.infer<typeof RemoteBody>, requestedUrl: string): RemoteOk {
  return {
    ok: true,
    platform: trimmed(b.platform) ?? "",
    url: httpUrl(b.url) ?? requestedUrl,
    id: trimmed(b.id),
    author: trimmed(b.author),
    authorHandle: trimmed(b.authorHandle),
    caption: trimmed(b.caption),
    likes: count(b.likes),
    views: count(b.views),
    comments: count(b.comments),
    durationS: seconds(b.durationS),
    videoUrl: httpUrl(b.videoUrl),
    thumbUrl: httpUrl(b.thumbUrl),
    transcript: trimmed(b.transcript),
    onScreenText: lines(b.onScreenText),
    ingredients: lines(b.ingredients),
    steps: lines(b.steps),
    dish: trimmed(b.dish),
    notes: trimmed(b.notes),
    timings: b.timings ?? undefined,
  };
}

const isTimeout = (err: unknown) => {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
};

async function callOnce(
  endpoint: string,
  secret: string,
  url: string,
  doFetch: typeof fetch,
): Promise<RemoteExtract> {
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, reason: isTimeout(err) ? "timeout" : "fetch_failed" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: `http_${res.status}` };
  }
  const parsed = RemoteBody.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "bad_response" };
  const body = parsed.data;
  if (!body.ok) return { ok: false, reason: body.reason ?? `http_${res.status}` };
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  return normalize(body, url);
}

// Calls POST {EXTRACT_URL}/extract. One retry after 8 s when the service answers busy (429).
export async function remoteExtract(url: string, deps: Deps = {}): Promise<RemoteExtract | null> {
  const env = deps.env ?? process.env;
  const base = trimmed(env.EXTRACT_URL);
  const secret = trimmed(env.EXTRACT_SECRET);
  if (!base || !secret) return null;

  const endpoint = `${base.replace(/\/+$/, "")}/extract`;
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const first = await callOnce(endpoint, secret, url, doFetch);
  if (first.ok || first.reason !== "busy") return first;
  await sleep(BUSY_RETRY_MS);
  return callOnce(endpoint, secret, url, doFetch);
}

// The service answered, but the video holds no recipe: no ingredients, no steps, and only short
// speech and caption. On-screen text counts as recipe evidence too. The caller shows the video and asks for pasted text.
export function hasNoRecipe(r: RemoteOk): boolean {
  return (
    r.ingredients.length === 0 &&
    r.steps.length === 0 &&
    (r.transcript ?? "").length < NO_RECIPE_MIN_CHARS &&
    (r.caption ?? "").length < NO_RECIPE_MIN_CHARS &&
    r.onScreenText.join(" ").length < NO_RECIPE_MIN_CHARS
  );
}

// The service gave some recipe text, but too little to cook from: fewer than three ingredients with amounts and under two steps.
export function remoteIsThin(r: RemoteOk): boolean {
  return r.ingredients.filter(hasQuantity).length < 3 && r.steps.length < 2;
}

// Plain text for the structuring model. Empty sections are left out.
export function textFromRemote(r: RemoteOk): string {
  const head = [r.dish && `Title: ${r.dish}`, r.caption && `Caption: ${r.caption}`].filter(Boolean).join("\n");
  const sections = [
    head,
    r.transcript && `Spoken: ${r.transcript}`,
    r.onScreenText.length && `On screen:\n${r.onScreenText.map((s) => `- ${s}`).join("\n")}`,
    r.ingredients.length && `Ingredients:\n${r.ingredients.map((s) => `- ${s}`).join("\n")}`,
    r.steps.length && `Steps:\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    r.notes && `Notes: ${r.notes}`,
  ];
  return sections.filter((s): s is string => Boolean(s)).join("\n\n");
}
