"use client";

import { useState } from "react";
import { api } from "../lib/api";

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
    <div className="flex flex-col">
      <div className="mb-3 text-xs text-[#70757a]">Answers use the current data and flood forecast only.</div>
      <div className="flex flex-col gap-2 max-h-[24vh] overflow-y-auto varuna-scrollbar mb-2">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="cursor-pointer rounded-full border border-[#dadce0] px-3 py-1 text-left text-xs text-[#3c4043] hover:bg-[#f1f3f4]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
              t.role === "user" ? "self-end bg-[#e8f0fe] text-[#174ea6]" : "self-start bg-[#f1f3f4] text-[#202124]"
            }`}
          >
            {t.text}
          </div>
        ))}
        {loading && <div className="text-xs text-[#70757a]">Thinking…</div>}
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
          className="flex-1 rounded-full bg-[#f1f3f4] px-4 py-2 text-sm text-[#202124] outline-none placeholder:text-[#70757a] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]"
        />
        <button
          type="submit"
          aria-label="Ask"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
