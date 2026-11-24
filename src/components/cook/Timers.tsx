"use client";

import type { ReactNode } from "react";
import { formatMMSS, isDone, remaining, type Timer } from "@/lib/timers";
import { Button } from "@/components/ui/Button";
import { momTimerLine } from "@/lib/stepAction";

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Red ring. `elapsed` 0 = just started, 1 = done (ring full).
export function TimerRing({ elapsed, children }: { elapsed: number; children: ReactNode }) {
  const clamped = Math.min(1, Math.max(0, elapsed));
  return (
    <div className="relative h-44 w-44 flex-none lg:h-52 lg:w-52">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="9" className="stroke-line" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className="stroke-tomato transition-[stroke-dashoffset] duration-300 ease-linear"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

// Timer block shown on a step that has timerSeconds.
export function StepTimer({
  totalSeconds,
  timer,
  now,
  onStart,
  onDismiss,
}: {
  totalSeconds: number;
  timer: Timer | undefined;
  now: number | null;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const done = timer !== undefined && now !== null && isDone(timer, now);
  const left = timer && now !== null ? remaining(timer, now) : totalSeconds;
  const elapsed =
    done ? 1 : timer && now !== null ? 1 - (timer.endsAt - now) / (timer.totalSeconds * 1000) : 0;
  const leftFraction = 1 - elapsed;

  return (
    <section className="grid justify-items-center gap-5 rounded-[24px] border border-line bg-panel p-5 lg:p-6">
      <TimerRing elapsed={elapsed}>
        {done ? (
          <p className="font-display text-[44px] leading-none">Done!</p>
        ) : (
          <p data-testid="timer-left" className="font-display text-[44px] leading-none tabular-nums">
            {formatMMSS(left)}
          </p>
        )}
      </TimerRing>
      {timer && (
        <p
          data-testid="timer-line"
          className="font-[family-name:var(--font-hand)] text-center text-[28px] leading-tight text-note-ink"
        >
          {momTimerLine(leftFraction, done)}
        </p>
      )}
      {!timer && (
        <Button fullWidth onClick={onStart}>
          Start timer
        </Button>
      )}
      {done && (
        <Button fullWidth onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </section>
  );
}

// Slim bar with the other timers of this recipe. Tap one to jump to its step.
export function TimerBar({
  items,
  now,
  onJump,
}: {
  items: { index: number; timer: Timer }[];
  now: number | null;
  onJump: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Other timers" className="flex flex-wrap gap-2">
      {items.map(({ index, timer }) => {
        const done = now !== null && isDone(timer, now);
        const text = done
          ? "Done!"
          : `${formatMMSS(now === null ? timer.totalSeconds : remaining(timer, now))} left`;
        return (
          <li key={index}>
            <button
              type="button"
              onClick={() => onJump(index)}
              className="inline-flex min-h-12 items-center rounded-full bg-note px-4 text-[17px] font-semibold text-note-ink"
            >
              {timer.label}: {text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
