"use client";

import { useEffect, useMemo, useState } from "react";
import { isWeekSaved, saveWeek, weekMedia } from "@/lib/offline/save";
import { useOffline } from "@/lib/offline/useOffline";
import type { AppState } from "@/lib/schemas";

type Phase = { kind: "checking" | "idle" | "saved" | "failed" } | { kind: "saving"; done: number; total: number };

const isIphoneTab = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;

// "Save this week for offline": photos and clips on the phone. The check mark reads the real cache, so a new week or a
// cleared browser shows the button again.
export function SaveOffline({ state }: { state: AppState }) {
  const offline = useOffline();
  const media = useMemo(() => weekMedia(state), [state]);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  useEffect(() => {
    let gone = false;
    isWeekSaved(media)
      .then((saved) => {
        if (!gone) setPhase((p) => (p.kind === "saving" ? p : { kind: saved ? "saved" : "idle" }));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [media]);

  if (phase.kind === "checking" || (offline && phase.kind !== "saved")) return null;

  async function save() {
    setPhase({ kind: "saving", done: 0, total: 0 });
    const ok = await saveWeek(media, (done, total) => setPhase({ kind: "saving", done, total })).catch(() => false);
    setPhase({ kind: ok ? "saved" : "failed" });
  }

  if (phase.kind === "saved") {
    return (
      <p role="status" data-testid="offline-saved" className="inline-flex min-h-12 flex-wrap items-center gap-x-2 text-[16px] font-semibold text-basil-text">
        Saved for offline ✓
        {isIphoneTab() && <span className="font-normal text-muted">On iPhone, Share → Add to Home Screen keeps it there.</span>}
      </p>
    );
  }
  return (
    <button
      type="button"
      data-testid="save-offline"
      disabled={phase.kind === "saving"}
      onClick={() => void save()}
      className="inline-flex min-h-12 items-center rounded-full border-2 border-line px-4 text-[16px] font-semibold disabled:opacity-70"
    >
      {phase.kind === "saving"
        ? phase.total > 0
          ? `Saving ${phase.done} of ${phase.total}…`
          : "Saving…"
        : phase.kind === "failed"
          ? "Some didn’t save. Try again"
          : "Save this week for offline"}
    </button>
  );
}
