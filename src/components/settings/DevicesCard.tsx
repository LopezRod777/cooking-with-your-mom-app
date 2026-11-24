"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Button } from "../ui/Button";
import { ChoiceTile } from "../ui/Choice";
import { CONNECTABLE, DEVICE_BRANDS, DEVICE_LABELS, type DeviceBrand, type WellnessSummary } from "@/lib/wellness/db";

// Brand marks from simple-icons 16.36.0 (CC0), tinted with the tile's text color. Oura, WHOOP and Withings are not in
// that set and we do not redraw trademarks, so their tiles carry the name only.
const BRAND_MARK: Partial<Record<DeviceBrand, string>> = {
  apple_watch: "/media/brands/apple.svg",
  fitbit: "/media/brands/fitbit.svg",
  garmin: "/media/brands/garmin.svg",
  samsung: "/media/brands/samsung.svg",
};

type Loaded = { summary: WellnessSummary; device: { brand: DeviceBrand; status: "chosen" | "connected" } | null };

// "Your ring or band": pick the brand, share an export today (file), connect by OAuth later for Oura / WHOOP /
// Withings. Everything shown comes from /api/wellness, never from the synced app state.
export function DevicesCard() {
  const [data, setData] = useState<Loaded | "not_migrated" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Only once Clerk has its session on the client: a fetch fired at mount, before that, sat in a handshake and
  // never answered (the same hang the admin check had). One retry covers a slow first answer.
  const { isLoaded, isSignedIn } = useAuth();

  async function load() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/wellness", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const j = (await res.json()) as Loaded | { pending: true };
        return setData("pending" in j ? "not_migrated" : j);
      } catch {
        // timed out or offline: try once more, then leave the card loading quietly
      }
    }
  }
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [isLoaded, isSignedIn]);

  async function post(body: unknown): Promise<Response> {
    return fetch("/api/wellness", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  async function choose(brand: DeviceBrand | null) {
    setBusy(true);
    await post({ kind: "device", brand }).catch(() => null);
    await load();
    setBusy(false);
  }

  async function upload(file: File) {
    setBusy(true);
    setNote(null);
    const text = await file.text();
    const res = await post({ kind: "upload", text }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { saved?: number; skipped?: number; error?: string } | null;
    if (res?.ok && j) setNote(`Got ${j.saved} day${j.saved === 1 ? "" : "s"}${j.skipped ? `, skipped ${j.skipped} row${j.skipped === 1 ? "" : "s"} Mama couldn’t read` : ""}.`);
    else if (res?.status === 422) setNote("Mama couldn’t find a date with weight, sleep or resting heart rate in that file. Try the CSV export of your app.");
    else setNote("That didn’t go through. Try again in a minute.");
    await load();
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function wipe() {
    setBusy(true);
    await fetch("/api/wellness", { method: "DELETE" }).catch(() => null);
    setNote("Gone. Mama keeps nothing from your device now.");
    setData((d) => (d && d !== "not_migrated" ? { ...d, summary: { ...d.summary, days: 0 } } : d));
    await load();
    setBusy(false);
  }

  if (data === null) return <p className="text-[17px] text-muted">Loading…</p>;
  if (data === "not_migrated") {
    return <p data-testid="devices-pending" className="text-[17px] text-muted">Devices aren’t switched on in this kitchen yet.</p>;
  }
  const { summary, device } = data;
  const brand = device?.brand ?? null;
  return (
    <div data-testid="devices-card" className="grid gap-5">
      <p className="text-[18px] leading-snug">
        Share it with Mama. She sees how you’re sleeping and how your weight moves, and adjusts your plates.
        <span className="block text-[16px] text-muted">Only those numbers, 90 days, gone when you say.</span>
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {DEVICE_BRANDS.map((b) => (
          <ChoiceTile key={b} compact selected={brand === b} onClick={() => void choose(brand === b ? null : b)}>
            <span className="inline-flex items-center gap-2">
              {BRAND_MARK[b] && (
                <span
                  aria-hidden="true"
                  className="inline-block h-[22px] w-[22px] shrink-0 bg-current"
                  style={{ WebkitMaskImage: `url(${BRAND_MARK[b]})`, maskImage: `url(${BRAND_MARK[b]})`, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center" }}
                />
              )}
              {DEVICE_LABELS[b]}
            </span>
          </ChoiceTile>
        ))}
      </div>
      {brand && (
        <div className="grid gap-3 rounded-[20px] border border-line bg-panel p-5">
          {CONNECTABLE.includes(brand) ? (
            <p className="text-[17px] leading-snug">
              <strong className="font-semibold">{DEVICE_LABELS[brand]}</strong> can connect directly. That switch isn’t on yet; until then, share an export below and Mama reads it the same way.
            </p>
          ) : (
            <p className="text-[17px] leading-snug">
              <strong className="font-semibold">{DEVICE_LABELS[brand]}</strong> doesn’t let a website read it directly. Export a week or more from its app (CSV or JSON) and drop the file here.
            </p>
          )}
          <label className="inline-flex min-h-12 w-fit cursor-pointer items-center rounded-full border border-ink/25 bg-white px-5 text-[17px] font-semibold text-ink">
            {busy ? "Reading…" : "Share an export file"}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json,text/plain"
              data-testid="wellness-file"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
        </div>
      )}
      {note && (
        <p role="status" data-testid="wellness-note" className="text-[17px] text-ink">
          {note}
        </p>
      )}
      {summary.days > 0 && (
        <div data-testid="wellness-summary" className="grid gap-1 text-[17px]">
          <p className="font-semibold">What Mama sees</p>
          <p className="text-muted">
            {summary.sleep7 !== null ? `Last nights: ${summary.sleep7} h of sleep on average` : "No sleep yet"}
            {summary.latestWeight ? ` · weight ${summary.latestWeight.kg} kg on ${summary.latestWeight.day}` : ""}
            {summary.restingHr7 !== null ? ` · resting heart rate ${summary.restingHr7}` : ""}
            {` · ${summary.days} day${summary.days === 1 ? "" : "s"} shared`}
          </p>
          <div>
            <Button variant="ghost" size="md" onClick={() => void wipe()} disabled={busy}>
              Delete what I shared
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
