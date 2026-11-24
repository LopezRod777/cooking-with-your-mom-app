"use client";

import type { ButtonHTMLAttributes } from "react";

type Tone = "ink" | "tomato";

/** Large selectable tile. Unselected = paper + hairline; selected = filled. */
export function ChoiceTile({
  selected,
  tone = "ink",
  compact = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected: boolean;
  tone?: Tone;
  /** Centered label, check tucked in the corner. For narrow 3-up rows. */
  compact?: boolean;
}) {
  const on =
    tone === "tomato"
      ? "border-tomato bg-tomato text-tomato-ink"
      : "border-ink bg-ink text-paper";
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        "relative flex min-h-14 select-none items-center rounded-2xl border px-4 py-2 text-left text-[18px] font-semibold leading-tight tabular-nums transition duration-150 active:scale-[0.98]",
        compact ? "justify-center text-center" : "justify-between gap-2",
        selected ? on : "border-line bg-paper text-ink",
        className,
      ].join(" ")}
      {...props}
    >
      <span className="min-w-0">{children}</span>
      {selected && (
        <svg
          aria-hidden="true"
          width={compact ? 13 : 18}
          height={compact ? 13 : 18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={compact ? "absolute right-2 top-2" : "flex-none"}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </button>
  );
}
