"use client";

export function Stepper({
  value,
  min,
  max,
  step = 1,
  prefix = "",
  suffix = "",
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  onChange: (next: number) => void;
}) {
  const btn =
    "flex h-14 w-14 flex-none select-none items-center justify-center rounded-full border border-ink/30 bg-paper text-[28px] font-semibold leading-none text-ink transition duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35";
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        className={btn}
        aria-label={`Less ${label}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        −
      </button>
      <output
        aria-live="polite"
        aria-label={label}
        className="min-w-[104px] text-center font-[family-name:var(--font-display)] text-[40px] leading-none tabular-nums text-ink"
      >
        {prefix}
        {value}
        {suffix ? <span className="ml-1 font-[family-name:var(--font-body)] text-[20px] font-semibold text-muted">{suffix}</span> : null}
      </output>
      <button
        type="button"
        className={btn}
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  );
}
