"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { flush, getIdentity, readLastUser, setIdentity } from "@/lib/store";
import { useSync } from "@/lib/useAppState";
import { Button } from "../ui/Button";
import { StickyNote } from "../ui/StickyNote";

// Feeds Clerk's identity into the store, and shows the two screens that need a decision:
// a conflict between devices and the one-time migration of pre-accounts data.
export function SyncBoot() {
  const { isLoaded, userId } = useAuth();
  const sync = useSync();

  useEffect(() => {
    if (!isLoaded) return;
    setIdentity(userId ?? null);
    // The store let go (another tab signed out or changed account) and since then this same person is back.
    const back = () => {
      if (userId && getIdentity() === null && readLastUser() === userId) setIdentity(userId);
    };
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [isLoaded, userId]);

  useEffect(() => {
    const onHide = () => {
      void flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  if (sync.migration) return <MigrationScreen onDecide={sync.decideMigration} />;
  if (sync.conflict) return <ConflictBar local={sync.conflict.local === true} onResolve={sync.resolveConflict} />;
  if (sync.status === "error") return <ErrorBar onRetry={sync.retry} />;
  return null;
}

function MigrationScreen({ onDecide }: { onDecide: (use: boolean) => void }) {
  // Resolved after mount so the server and first client render agree; "phone" only on touch mobiles.
  const [device, setDevice] = useState("device");
  useEffect(() => {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
    setDevice(mobile ? "phone" : "computer");
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cwym-migration-title"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-paper p-5 sm:items-center"
    >
      <div className="grid w-full max-w-md gap-6">
        <StickyNote signed>I kept the week you planned on this {device}, honey.</StickyNote>
        <h1 id="cwym-migration-title" className="font-display text-[40px] leading-[1.05]">
          Bring it into your account?
        </h1>
        <div className="grid gap-3">
          <Button fullWidth onClick={() => onDecide(true)}>
            Yes, use it
          </Button>
          <Button fullWidth variant="ghost" onClick={() => onDecide(false)}>
            Start fresh
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConflictBar({ local, onResolve }: { local: boolean; onResolve: (choice: "theirs" | "mine") => void }) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="cwym-conflict-title"
      className="fixed inset-x-3 bottom-24 z-[60] grid gap-4 rounded-[20px] border border-line bg-paper p-5 shadow-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[420px] lg:bottom-8"
    >
      <p id="cwym-conflict-title" className="text-[20px] font-semibold leading-snug">
        Another {local ? "tab" : "device"} changed this week.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button size="md" onClick={() => onResolve("theirs")}>
          Use that version
        </Button>
        <Button size="md" variant="ghost" onClick={() => onResolve("mine")}>
          Keep this one
        </Button>
      </div>
    </div>
  );
}

function ErrorBar({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-[60] flex items-center justify-between gap-4 rounded-[20px] border border-line bg-paper px-5 py-4 shadow-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[420px] lg:bottom-8"
    >
      <p className="text-[17px] leading-snug">Couldn&apos;t sync. Saved on this device.</p>
      <Button size="md" variant="ghost" onClick={() => void onRetry()}>
        Retry
      </Button>
    </div>
  );
}
