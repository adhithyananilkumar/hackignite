import type { ButtonHTMLAttributes } from "react";

export function GlassButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`glass-button px-6 py-3 text-sm font-medium cursor-pointer ${className}`}
      {...props}
    />
  );
}
