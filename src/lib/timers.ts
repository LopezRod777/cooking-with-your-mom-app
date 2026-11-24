// Cook-mode timers. Wall-clock based: each timer stores when it ends, so a
// locked phone or a reload still shows the right time left.

export type Timer = { endsAt: number; totalSeconds: number; label: string };
export type Timers = Record<string, Timer>;

export const TIMERS_STORAGE_KEY = "cwym:timers";

export function timerKey(recipeId: string, stepIndex: number): string {
  return `${recipeId}:${stepIndex}`;
}

// Pure: returns a new map with the timer added (or replaced).
export function startTimer(
  timers: Timers,
  key: string,
  totalSeconds: number,
  label: string,
  now: number,
): Timers {
  return {
    ...timers,
    [key]: { endsAt: now + totalSeconds * 1000, totalSeconds, label },
  };
}

// Pure: returns a new map without the timer.
export function cancelTimer(timers: Timers, key: string): Timers {
  const { [key]: _removed, ...rest } = timers;
  return rest;
}

// Whole seconds left, rounded up, never negative.
export function remaining(timer: Timer, now: number): number {
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function isDone(timer: Timer, now: number): boolean {
  return now >= timer.endsAt;
}

export function formatMMSS(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Reads timers from sessionStorage. Never throws; drops malformed entries.
export function readTimers(): Timers {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.sessionStorage.getItem(TIMERS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Timers = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as Timer).endsAt === "number" &&
        typeof (value as Timer).totalSeconds === "number" &&
        typeof (value as Timer).label === "string"
      ) {
        out[key] = value as Timer;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeTimers(timers: Timers): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(timers));
  } catch {
    // Storage can be blocked (private mode). Timers still work in memory.
  }
}

// This recipe's timers that are still counting down, soonest first. `index` is the step.
export function runningTimersFor(
  timers: Timers,
  recipeId: string,
  now: number,
): { index: number; timer: Timer }[] {
  const prefix = `${recipeId}:`;
  return Object.entries(timers)
    .filter(([k, t]) => k.startsWith(prefix) && !isDone(t, now))
    .map(([k, timer]) => ({ index: Number(k.slice(prefix.length)), timer }))
    .sort((a, b) => a.timer.endsAt - b.timer.endsAt);
}

// Drops this recipe's timers that have already finished. Running ones stay.
export function cancelFinishedFor(timers: Timers, recipeId: string, now: number): Timers {
  const prefix = `${recipeId}:`;
  return Object.entries(timers).reduce<Timers>((acc, [k, t]) => {
    if (k.startsWith(prefix) && isDone(t, now)) return acc;
    acc[k] = t;
    return acc;
  }, {});
}
