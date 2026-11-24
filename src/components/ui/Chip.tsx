"use client";

import type { ButtonHTMLAttributes } from "react";

export function Chip({
  selected,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        "inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-5 text-[18px] font-semibold tabular-nums transition-colors",
        selected
          ? "border-basil bg-basil-soft text-basil-text"
          : "border-line bg-paper text-ink",
        className,
      ].join(" ")}
      {...props}
    >
      {selected && (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
      {children}
    </button>
  );
}
