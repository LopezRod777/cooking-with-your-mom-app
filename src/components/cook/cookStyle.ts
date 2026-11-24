import type { CSSProperties } from "react";

// Cook mode is always the warm dark screen, whatever the OS theme is.
// Re-declaring the tokens on the overlay makes every ui/* component inherit them.
export const COOK_TOKENS = {
  "--color-paper": "#15110e",
  "--color-panel": "#221b16",
  "--color-ink": "#f6ede2",
  "--color-muted": "#bfae9d",
  "--color-line": "#342a23",
  "--color-tomato": "#ff6a4f",
  "--color-tomato-ink": "#1f0d08",
  "--color-saffron-soft": "#3a2c10",
  "--color-note": "#4a3a10",
  "--color-note-ink": "#ffe9a6",
} as CSSProperties;
