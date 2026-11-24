import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { headers } from "next/headers";
import { SessionRetry } from "@/components/auth/SessionRetry";
import { isAdminEmail, requireUser } from "@/lib/auth/requireUser";
import { AppShell } from "@/components/AppShell";
import { ClerkRescue } from "@/components/offline/ClerkRescue";
import { OfflineBoot } from "@/components/offline/OfflineBoot";
import { RememberUser } from "@/components/offline/RememberUser";
import { SessionProvider } from "@/lib/auth/session";
import { SyncBoot } from "@/components/sync/SyncBoot";

async function Gate({ children }: { children: ReactNode }) {
  // Per-request render: requireUser reads the clock for its cache, which prerendering forbids.
  await connection();
  const result = await requireUser();
  if (result instanceof Response) {
    if (result.status === 401) {
      // A router fetch without a session (token rotating): let the client reload once instead of redirecting the
      // fetch to /sign-in, which answered 404 and left the router stuck. Document requests still go to sign-in.
      const h = await headers();
      if (h.get("rsc") === "1" || h.get("next-router-prefetch")) return <SessionRetry />;
      redirect("/sign-in");
    }
    if (result.status === 403) {
      const body = (await result.json().catch(() => null)) as { error?: string } | null;
      redirect(body?.error === "waiting" || body?.error === "blocked" ? "/waitlist" : "/not-invited");
    }
    // Clerk or the database blinked: reload once from the client rather than an error page.
    if (result.status === 503) return <SessionRetry />;
    throw new Error(`requireUser returned unexpected status ${result.status}`);
  }
  return (
    <>
      <SessionProvider>
        <AppShell admin={isAdminEmail(result.email)}>{children}</AppShell>
      </SessionProvider>
      <SyncBoot />
      <RememberUser />
      <ClerkRescue userId={result.userId} />
      <OfflineBoot />
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
