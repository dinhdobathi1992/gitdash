"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Button — design contract §5.
 * primary: gradient, one per view · secondary: surface + control border ·
 * ghost: link colour, no border. Icon-only buttons must pass `aria-label`.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:brightness-110 disabled:brightness-100",
  secondary: "bg-surface border border-control text-fg hover:bg-raised",
  ghost: "text-link hover:text-violet-200",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-[13px] gap-2",
  icon: "h-9 w-9 justify-center",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex items-center shrink-0 rounded-control font-semibold whitespace-nowrap transition-colors duration-100",
    "disabled:text-disabled disabled:cursor-not-allowed disabled:hover:bg-surface",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest} />;
});

type LinkButtonProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  external?: boolean;
};

export function LinkButton({ href, variant = "secondary", size = "md", external, className, ...rest }: LinkButtonProps) {
  const cls = buttonClass(variant, size, className);
  if (external) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest} />;
  }
  return <Link href={href} className={cls} {...rest} />;
}
