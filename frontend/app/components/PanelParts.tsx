import type { ReactNode } from "react";
import type { RiskLevel } from "../lib/api";

export function PanelHeader({
  title,
  subtitle,
  risk,
  badge,
  onBack,
}: {
  title: string;
  subtitle: string;
  risk: RiskLevel;
  badge?: string;
  onBack: () => void;
}) {
  return (
    <div className="border-b border-[#e8eaed] px-5 pb-4 pt-3">
      <button
        onClick={onBack}
        aria-label="Back to overview"
        className="-ml-2 mb-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
        </svg>
      </button>
      <h2 className="text-[22px] font-normal leading-7 text-[#202124]">{title}</h2>
      <div className="mt-0.5 text-sm text-[#70757a]">{subtitle}</div>
      <div className="mt-3 flex items-center gap-2">
        <RiskPill risk={risk} />
        {badge && (
          <span className="rounded-full border border-[#dadce0] px-2.5 py-0.5 text-xs text-[#5f6368]">{badge}</span>
        )}
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[#e8eaed] px-5 py-4 last:border-b-0">
      <h3 className="mb-3 text-[13px] font-medium text-[#202124]">{title}</h3>
      {children}
    </section>
  );
}

const PILL: Record<RiskLevel, { bg: string; fg: string }> = {
  NORMAL: { bg: "#e6f4ea", fg: "#137333" },
  WATCH: { bg: "#fef7e0", fg: "#b06000" },
  ADVISORY: { bg: "#feefe3", fg: "#c26401" },
  HIGH: { bg: "#fce8e6", fg: "#c5221f" },
  CRITICAL: { bg: "#c5221f", fg: "#ffffff" },
};

export function RiskPill({ risk, compact = false }: { risk: RiskLevel; compact?: boolean }) {
  const c = PILL[risk];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-medium ${compact ? "px-2 py-px text-[11px]" : "px-2.5 py-0.5 text-xs"}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {risk.charAt(0) + risk.slice(1).toLowerCase()}
    </span>
  );
}
