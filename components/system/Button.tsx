"use client";

import { forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  // Gradient endpoints are the audited pair (see scripts/check-contrast.mjs):
  // white text passes 4.5:1 on both.
  primary:
    "bg-gradient-to-b from-primary to-primary-deep text-white shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:shadow-[0_6px_22px_-6px_rgb(220_38_38/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 active:brightness-100 disabled:opacity-50 disabled:pointer-events-none",
  secondary:
    "bg-inset text-mid border border-line-2 hover:text-hi hover:border-line-strong disabled:opacity-50 disabled:pointer-events-none",
  ghost:
    "bg-transparent text-mut hover:text-hi hover:bg-white/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:pointer-events-none",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[13px] gap-1.5",
  md: "px-4 py-2.5 text-sm gap-2",
};

/** The one button style. Rounded, red gradient primary, quiet secondary. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={`inline-flex items-center justify-center font-semibold rounded-[10px] transition-all duration-150 hover:-translate-y-px active:translate-y-0 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export default Button;
