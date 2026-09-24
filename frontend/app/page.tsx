import Link from "next/link";
import { GlassPanel } from "./components/glass/GlassPanel";

export default function Landing() {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-[#060b10]">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, rgba(53,194,240,0.25), transparent 45%), radial-gradient(circle at 75% 70%, rgba(255,59,59,0.15), transparent 50%), linear-gradient(180deg, #060b10 0%, #0a141c 60%, #0f1c26 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 38px, rgba(255,255,255,0.6) 39px), repeating-linear-gradient(90deg, transparent, transparent 38px, rgba(255,255,255,0.6) 39px)",
        }}
      />

      <GlassPanel strong className="relative z-10 flex flex-col items-center gap-6 px-12 py-14 text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-[var(--glass-text-dim)]">
          Kerala Flood Intelligence &amp; Early Warning
        </div>
        <h1 className="text-5xl font-semibold tracking-tight">VARUNA</h1>
        <p className="max-w-md text-sm leading-6 text-[var(--glass-text-dim)]">
          Fuses live rainfall, river, reservoir and terrain signals across Kerala into
          one continuously updated picture of flood risk — a decision-support layer
          above IMD, CWC, KSDMA and KSEB, not a replacement for them.
        </p>
        <Link
          href="/command"
          className="glass-button mt-2 px-8 py-3 text-sm font-semibold tracking-wide"
        >
          Open VARUNA →
        </Link>
      </GlassPanel>

      <div className="relative z-10 mt-6 text-[11px] text-[var(--glass-text-dim)]">
        HACKIGNITE&apos;26 · IEDC GPTC PALA
      </div>
    </div>
  );
}
