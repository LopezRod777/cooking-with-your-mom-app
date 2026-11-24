"use client";

import Image from "next/image";
import { useOffline } from "@/lib/offline/useOffline";
import { ChoppingLoader } from "./ChoppingLoader";
import type { Profile } from "@/lib/schemas";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const offline = useOffline();
  return (
    <Card role="alert" className="grid gap-3">
      <h2 className="font-display text-[28px] leading-tight">Mama is taking a break.</h2>
      <p className="text-[18px] leading-snug text-muted">{message}</p>
      <Button onClick={onRetry} disabled={offline} className="justify-self-start">
        {offline ? "Try again · needs signal" : "Try again"}
      </Button>
    </Card>
  );
}

export function EmptyState({
  profile,
  error,
  onPlan,
}: {
  profile: Profile;
  error: string | null;
  onPlan: () => void;
}) {
  const offline = useOffline();
  return (
    <section className="grid gap-6 pt-6 sm:pt-10">
      <h1 className="font-display text-[44px] leading-[1.05] sm:text-[56px]">
        Let&apos;s plan your <em className="italic text-saffron">week</em>.
      </h1>
      <p className="text-[20px] leading-snug text-muted">
        I&apos;ll pick {profile.daysToPlan} days of high-protein meals around your $
        {profile.weeklyBudgetUsd} budget.
      </p>
      {error ? (
        <ErrorCard message={error} onRetry={onPlan} />
      ) : (
        <Button onClick={onPlan} disabled={offline} fullWidth className="sm:w-auto sm:justify-self-start">
          {offline ? "Plan my week · needs signal" : "Plan my week"}
        </Button>
      )}
    </section>
  );
}

export function GeneratingView({ line }: { line: string }) {
  return (
    <section
      aria-live="polite"
      className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden bg-paper px-6 text-center"
    >
      <Image
        src="/media/kitchen-hands.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-30 blur-[2px]"
      />
      <div className="absolute inset-0 bg-paper/70" aria-hidden="true" />
      <div className="relative grid w-full max-w-md justify-items-center gap-6">
        <h1 className="font-display text-[40px] leading-tight">Mama&apos;s planning…</h1>
        <p key={line} className="rise min-h-[3em] text-[22px] leading-snug text-ink">
          {line}
        </p>
        <ChoppingLoader />
        <p className="text-[18px] text-muted">Usually about a minute.</p>
      </div>
    </section>
  );
}
