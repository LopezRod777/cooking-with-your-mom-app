"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "xl" | "lg" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-transform duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";

const sizes: Record<Size, string> = {
  xl: "h-[60px] px-8 text-[20px]",
  lg: "h-14 px-8 text-[20px]",
  md: "h-12 px-6 text-[18px]",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-tomato text-tomato-ink shadow-[0_10px_24px_-12px_var(--color-tomato)] disabled:bg-line disabled:text-muted disabled:opacity-100 disabled:shadow-none",
  secondary: "bg-saffron-soft text-ink",
  ghost: "border border-ink/25 bg-paper text-ink",
};

export function Button({
  variant = "primary",
  size = "lg",
  fullWidth = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        base,
        sizes[size],
        variants[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
