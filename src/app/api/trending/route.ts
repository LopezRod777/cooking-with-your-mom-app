import { requireUser } from "@/lib/auth/requireUser";
import { connection } from "next/server";
import { loadTrending } from "@/lib/trending/store";

const CACHE = { "Cache-Control": "public, max-age=300" };

// connection() keeps this GET dynamic under cacheComponents, so it never serves a build-time snapshot.
export async function GET() {
  const u = await requireUser();
  if (u instanceof Response) return u;
  await connection();
  try {
    const snapshot = await loadTrending();
    return Response.json(snapshot ?? { posts: [] }, { headers: CACHE });
  } catch (err) {
    console.error("[trending] load failed", err instanceof Error ? err.message : "unknown");
    return Response.json({ posts: [] }, { headers: CACHE });
  }
}
