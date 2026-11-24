import { SignOutButton } from "@clerk/nextjs";
import { ForgetOnSignOut } from "@/components/offline/ForgetOnSignOut";
import { currentUser } from "@clerk/nextjs/server";
import Image from "next/image";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RememberUser } from "@/components/offline/RememberUser";
import { StickyNote } from "@/components/ui/StickyNote";
import { requireUser } from "@/lib/auth/requireUser";

// Per-request render inside Suspense: the gate reads the session, which prerendering cannot.
export default function WaitlistPage() {
  return (
    <Suspense fallback={null}>
      <WaitlistGate />
    </Suspense>
  );
}

// The waiting screen says what is true and nothing more: a seat is being saved, the email it will be announced
// to, and that nobody has to check back. No queue position, no counts (jury 15: any number read as fake scarcity).
async function WaitlistGate() {
  await connection();
  const result = await requireUser();
  if (!(result instanceof Response)) redirect("/");
  if (result.status === 401) redirect("/sign-in");
  const body = (await result.json().catch(() => null)) as { error?: string } | null;
  const reason = body?.error ?? "waiting";
  if (reason === "not_invited") redirect("/not-invited");
  const blocked = reason === "blocked";
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
  const link = "min-h-11 inline-flex items-center text-[16px] underline underline-offset-4";
  return (
    <main className="min-h-dvh bg-paper px-4 py-6 lg:flex lg:items-center lg:justify-center lg:px-10 lg:py-16">
      <RememberUser />
      <div className="mx-auto w-full max-w-[960px] lg:grid lg:grid-cols-2 lg:items-center lg:gap-14">
        <div className="relative aspect-[16/11] overflow-hidden rounded-[18px] shadow-[0_24px_60px_-30px_rgba(35,26,20,0.45)] lg:aspect-[4/5]">
          <Image src="/media/saved-seat.jpg" alt="" fill priority sizes="(min-width: 1024px) 480px, 100vw" className="object-cover" />
          {!blocked && (
            <StickyNote signed className="absolute bottom-4 left-4 max-w-[12ch] px-4 pb-3 pt-2 text-[24px]">
              Saving you a seat.
            </StickyNote>
          )}
        </div>
        <div className="mt-6 lg:mt-0 lg:max-w-[520px]">
          <h1 className="font-display text-[34px] leading-[1.15] text-ink lg:text-[44px]">
            {blocked ? "This kitchen isn’t open to you." : "You’re on Mama’s list, honey."}
          </h1>
          {blocked ? (
            <p className="mt-4 text-[18px] leading-relaxed text-ink" data-testid="waitlist-copy">
              Mama’s fixing the kitchen, honey. Come back in a bit.
            </p>
          ) : (
            <>
              {/* Mama's own note: her handwriting, one breath, nothing to do. */}
              <p className="mt-5 font-hand text-[28px] leading-[1.2] text-ink lg:text-[32px]" data-testid="waitlist-copy">
                A few at a time, so everyone gets fed. I’ll write to you{email ? <> at <strong className="font-semibold break-all">{email}</strong></> : null} when your seat’s ready.
                <span className="block pt-1">— Mama</span>
              </p>
              <p className="mt-4 text-[16px] text-muted">Nothing to do now. Check spam if her note doesn’t show.</p>
            </>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">
            {!blocked && (
              <ForgetOnSignOut>
                <SignOutButton redirectUrl="/sign-in">
                <button type="button" className={`${link} text-ink`}>Wrong email? Sign out and sign up again</button>
              </SignOutButton>
              </ForgetOnSignOut>
            )}
            <ForgetOnSignOut>
              <SignOutButton>
              <button type="button" className={`${link} text-muted`}>Sign out</button>
            </SignOutButton>
            </ForgetOnSignOut>
          </div>
        </div>
      </div>
    </main>
  );
}
