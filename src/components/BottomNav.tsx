"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./nav";
import { NavIcon } from "./NavIcon";

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const label = items.length > 5 ? "text-[13px]" : "text-[15px]";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  `relative flex h-14 flex-col items-center justify-center gap-0.5 ${label} font-semibold`,
                  active ? "text-tomato" : "text-muted",
                ].join(" ")}
              >
                <NavIcon name={item.icon} />
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-saffron"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
