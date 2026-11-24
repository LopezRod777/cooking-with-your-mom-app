import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/not-invited",
  "/waitlist",
  "/api/cron/trending",
  "/manifest.webmanifest",
  "/icon.svg",
  "/media/(.*)",
  "/offline",
]);

const origin = process.env.NEXT_PUBLIC_APP_ORIGIN;

// `?ref=<slug>` on any page → cookie for 30 days. The first referral wins; a later link does not overwrite it.
const REF_COOKIE = "cwym_ref";
const REF_RE = /^[a-z0-9-]{1,32}$/;

function refToSet(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get("ref")?.trim().toLowerCase() ?? "";
  if (!REF_RE.test(raw)) return null;
  if (req.cookies.get(REF_COOKIE)?.value) return null;
  return raw;
}

function withRef<T extends Response>(res: T, ref: string | null): T {
  if (!ref) return res;
  const next = res instanceof NextResponse ? res : new NextResponse(res.body, res);
  next.cookies.set(REF_COOKIE, ref, { maxAge: 30 * 24 * 3600, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return next as unknown as T;
}

export default clerkMiddleware(
  async (auth, req) => {
    const ref = refToSet(req);
    if (isPublic(req)) return ref ? withRef(NextResponse.next(), ref) : undefined;
    const { userId, redirectToSignIn } = await auth();
    if (userId) return ref ? withRef(NextResponse.next(), ref) : undefined;
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // A client-router fetch (prefetch or soft navigation) while Clerk rotates the session token: answer 401, never
    // redirect. Redirected, the fetch landed on /sign-in as a 404 and the router got stuck; on 401 Next drops the
    // prefetch or falls back to a full navigation, which does the handshake. (QA: "404 /sign-in ← fetch @/settings".)
    if (req.headers.get("rsc") === "1" || req.headers.get("next-router-prefetch")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // The sign-in redirect keeps the referral: the visitor has no session yet, this is the only chance to set it.
    return withRef(redirectToSignIn(), ref);
  },
  { signInUrl: "/sign-in", ...(origin ? { authorizedParties: [origin] } : {}) },
);

export const config = {
  // The service worker, its no-signal page and the icons never go through Clerk (no handshake redirects on them).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js$|offline$|manifest.webmanifest$|icons/).*)"],
};
