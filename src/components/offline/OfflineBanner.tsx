"use client";

import { useAppState, useSync } from "@/lib/useAppState";
import { useOffline } from "@/lib/offline/useOffline";

export function OfflineBanner() {
  const offline = useOffline();
  const sync = useSync();
  const [, , , saveError] = useAppState();
  // Fixed: it has to be seen from the middle of the list.
  const full = saveError && sync.dirty && (
    <p role="alert" data-testid="device-full" className="fixed inset-x-3 top-[84px] z-[65] rounded-[20px] border-2 border-tomato bg-paper px-5 py-3 text-[17px] font-semibold leading-snug text-ink shadow-xl sm:left-auto sm:w-[420px]">
      This device is full: your last change isn&apos;t saved here. Keep this page open until you have signal.
    </p>
  );
  // "offline" also covers a page that arrived while its data or Clerk did not.
  if (!offline && sync.status !== "offline") return full || null;
  return (
    <>
      {full}
      <p role="status" data-testid="offline-banner" className="mb-5 rounded-2xl border border-line bg-panel px-5 py-3 text-[17px] leading-snug">
        <span className="font-semibold">No signal, honey. Here&apos;s your saved week.</span>
        {sync.dirty && !saveError && <span className="text-muted"> Your changes are on this device and go up when it&apos;s back.</span>}
      </p>
    </>
  );
}
