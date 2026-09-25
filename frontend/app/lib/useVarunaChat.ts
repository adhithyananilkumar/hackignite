"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChatAction, type ChatStep, type ChatUiContext } from "./api";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  steps?: ChatStep[];
  error?: boolean;
}

/** Conversation state for Ask VARUNA. Lives in the page so it survives the
 * side panel switching between chat and place details. */
export function useVarunaChat(onActions: (actions: ChatAction[]) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef(messages);
  const onActionsRef = useRef(onActions);
  useEffect(() => {
    messagesRef.current = messages;
    onActionsRef.current = onActions;
  }, [messages, onActions]);

  const send = useCallback(async (text: string, ui: ChatUiContext) => {
    const message = text.trim();
    if (!message) return;
    const history = messagesRef.current.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setLoading(true);
    try {
      const reply = await api.chat(message, history, ui);
      setMessages((prev) => [...prev, { role: "assistant", text: reply.answer, actions: reply.actions, steps: reply.steps }]);
      if (reply.actions.length) onActionsRef.current(reply.actions);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "VARUNA couldn't be reached. Is the backend running?", error: true }]);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => setMessages([]), []);

  return { messages, loading, send, reset };
}
