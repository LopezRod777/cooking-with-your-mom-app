const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅔": 2 / 3,
};

export function parseLeadingQty(display: string): { qty: number; rest: string } | null {
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½⅓¼¾⅔])\s+(.+)$/.exec(display.trim());
  if (!m) return null;
  const token = m[1];
  const rest = m[2].trim();

  let qty: number;
  if (token in UNICODE_FRACTIONS) {
    qty = UNICODE_FRACTIONS[token];
  } else if (token.includes("/")) {
    const mixed = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(token);
    if (!mixed) return null;
    const whole = mixed[1] ? Number(mixed[1]) : 0;
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    qty = whole + num / den;
  } else {
    qty = Number(token);
  }
  return { qty, rest };
}

const FRACTION_CANDIDATES: { value: number; text: string; tolerance: number }[] = [
  { value: 0, text: "", tolerance: 0.04 },
  // 1/8 is only snapped when very close: at 0.04 it would swallow 1.1 as "1 1/8".
  { value: 1 / 8, text: "1/8", tolerance: 0.01 },
  { value: 1 / 4, text: "1/4", tolerance: 0.04 },
  { value: 1 / 3, text: "1/3", tolerance: 0.04 },
  { value: 1 / 2, text: "1/2", tolerance: 0.04 },
  { value: 2 / 3, text: "2/3", tolerance: 0.04 },
  { value: 3 / 4, text: "3/4", tolerance: 0.04 },
];

export function formatQty(n: number): string {
  if (n >= 10) return String(Math.round(n));

  const whole = Math.floor(n);
  const frac = n - whole;

  let nearest = FRACTION_CANDIDATES[0];
  for (const c of FRACTION_CANDIDATES) {
    if (Math.abs(frac - c.value) < Math.abs(frac - nearest.value)) nearest = c;
  }
  // Fraction rounds up to a whole: carry into the whole part.
  if (1 - frac <= 0.04) {
    return formatWhole(whole + 1);
  }

  if (Math.abs(frac - nearest.value) <= nearest.tolerance) {
    if (nearest.text === "") return formatWhole(whole);
    return whole > 0 ? `${whole} ${nearest.text}` : nearest.text;
  }

  const decimal = n.toFixed(1).replace(/\.0$/, "");
  return decimal === "0" ? "1/8" : decimal;
}

function formatWhole(whole: number): string {
  return whole === 0 ? "1/8" : String(whole);
}

const SINGULAR_TO_PLURAL: Record<string, string> = {
  cup: "cups",
  can: "cans",
  clove: "cloves",
  slice: "slices",
  handful: "handfuls",
  scoop: "scoops",
  stalk: "stalks",
  pinch: "pinches",
  egg: "eggs",
  lemon: "lemons",
  lime: "limes",
  tortilla: "tortillas",
  pita: "pitas",
  tomato: "tomatoes",
  onion: "onions",
  pepper: "peppers",
  potato: "potatoes",
  banana: "bananas",
  apple: "apples",
  carrot: "carrots",
};

const PLURAL_TO_SINGULAR: Record<string, string> = Object.fromEntries(
  Object.entries(SINGULAR_TO_PLURAL).map(([s, p]) => [p, s]),
);

function matchCase(original: string, replacement: string): string {
  if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function adjustFirstWord(rest: string, qty2: number): string {
  const space = rest.search(/\s/);
  const word = space === -1 ? rest : rest.slice(0, space);
  const tail = space === -1 ? "" : rest.slice(space);

  const punct = /[,.]+$/.exec(word)?.[0] ?? "";
  const core = word.slice(0, word.length - punct.length);
  const lower = core.toLowerCase();

  let replacement: string | undefined;
  if (qty2 > 1 && lower in SINGULAR_TO_PLURAL) {
    replacement = SINGULAR_TO_PLURAL[lower];
  } else if (qty2 <= 1 && lower in PLURAL_TO_SINGULAR) {
    replacement = PLURAL_TO_SINGULAR[lower];
  }
  if (replacement === undefined) return rest;
  return matchCase(core, replacement) + punct + tail;
}

export function scaleDisplay(display: string, factor: number): string {
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0) return display;
  const parsed = parseLeadingQty(display);
  if (!parsed) return display;

  const qty2 = parsed.qty * factor;
  const head = formatQty(qty2);
  return `${head} ${adjustFirstWord(parsed.rest, qty2)}`;
}
