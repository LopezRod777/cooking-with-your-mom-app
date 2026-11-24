import type { NavIcon as Name } from "./nav";
import { GlassIcon } from "./pairings/GlassIcon";

export function NavIcon({ name, size = 22 }: { name: Name | "flame"; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    case "basket":
      return (
        <svg {...common}>
          <path d="M3.5 10h17l-1.8 9a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6L3.5 10z" />
          <path d="M8 10l3.2-5.5M16 10l-3.2-5.5M9 14v3M12 14v3M15 14v3" />
        </svg>
      );
    case "heart":
      return (
        <svg {...common}>
          <path d="M12 20s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />
        </svg>
      );
    case "flame":
      return (
        <svg {...common}>
          <path d="M12 3c.5 3-1.5 4.5-3 6.5-1.3 1.7-2 3.3-2 5a5 5 0 0 0 10 0c0-2.2-1.2-3.6-2.3-5-.6 1.4-1.4 2-2.2 2.2C13.2 8.5 13 5.5 12 3z" />
        </svg>
      );
    case "paw":
      return (
        <svg {...common}>
          <path d="M12 12.6c-2.7 0-5.2 2.9-5.2 5 0 1.7 1.2 2.6 2.6 2.6 1.1 0 1.7-.6 2.6-.6s1.5.6 2.6.6c1.4 0 2.6-.9 2.6-2.6 0-2.1-2.5-5-5.2-5z" />
          <ellipse cx="5.6" cy="10.2" rx="1.7" ry="2.2" />
          <ellipse cx="9.4" cy="5.8" rx="1.7" ry="2.2" />
          <ellipse cx="14.6" cy="5.8" rx="1.7" ry="2.2" />
          <ellipse cx="18.4" cy="10.2" rx="1.7" ry="2.2" />
        </svg>
      );
    case "glass":
      return <GlassIcon size={size} />;
    case "bubble":
      return (
        <svg {...common}>
          <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-5.5L7.5 19.4V16H7a2.5 2.5 0 0 1-2.5-2.5z" />
          <path d="M8.5 9.5h7M8.5 12.5h4.5" />
        </svg>
      );
    case "door":
      return (
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
          <path d="M3 21h18" />
          <path d="M12 3v18" />
          <circle cx="9.5" cy="12.5" r="0.8" fill="currentColor" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </svg>
      );
  }
}
