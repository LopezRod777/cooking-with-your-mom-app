import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { isAdminEmail, requireUser } from "@/lib/auth/requireUser";
import { z } from "zod";
import { quotaExceededResponse, reserveAiQuota } from "@/lib/ai/dailyQuota";
import { detectPlatform, extractSource, normalizeUrl, type Platform } from "@/lib/import/extract";
import {
  hasNoRecipe,
  remoteExtract,
  remoteIsThin,
  textFromRemote,
  type RemoteExtract,
  type RemoteOk,
} from "@/lib/import/remote";
import { lookupRecipe, needsLookup } from "@/lib/import/lookup";
import { structureRecipe, type ImportMeta } from "@/lib/import/structure";
import { Profile } from "@/lib/schemas";

export const maxDuration = 300;

const MIN_TEXT = 40;
const IMPORT_ERROR = "Mama couldn't read that one. Paste the recipe text and she'll take it from there.";
// Platforms the extract service can read. YouTube is tried first too; if the service fails, the page path runs.
const REMOTE_PLATFORMS = new Set<Platform>(["tiktok", "instagram", "youtube"]);

const Body = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    text: z.string().max(20000).optional(),
    profile: Profile,
  })
  .refine((b) => Boolean(b.url) || Boolean(b.text?.trim()), { message: "Send a link or the recipe text." });

// Credit for a recipe read by the extract service: the video's creator, thumbnail and metrics.
function creditFromRemote(url: string, platform: Platform, r: RemoteOk): ImportMeta {
  return {
    platform,
    url,
    title: r.dish,
    author: r.authorHandle ? `@${r.authorHandle}` : r.author,
    image: r.thumbUrl,
    videoUrl: r.videoUrl,
    likes: r.likes,
    views: r.views,
    durationS: r.durationS,
  };
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const started = Date.now();
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isAdminEmail(u.email) && !(await reserveAiQuota(u.userId, "import"))) return quotaExceededResponse();
  const { url: rawUrl, profile } = parsed.data;
  const pasted = parsed.data.text?.trim() ?? "";

  let url: string | undefined;
  if (rawUrl) {
    url = normalizeUrl(rawUrl) ?? undefined;
    if (!url) return Response.json({ error: "That link doesn't look right." }, { status: 400 });
  }
  const platform: Platform = url ? detectPlatform(url) : "text";

  // The video service first (social links only). Its answer is the source, and its metadata is the credit.
  let remote: RemoteExtract | null = null;
  let remoteState = "skipped";
  let remoteMs = 0;
  if (url && REMOTE_PLATFORMS.has(platform)) {
    const t0 = Date.now();
    remote = await remoteExtract(url);
    remoteMs = Date.now() - t0;
    remoteState = remote === null ? "not_configured" : remote.ok ? "ok" : remote.reason;
  }
  const remoteOk: RemoteOk | null = remote && remote.ok ? remote : null;

  // The page is read only when the service did not answer, so the fallback path stays unchanged.
  const found = url && !remoteOk ? await extractSource(url) : null;
  const via = remoteOk ? "remote" : found ? "page" : "text";

  let lookup: "skipped" | "ok" | "not_found" | "failed" = "skipped";
  let lookupVia: "fast" | "slow" | null = null;
  let lookupReason: string | undefined;
  let lookupMs = 0;
  const log = (result: string) =>
    console.info(
      "[import]",
      JSON.stringify({
        result,
        platform,
        via,
        remote: remoteState,
        remoteMs,
        remoteTimings: remoteOk?.timings,
        lookup,
        lookupVia,
        lookupReason,
        lookupMs,
        totalMs: Date.now() - started,
      }),
    );

  async function tryLookup(meta: ImportMeta, text: string) {
    const t0 = Date.now();
    try {
      const out = await lookupRecipe({ title: meta.title, author: meta.author, platform: meta.platform, text });
      lookupMs = Date.now() - t0;
      lookupVia = out.via;
      lookupReason = out.reason;
      lookup = out.result ? "ok" : out.reason?.endsWith("failed") ? "failed" : "not_found";
      return out.result;
    } catch (err) {
      lookupMs = Date.now() - t0;
      lookup = "failed";
      console.error("[import] lookup threw", err instanceof Error ? err.message : "unknown");
      return null;
    }
  }

  let text: string;
  let meta: ImportMeta;
  let lookedUp: string | undefined;
  if (pasted) {
    if (pasted.length < MIN_TEXT) {
      log("paste_too_short");
      return Response.json({ error: "Paste a little more of the recipe." }, { status: 400 });
    }
    text = pasted;
    meta = remoteOk && url
      ? creditFromRemote(url, platform, remoteOk)
      : { platform, url, title: found?.title, author: found?.author, image: found?.image, ratingValue: found?.ratingValue, ratingCount: found?.ratingCount };
    if (needsLookup(text)) {
      const looked = await tryLookup(meta, text);
      if (looked) {
        meta = { ...meta, basedOn: looked.basedOn };
        lookedUp = looked.text;
      }
    }
  } else if (remoteOk && url) {
    const credit = creditFromRemote(url, platform, remoteOk);
    if (hasNoRecipe(remoteOk)) {
      const looked = credit.title || remoteOk.caption || remoteOk.dish
        ? await tryLookup(credit, textFromRemote(remoteOk) || credit.title || "")
        : null;
      if (!looked) {
        log("no_recipe_in_video");
        return Response.json({
          needsText: true,
          reason: "no_recipe_in_video",
          platform,
          url,
          title: credit.title,
          author: credit.author,
          image: credit.image,
          videoUrl: credit.videoUrl,
          likes: credit.likes,
          views: credit.views,
          durationS: credit.durationS,
        });
      }
      text = textFromRemote(remoteOk);
      meta = { ...credit, basedOn: looked.basedOn };
      lookedUp = looked.text;
    } else {
      text = textFromRemote(remoteOk);
      meta = credit;
      if (remoteIsThin(remoteOk)) {
        const looked = await tryLookup(credit, text);
        if (looked) {
          meta = { ...credit, basedOn: looked.basedOn };
          lookedUp = looked.text;
        }
      }
    }
  } else {
    if (!found || !found.ok || !found.text || found.text.length < MIN_TEXT) {
      log("needs_text");
      return Response.json({
        needsText: true,
        reason: found?.reason ?? "no_text",
        title: found?.title,
        author: found?.author,
        image: found?.image,
      });
    }
    text = found.text;
    meta = {
      platform: found.platform,
      url,
      title: found.title,
      author: found.author,
      image: found.image,
      ratingValue: found.ratingValue,
      ratingCount: found.ratingCount,
    };
    if (needsLookup(text)) {
      const looked = await tryLookup(meta, text);
      if (looked) {
        meta = { ...meta, basedOn: looked.basedOn };
        lookedUp = looked.text;
      }
    }
  }

  try {
    const recipe = await structureRecipe({ text, ...meta, profile, lookedUp });
    log("recipe");
    return Response.json({ recipe });
  } catch (err) {
    // Log the reason only. The pasted text and the key never leave the server.
    log("structure_failed");
    console.error("[import] structure failed", err instanceof Error ? err.message : "unknown");
    return Response.json({ error: IMPORT_ERROR }, { status: 502 });
  }
}
