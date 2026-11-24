const base =
  "inline-flex min-h-12 select-none items-center justify-center gap-2 rounded-full px-6 text-[18px] font-semibold transition-transform duration-150 active:scale-[0.97]";

export const btnPrimary = `${base} bg-tomato text-tomato-ink shadow-[0_10px_24px_-12px_var(--color-tomato)]`;
export const btnSecondary = `${base} bg-saffron-soft text-ink`;
// "Swap" on meal cards: solid saffron so it reads as a button on cream paper (the pale one measured 1.1:1), 48 px tall.
export const btnSwap = `${base} min-h-12 min-w-[96px] bg-saffron text-ink`;
// One soft colour per meal: breakfast yolk, lunch basil, dinner cinnamon, snack blueberry. Text ≥ 4.5:1 on each.
export const SLOT_PILL: Record<"breakfast" | "lunch" | "dinner" | "snack", string> = {
  breakfast: "bg-[#ffe6a3] text-[#5a4200]",
  lunch: "bg-basil-soft text-basil-text",
  dinner: "bg-[#f1cfae] text-[#7a3a10]",
  snack: "bg-[#dfe8f3] text-[#2f4f6f]",
};
export const btnGhost = `${base} border-2 border-line bg-paper text-ink`;
