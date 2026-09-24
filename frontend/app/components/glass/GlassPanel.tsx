import type { ReactNode } from "react";

export function GlassPanel({
  title,
  children,
  className = "",
  strong = false,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div className={`glass-panel ${strong ? "glass-panel-strong" : ""} p-4 ${className}`}>
      {title && (
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--glass-text-dim)]">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
