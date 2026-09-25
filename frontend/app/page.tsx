"use client";

import Image from "next/image";
import Link from "next/link";
import { MonsoonAtmosphere } from "./components/MonsoonAtmosphere";

export default function Landing() {
  return (
    <main className="relative flex h-screen w-screen flex-col justify-between overflow-hidden bg-[#050B0F] p-6 sm:p-10 select-none text-[#E8EEF2]">
      {/* --- LAYER 1: REALISTIC AERIAL KERALA MONSOON LANDSCAPE --- */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <Image
          src="/kerala_monsoon_bg.jpg"
          alt="Kerala Western Ghats monsoon terrain and reservoir"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center scale-[1.02] brightness-[0.88] contrast-[1.04] saturate-[0.95]"
        />
      </div>

      {/* --- LAYER 2: CINEMATIC ATMOSPHERIC OVERLAYS & TEXT CONTRAST --- */}
      {/* 2a. Soft radial vignette — maintains clear text readability while keeping the scenery visible */}
      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(5, 11, 15, 0.55) 0%, rgba(5, 11, 15, 0.22) 50%, rgba(5, 11, 15, 0.65) 100%)",
        }}
        aria-hidden="true"
      />

      {/* 2b. Subtle edge protection gradients for header and footer */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-32 z-[1]"
        style={{
          background:
            "linear-gradient(180deg, rgba(5, 11, 15, 0.82) 0%, rgba(5, 11, 15, 0.3) 60%, transparent 100%)",
        }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 h-28 z-[1]"
        style={{
          background:
            "linear-gradient(0deg, rgba(5, 11, 15, 0.88) 0%, rgba(5, 11, 15, 0.3) 60%, transparent 100%)",
        }}
        aria-hidden="true"
      />

      {/* --- LAYER 3: DYNAMIC MONSOON MIST, CONTOUR HINTS & RAIN --- */}
      <MonsoonAtmosphere />

      {/* Subtle corner technical registration crosses */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 font-mono text-[10px] text-[#2F4452] opacity-75">
        +
      </div>
      <div className="pointer-events-none absolute right-4 top-4 z-10 font-mono text-[10px] text-[#2F4452] opacity-75">
        +
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 font-mono text-[10px] text-[#2F4452] opacity-75">
        +
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-[10px] text-[#2F4452] opacity-75">
        +
      </div>

      {/* --- LAYER 4: VARUNA INTERACTION & HERO CONTENT --- */}
      {/* TOP BAR */}
      <header className="relative z-10 flex items-start justify-between">
        {/* Brand identity */}
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-[0.24em] text-[#E8EEF2]">
            VARUNA
          </span>
          <span className="mt-0.5 text-[9px] sm:text-[10px] font-medium tracking-[0.2em] text-[#7F96A3] uppercase">
            Kerala Flood Intelligence &amp; Early Warning
          </span>
        </div>

        {/* Minimal system status indicator */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#071218]/70 px-3 py-1 backdrop-blur-md">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-medium tracking-[0.14em] text-[#C4D5DF]">
              SYSTEM ONLINE
            </span>
          </div>
          <span className="hidden sm:inline font-mono text-[10px] tracking-wider text-[#4E6674]">
            76.2711° E · 10.8505° N
          </span>
        </div>
      </header>

      {/* VISUAL CENTER HERO */}
      <div className="relative z-10 my-auto flex flex-col items-center text-center">
        {/* Eyebrow */}
        <div className="mb-3.5 inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.32em] text-[#7F96A3]">
          <span>KERALA</span>
          <span className="text-[#3A5260]">•</span>
          <span>FLOOD INTELLIGENCE</span>
        </div>

        {/* Large Title */}
        <h1 className="text-6xl sm:text-7xl md:text-8xl font-light tracking-[-0.035em] text-[#F4F8FA] drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]">
          VARUNA
        </h1>

        {/* Evocative human tagline */}
        <p className="mt-3 text-sm sm:text-base md:text-lg font-normal tracking-wide text-[#A4B8C4]">
          &ldquo;See the risk before the water arrives.&rdquo;
        </p>

        {/* ONE Refined Action Button */}
        <div className="mt-8 sm:mt-9">
          <Link
            href="/command"
            className="group relative inline-flex items-center gap-3 rounded-lg border border-white/[0.12] bg-[#0B171C]/92 px-8 py-3.5 text-xs sm:text-sm font-medium tracking-[0.12em] text-[#E8EEF2] shadow-xl shadow-black/50 backdrop-blur-md transition-all duration-200 hover:border-[#5FB8D4]/45 hover:bg-[#10222B] hover:text-white hover:shadow-[#5FB8D4]/10 active:scale-[0.99]"
          >
            <span>OPEN VARUNA</span>
            <span className="text-[#5FB8D4] transition-transform duration-200 group-hover:translate-x-1">
              →
            </span>
          </Link>
        </div>
      </div>

      {/* PERIMETER FOOTER / TECHNICAL LABELS */}
      <footer className="relative z-10 flex items-end justify-between pl-12 pr-4 sm:px-6 text-[10px] font-mono tracking-wider text-[#738C9C]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
          <span>GEO-INTELLIGENCE DECISION SUPPORT</span>
          <span className="hidden sm:inline text-[#3F5766]">/</span>
          <span className="text-[#8AA4B5]">44 BASINS &amp; RESERVOIRS MONITORED</span>
        </div>

        <div className="text-right">
          <span className="text-[#8AA4B5]">HACKIGNITE&apos;26 · IEDC GPTC PALA</span>
        </div>
      </footer>
    </main>
  );
}
