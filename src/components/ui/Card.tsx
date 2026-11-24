import type { HTMLAttributes } from "react";

export function Card({
  tone = "paper",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: "paper" | "panel" }) {
  return (
    <div
      className={[
        "rounded-[24px] border border-line p-6",
        tone === "paper" ? "bg-paper" : "bg-panel",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
