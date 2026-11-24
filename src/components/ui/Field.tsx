"use client";

import { useId, type ReactNode } from "react";

export const inputClass =
  "h-16 w-full rounded-[18px] border border-ink/25 bg-paper px-5 text-[22px] text-ink placeholder:text-muted/70 focus:border-tomato focus:shadow-[0_0_0_1px_var(--color-tomato)] focus:outline-none! focus-visible:outline-none!";

export function Field({
  label,
  hand = false,
  helper,
  error,
  children,
}: {
  label: string;
  /** The step's main question, in Mama's hand like the Group legends. */
  hand?: boolean;
  helper?: string;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const helperId = helper ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className={hand ? "font-hand text-[30px] font-semibold leading-[1.05] text-ink" : "text-[18px] font-semibold text-ink"}>
        {label}
      </label>
      {children(id, describedBy)}
      {helper && (
        <p id={helperId} className="text-[16px] leading-snug text-muted">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[17px] font-semibold text-tomato">
          {error}
        </p>
      )}
    </div>
  );
}
