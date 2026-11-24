"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

// Any render error inside the app shows this instead of a blank page; "Try again" re-renders the segment.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[app] render error", error instanceof Error ? error.message : error);
  }, [error]);

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 py-10">
      <h1 className="text-[32px] leading-[1.1]">Mama dropped a spoon.</h1>
      <p className="text-[18px] text-muted">Something on this screen broke. Your recipes and plan are safe.</p>
      <Button size="xl" fullWidth onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
