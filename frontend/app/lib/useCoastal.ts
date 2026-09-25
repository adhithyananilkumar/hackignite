"use client";

import { useEffect, useState } from "react";
import { api, type CoastalSnapshot } from "./api";

// Sea level data is cached server-side; polling each minute keeps any scripted
// surge (simulation) current. The source key forces a refetch on mode switch.
const POLL_MS = 60 * 1000;

export function useCoastal(sourceKey?: string) {
  const [data, setData] = useState<CoastalSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .coastal()
        .then((d) => !cancelled && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sourceKey]);
  return data;
}
