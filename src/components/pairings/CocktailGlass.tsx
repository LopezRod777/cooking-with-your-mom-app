import type { CocktailGlass as Shape } from "@/lib/pairings/vocab";

// One glass per cocktail shape, read at 56 px. The liquid takes the cocktail's tint; the glass is an outline in currentColor.
// Paths are drawn in a 48 x 64 box: liquid first (clipped to the bowl), then the outline on top.
const SHAPES: Record<Shape, { bowl: string; liquid: string; extra?: string }> = {
  highball: { bowl: "M12 6h24l-2 52H14L12 6z", liquid: "M13.6 24h20.8l-1.3 33H14.9L13.6 24z" },
  rocks: { bowl: "M9 18h30l-2 38H11L9 18z", liquid: "M10.4 30h27.2l-1.3 25.2H11.7L10.4 30z" },
  coupe: { bowl: "M6 10h36c0 12-8 20-18 20S6 22 6 10zM24 30v22M14 56h20", liquid: "M8.6 16h30.8c-1.6 7.6-7.6 12.4-15.4 12.4S10.2 23.6 8.6 16z" },
  flute: { bowl: "M17 4h14l1 30c0 5-3.5 8-8 8s-8-3-8-8l1-30zM24 42v14M15 60h18", liquid: "M18.2 16h11.6l.7 18c0 3.6-2.6 6-6.5 6s-6.5-2.4-6.5-6l.7-18z" },
  wine: { bowl: "M9 6h30c0 16-6 26-15 27S9 22 9 6zM24 33v21M14 58h20", liquid: "M11.4 16h25.2c-.8 10.8-5.2 17-12.6 17S12.2 26.8 11.4 16z" },
  mug: { bowl: "M8 14h26v40H8V14zM34 22h5a5 5 0 0 1 0 10h-5", liquid: "M9.6 24h22.8v28.4H9.6V24z" },
  pint: { bowl: "M11 6h26l-3 52H14L11 6z", liquid: "M13.2 20h21.6l-2 36H15.2l-2-36z", extra: "M14.6 20h18.8" },
};

export function CocktailGlass({ shape, tone, size = 56 }: { shape: Shape; tone: string; size?: number }) {
  const s = SHAPES[shape];
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={(size * 64) / 48}
      viewBox="0 0 48 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={s.liquid} fill={tone} stroke="none" />
      {s.extra && <path d={s.extra} stroke="#fffcf7" strokeWidth={3} opacity={0.9} />}
      <path d={s.bowl} />
    </svg>
  );
}

export const GLASS_LABEL: Record<Shape, string> = {
  highball: "Tall glass",
  rocks: "Rocks glass",
  coupe: "Coupe",
  flute: "Flute",
  wine: "Wine glass",
  mug: "Mug",
  pint: "Pint glass",
};
