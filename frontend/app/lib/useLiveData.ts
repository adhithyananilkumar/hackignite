"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, type DamReading, type RiverReading } from "./api";

export interface LiveSnapshot {
  rivers: Record<string, RiverReading>;
  dams: Record<string, DamReading>;
  progress: number;
}

export function useLiveData() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      const wsUrl = API_BASE.replace(/^http/, "ws") + "/ws/live";
      ws = new WebSocket(wsUrl);

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data));
        } catch {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryRef.current = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      ws?.close();
    };
  }, []);

  return { snapshot, connected };
}
