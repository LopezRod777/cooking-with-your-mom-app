export const NAV_ITEMS = [
  { href: "/", label: "Week", icon: "calendar" },
  { href: "/shop", label: "Shop", icon: "basket" },
  { href: "/favorites", label: "Favorites", icon: "heart" },
  { href: "/community", label: "Community", icon: "bubble" },
  { href: "/pets", label: "Pets", icon: "paw" },
  { href: "/settings", label: "Settings", icon: "gear" },
] as const;

export type NavIcon = (typeof NAV_ITEMS)[number]["icon"] | "glass" | "door";
export type NavItem = { href: string; label: string; icon: NavIcon };

// Desktop rail: always listed (the page itself holds the 21+ gate). Bottom bar: only while the gate is open.
export const PAIRINGS_NAV_ITEM: NavItem = { href: "/pairings", label: "Pairings", icon: "glass" };

// The tabs a person sees. Pets hides on "no pets at home" (hasPets === false) or "don't cook for them"
// (cookForPets === false); null (not asked) keeps it. Pairings goes in before Settings when `pairings` is true.
export function navItems({
  hasPets,
  cookForPets = null,
  pairings,
}: {
  hasPets: boolean | null;
  cookForPets?: boolean | null;
  pairings: boolean;
}): NavItem[] {
  const out: NavItem[] = [];
  for (const item of NAV_ITEMS) {
    if (item.href === "/pets" && (hasPets === false || cookForPets === false)) continue;
    if (item.href === "/settings" && pairings) out.push(PAIRINGS_NAV_ITEM);
    out.push(item);
  }
  return out;
}
