import type { ReactNode } from "react";

export function StickyNote({
  children,
  signed = false,
  className = "",
}: {
  children: ReactNode;
  signed?: boolean;
  className?: string;
}) {
  return (
    <p
      className={[
        "max-w-[30ch] justify-self-start rounded-sm bg-note px-5 pb-4 pt-3 font-[family-name:var(--font-hand)] text-[28px] leading-tight text-note-ink shadow-[0_18px_40px_-22px_rgba(35,26,20,0.4)] rotate-[-2deg]",
        className,
      ].join(" ")}
    >
      {children}
      {signed && <span className="mt-1 block text-right text-[24px]">— Mama</span>}
    </p>
  );
}
