import { collectTrending, CRON_LIMITS, shouldPersist } from "@/lib/trending/run";
import { saveTrending } from "@/lib/trending/store";

export const maxDuration = 300;

// Vercel Cron sends Authorization: Bearer $CRON_SECRET. Manual runs use the same header.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await collectTrending(CRON_LIMITS);
  if (!shouldPersist(result)) {
    console.error("[cron/trending] no posts and errors; shelf not replaced", result.errors.join(" | "));
    return Response.json({ error: "Feeds failed; shelf unchanged.", stats: result.snapshot.stats }, { status: 502 });
  }

  await saveTrending(result.snapshot);
  return Response.json({ generatedAt: result.snapshot.generatedAt, stats: result.snapshot.stats, shelf: result.snapshot.posts.length });
}
