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
        <div className="mb-3 text-[15px] font-medium text-[var(--glass-text)]">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
