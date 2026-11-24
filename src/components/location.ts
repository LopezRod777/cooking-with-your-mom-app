import type { Location, SavedLocation } from "@/lib/schemas";

export const LOCATION_ERROR =
  "Mama needs a ZIP, or a city with its state.";

export const MAX_SAVED_LOCATIONS = 5;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC", "puerto rico": "PR",
};

// Forgiving on purpose (2026-11-04: friends typed "Cambridge MA", "Boston, Massachusetts", "02141 Cambridge" and got
// stuck). Accepts: a 5-digit ZIP anywhere in the text (ZIP+4 too); "City, ST"; "City ST"; "City, State Name";
// a trailing "USA" / "US" is ignored. A city alone is still null: the state is needed to place it.
export function parseLocation(input: string): Location | null {
  let text = input.trim().replace(/\s+/g, " ").replace(/[.,]?\s*(usa|u\.s\.a\.|us|united states)\s*$/i, "");
  const zip = text.match(/(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/);
  if (zip) return { label: `ZIP ${zip[1]}`, zip: zip[1] };
  text = text.replace(/,\s*$/, "");
  const m = text.match(/^([A-Za-z][A-Za-z .'-]*?)[,\s]+([A-Za-z][A-Za-z ]*)$/);
  if (!m) return null;
  const rawState = m[2].trim();
  const state = /^[A-Za-z]{2}$/.test(rawState) ? rawState.toUpperCase() : STATE_NAMES[rawState.toLowerCase()];
  if (!state) return null;
  const city = titleCase(m[1].replace(/[\s,]+$/, ""));
  if (city.length < 2) return null;
  return { label: `${city}, ${state}`, city, state };
}

/** Active id after removing `removedId`. `saved` is the list BEFORE the removal: the next one takes its place, or the previous one at the end. */
export function nextActive(
  saved: readonly SavedLocation[],
  removedId: string,
  activeId: string | undefined,
): string | undefined {
  if (activeId !== removedId) return activeId;
  const idx = saved.findIndex((s) => s.id === removedId);
  const remaining = saved.filter((s) => s.id !== removedId);
  if (remaining.length === 0) return undefined;
  return remaining[Math.min(Math.max(idx, 0), remaining.length - 1)].id;
}

/** The `location` field (old single-location shape) mirrored from the active saved place. */
export function mirrorLocation(
  saved: readonly SavedLocation[],
  activeId: string | undefined,
): Location | null {
  const active = saved.find((s) => s.id === activeId);
  if (!active) return null;
  const loc: Location = { label: active.label };
  if (active.zip !== undefined) loc.zip = active.zip;
  if (active.city !== undefined) loc.city = active.city;
  if (active.state !== undefined) loc.state = active.state;
  return loc;
}

/** "loc_" + 8 base36 characters. */
export function newLocationId(rand: () => number = Math.random): string {
  let s = "";
  while (s.length < 8) s += Math.floor(rand() * 36).toString(36);
  return `loc_${s}`;
}

export function milesText(miles: number): string {
  return `${miles} ${miles === 1 ? "mile" : "miles"}`;
}
