"use client";

export function HeartButton({
  pressed,
  onToggle,
  className = "",
}: {
  pressed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label="Favorite"
      onClick={onToggle}
      className={[
        "flex h-12 w-12 flex-none items-center justify-center rounded-full bg-paper/95 text-tomato shadow-[0_8px_18px_-10px_rgba(42,23,48,0.6)] transition-transform active:scale-[0.94]",
        className,
      ].join(" ")}
    >
      <svg
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill={pressed ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 20.2s-7.6-4.5-7.6-10.1a4.3 4.3 0 0 1 7.6-2.7 4.3 4.3 0 0 1 7.6 2.7c0 5.6-7.6 10.1-7.6 10.1z" />
      </svg>
    </button>
  );
}
