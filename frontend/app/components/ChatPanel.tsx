"use client";

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import type { ChatAction, ChatStep } from "../lib/api";
import type { ChatMessage } from "../lib/useVarunaChat";
import { LIKELIHOOD_COLORS, SparkleIcon } from "./LocationPanel";

// Just enough Markdown for Gemini's replies: paragraphs, bullets, **bold**, *italic*.
// (Underscore italics are skipped so identifiers like GEMINI_API_KEY survive.)
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (/^\*\*.+\*\*$/.test(part)) return <strong key={i} className="font-medium">{part.slice(2, -2)}</strong>;
    if (/^\*.+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-5">
        {bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}
      </ul>
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      <p key={blocks.length} className={`my-1 ${heading ? "font-medium" : ""}`}>
        {inline(heading ? heading[1] : line)}
      </p>
    );
  }
  flush();
  return <>{blocks}</>;
}

function stepLabel(step: ChatStep, names: Record<string, string>) {
  const a = step.args as Record<string, string>;
  switch (step.tool) {
    case "get_river_status":
      return `Checked ${names[a.river_id] ?? a.river_id} river`;
    case "get_dam_status":
      return `Checked ${names[a.dam_id] ?? a.dam_id}`;
    case "assess_place":
      return `Located ${a.place_name}`;
    case "assess_coordinates":
      return `Assessed ${a.label ?? "pinned point"}`;
    case "kerala_overview":
      return "Scanned all of Kerala";
    default:
      return step.tool;
  }
}

function ActionCard({ action, names, onReplay }: { action: ChatAction; names: Record<string, string>; onReplay: () => void }) {
  if (action.type === "overview") return null;
  if (action.type === "pin") {
    const lk = action.assessment.likelihood;
    const c = LIKELIHOOD_COLORS[lk.level];
    return (
      <button
        onClick={onReplay}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-black/[0.06] bg-white/70 px-3 py-2 text-left hover:bg-white"
      >
        <PinGlyph />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[#202124]">{action.label}</div>
          <div className="text-xs text-[#5f6368]">Flood likelihood {lk.score}/100 · open details</div>
        </div>
        <span className="shrink-0 rounded-full px-2 py-px text-[11px] font-medium" style={{ background: c.bg, color: c.fg }}>
          {lk.level}
        </span>
      </button>
    );
  }
  return (
    <button onClick={onReplay} className="maps-chip !h-7 !px-3 !text-xs">
      Show {names[action.id] ?? action.id} on map
    </button>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
      <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" fill="#ea4335" />
      <circle cx="12" cy="9" r="2.6" fill="#a50e0e" />
    </svg>
  );
}

export function ChatPanel({
  messages,
  loading,
  names,
  pinLabel,
  selectedName,
  onSend,
  onReplay,
  onReset,
  onClose,
}: {
  messages: ChatMessage[];
  loading: boolean;
  names: Record<string, string>;
  pinLabel: string | null;
  selectedName: string | null;
  onSend: (text: string) => void;
  onReplay: (action: ChatAction) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const suggestions = [
    ...(pinLabel ? [`Will ${pinLabel} flood in the next 12 hours?`] : []),
    ...(selectedName && !pinLabel ? [`What's the outlook for ${selectedName}?`] : []),
    "What's the chance of rain in Periyar?",
    "Is Chengannur at risk of flooding?",
    "Which river is closest to danger level right now?",
    "How full is Idukki dam?",
  ].slice(0, 4);

  const submit = (text: string) => {
    if (!text.trim() || loading) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-black/[0.07] px-3 py-2.5">
        <button
          onClick={onClose}
          aria-label="Close chat"
          title="Back"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
          </svg>
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1a73e8] to-[#8e44ec] text-white">
          <SparkleIcon className="h-4 w-4" />
        </span>
        <div className="ml-1.5 min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-5 text-[#202124]">Ask VARUNA</div>
          <div className="truncate text-xs text-[#70757a]">Gemini · answers from VARUNA&apos;s live data</div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={onReset}
            title="New chat"
            aria-label="New chat"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      <div ref={scrollRef} className="varuna-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="px-1">
            <div className="text-[22px] font-normal leading-7 text-[#202124]">How can I help?</div>
            <p className="mt-1 text-sm leading-5 text-[#5f6368]">
              Ask about any river, dam or place in Kerala — I&apos;ll move the map there and answer from the current river,
              rain and flood-model data. Click the map to drop a pin and ask about that spot.
            </p>
            <div className="mt-4 flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="cursor-pointer rounded-2xl border border-[#dadce0] bg-white/50 px-3.5 py-2 text-left text-sm text-[#3c4043] hover:bg-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-[#1a73e8] px-3.5 py-2 text-sm text-white">
                {m.text}
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-2 self-stretch">
                {m.steps && m.steps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.steps.map((s, j) => (
                      <span key={j} className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] text-[#5f6368]">
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke={s.ok ? "#1e8e3e" : "#d93025"} strokeWidth="3" strokeLinecap="round">
                          <path d={s.ok ? "M5 12l5 5 9-10" : "M6 6l12 12M18 6 6 18"} />
                        </svg>
                        {stepLabel(s, names)}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className={`rounded-2xl rounded-bl-md px-3.5 py-2 text-sm leading-5 ${
                    m.error ? "bg-[#fce8e6] text-[#c5221f]" : "bg-white/70 text-[#202124]"
                  }`}
                >
                  <Markdown text={m.text} />
                </div>
                {m.actions?.some((a) => a.type !== "overview") && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.actions.map((a, j) => (
                      <ActionCard key={j} action={a} names={names} onReplay={() => onReplay(a)} />
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          {loading && (
            <div className="flex items-center gap-2 self-start rounded-2xl bg-white/70 px-3.5 py-2.5 text-sm text-[#5f6368]">
              <span className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#1a73e8]" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
              Checking the data…
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="border-t border-black/[0.07] p-3"
      >
        {pinLabel && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-[#5f6368]">
            <PinGlyph />
            Asking about <span className="truncate font-medium text-[#202124]">{pinLabel}</span>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-3xl bg-white/80 py-1.5 pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-[#1a73e8]">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder="Ask about a river, dam or place…"
            aria-label="Message Ask VARUNA"
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-sm text-[#202124] outline-none placeholder:text-[#70757a]"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || loading}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc] disabled:cursor-default disabled:bg-[#dadce0]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
