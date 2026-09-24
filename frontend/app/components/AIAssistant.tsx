"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";

interface Turn {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "What is the highest-risk basin right now?",
  "How much lead time do we have?",
  "Why is Periyar's risk elevated?",
];

export function AIAssistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(q: string) {
    if (!q.trim() || loading) return;
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setQuestion("");
    setLoading(true);
    try {
      const { answer } = await api.askAi(q);
      setTurns((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", text: "Assistant unavailable right now." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <GlassPanel title="Ask VARUNA" className="w-[320px] flex flex-col">
      <div className="flex flex-col gap-2 max-h-[24vh] overflow-y-auto varuna-scrollbar mb-2">
        {turns.length === 0 && (
          <div className="flex flex-col gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left text-xs text-[var(--glass-text-dim)] rounded-lg bg-[var(--glass-highlight)] px-2.5 py-1.5 hover:text-[var(--glass-text)] cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-2.5 py-1.5 ${
              t.role === "user" ? "bg-[var(--accent)]/20 self-end" : "bg-[var(--glass-highlight)]"
            }`}
          >
            {t.text}
          </div>
        ))}
        {loading && <div className="text-xs text-[var(--glass-text-dim)]">Thinking…</div>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Which areas may be affected in 6h?"
          className="flex-1 rounded-full bg-[var(--glass-highlight)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--glass-text-dim)]"
        />
        <button type="submit" className="glass-button px-3 py-1.5 text-sm">
          Ask
        </button>
      </form>
    </GlassPanel>
  );
}
