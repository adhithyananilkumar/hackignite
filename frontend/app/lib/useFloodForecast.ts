"use client";

import { useEffect, useState } from "react";
import { api, type FloodForecast } from "./api";

const POLL_MS = 5000;

// The forecast document is small (extents are separate, immutable PNGs), so
// polling is cheap; it tracks the live snapshot closely enough for the map.
// `sourceKey` (the active data-source mode) forces an immediate refetch on switch.
export function useFloodForecast(sourceKey?: string) {
  const [forecast, setForecast] = useState<FloodForecast | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .floodForecast()
        .then((f) => !cancelled && setForecast(f))
        .catch(() => {});
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sourceKey]);

  return forecast;
}

export function horizonTotals(forecast: FloodForecast | null, horizonIndex: number) {
  const totals = { flooded_area_km2: 0, population: 0, hospitals: 0, schools: 0, shelters: 0, bridges: 0, rivers: 0 };
  for (const river of forecast?.rivers ?? []) {
    const h = river.horizons[horizonIndex];
    if (!h || h.flooded_area_km2 === 0) continue;
    totals.rivers += 1;
    totals.flooded_area_km2 += h.flooded_area_km2;
    totals.population += h.population;
    totals.hospitals += h.hospitals;
    totals.schools += h.schools;
    totals.shelters += h.shelters;
    totals.bridges += h.bridges;
  }
  return totals;
}
