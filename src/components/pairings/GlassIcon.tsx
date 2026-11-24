import type { WineColor } from "@/lib/pairings/vocab";

// Liquid colors are plain tints for the wine family, not brand colors. Without a tone the glass is an outline icon
// that takes currentColor, which is how the rail uses it.
const TINT: Record<WineColor | "beer" | "cocktail" | "zero", string> = {
  red: "#7a1f2b",
  white: "#e8d98a",
  rose: "#e7a0a0",
  sparkling: "#f3ead0",
  orange: "#d7893b",
  beer: "#d9a441",
  cocktail: "#e0683f",
  zero: "#9bb5a0",
};

export type GlassTone = keyof typeof TINT;

export function GlassIcon({ tone, size = 22 }: { tone?: GlassTone; size?: number }) {
  // A wine bottle read at 22 px: foil capsule, long narrow neck, sloped shoulders, straight body with a label.
  // With a tone the whole silhouette fills with the wine's tint and the label stays cream.
  const silhouette =
    "M10.5 2.2V8.2C10.5 9.9 8 10.6 8 12.6V20.4a1.3 1.3 0 0 0 1.3 1.3h5.4a1.3 1.3 0 0 0 1.3-1.3V12.6C16 10.6 13.5 9.9 13.5 8.2V2.2Z";
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {tone && <path d={silhouette} fill={TINT[tone]} stroke="none" />}
      <path d={silhouette} />
      <path d="M10.5 4.6h3" />
      <rect x="9.6" y="14.2" width="4.8" height="3.6" rx="0.5" fill={tone ? "#f7f0e4" : "none"} />
    </svg>
  );
}
