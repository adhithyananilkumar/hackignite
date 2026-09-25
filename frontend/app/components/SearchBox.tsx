"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { SparkleIcon } from "./LocationPanel";

export type SearchResult =
  | { kind: "river" | "dam"; id: string; name: string; detail: string }
  | { kind: "hospital" | "school" | "shelter" | "bridge" | "place"; id: string; name: string; detail: string; lon: number; lat: number };

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  river: "River",
  dam: "Dam",
  hospital: "Hospital",
  school: "School",
  shelter: "Relief shelter",
  bridge: "Bridge",
  place: "Place",
};
const KIND_COLOR: Record<SearchResult["kind"], string> = {
  river: "#1a73e8",
  dam: "#1967d2",
  hospital: "#d93025",
  school: "#e37400",
  shelter: "#1a73e8",
  bridge: "#5f6368",
  place: "#ea4335",
};
const MAX_RESULTS = 8;
const MAX_PLACE_RESULTS = 4;
const PLACE_SEARCH_DEBOUNCE_MS = 450;

function KindIcon({ kind }: { kind: SearchResult["kind"] }) {
  const path =
    kind === "river"
      ? "M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1.5M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1.5"
      : kind === "dam"
        ? "M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"
        : kind === "hospital"
          ? "M12 6v12M6 12h12"
          : kind === "school"
            ? "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"
            : kind === "shelter"
              ? "M3 11l9-7 9 7M5 10v10h14V10"
              : kind === "place"
                ? "M12 21s-6.5-6.2-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
                : "M3 17c3-6 15-6 18 0M3 17h18M7 13v4M12 11v6M17 13v4";
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{ background: `${KIND_COLOR[kind]}14`, color: KIND_COLOR[kind] }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}

function useSearchIndex() {
  const [index, setIndex] = useState<SearchResult[]>([]);
  useEffect(() => {
    Promise.all([api.riversGeoJson(), api.damsGeoJson(), api.impactGeoJson()])
      .then(([rivers, dams, assets]) => {
        const entries: SearchResult[] = [];
        for (const f of rivers.features) {
          const p = f.properties as Record<string, string>;
          entries.push({ kind: "river", id: p.id, name: p.name, detail: `River · gauge at ${p.gauge_town}` });
        }
        for (const f of dams.features) {
          const p = f.properties as Record<string, string>;
          entries.push({ kind: "dam", id: p.id, name: p.name, detail: `Dam · ${p.river} · ${p.district}` });
        }
        for (const f of assets.features) {
          const p = f.properties as Record<string, string>;
          if (p.name.startsWith("Unnamed")) continue;
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
          const kind = p.type as "hospital" | "school" | "shelter" | "bridge";
          entries.push({ kind, id: p.id, name: p.name, detail: `${KIND_LABEL[kind]} · ${p.basin} basin`, lon, lat });
        }
        setIndex(entries);
      })
      .catch(() => {});
  }, []);
  return index;
}

// Rivers and dams first, then facilities by how critical they are in a flood;
// within a kind, prefix matches beat word matches beat substrings.
const KIND_RANK: Record<SearchResult["kind"], number> = { river: 0, dam: 0, place: 5, hospital: 10, shelter: 20, school: 30, bridge: 40 };

function rank(entry: SearchResult, q: string): number {
  const name = entry.name.toLowerCase();
  const base = KIND_RANK[entry.kind];
  if (name.startsWith(q)) return base;
  if (name.split(/[\s,()-]+/).some((w) => w.startsWith(q))) return base + 1;
  if (name.includes(q) || entry.detail.toLowerCase().includes(q)) return base + 2;
  return -1;
}

// Towns, villages and landmarks from OpenStreetMap, once the query settles.
function usePlaceSearch(query: string) {
  const [found, setFound] = useState<{ q: string; results: SearchResult[] }>({ q: "", results: [] });
  const q = query.trim();
  useEffect(() => {
    if (q.length < 3) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchPlaces(q)
        .then((places) => {
          if (cancelled) return;
          const results = places.slice(0, MAX_PLACE_RESULTS).map<SearchResult>((p) => ({
            kind: "place",
            id: `place-${p.lat},${p.lon}`,
            name: p.name,
            detail: p.detail,
            lon: p.lon,
            lat: p.lat,
          }));
          setFound({ q, results });
        })
        .catch(() => {});
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);
  return found.q === q ? found.results : [];
}

export function SearchBox({
  onPick,
  panelOpen,
  onTogglePanel,
  chatOpen,
  onAsk,
}: {
  onPick: (result: SearchResult) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  chatOpen: boolean;
  onAsk: () => void;
}) {
  const index = useSearchIndex();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const places = usePlaceSearch(query);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const local = index
      .map((e) => [rank(e, q), e] as const)
      .filter(([r]) => r >= 0)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .map(([, e]) => e);
    // Rivers and dams first, then places, then facilities.
    const top = local.filter((e) => e.kind === "river" || e.kind === "dam");
    const rest = local.filter((e) => e.kind !== "river" && e.kind !== "dam");
    return [...top, ...places, ...rest].slice(0, MAX_RESULTS);
  }, [index, query, places]);

  const pick = (r: SearchResult) => {
    onPick(r);
    setQuery(r.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-full">
      <div
        className={`maps-glass-strong flex h-12 items-center gap-1 pl-1 pr-3 ${
          open && results.length ? "!rounded-b-none !rounded-t-3xl" : "!rounded-3xl"
        }`}
      >
        <button
          onClick={onTogglePanel}
          aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
          title={panelOpen ? "Hide side panel" : "Show side panel"}
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
          </svg>
        </button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              pick(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search places, rivers, dams…"
          aria-label="Search VARUNA"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#202124] outline-none placeholder:text-[#70757a]"
        />
        {query ? (
          <button
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#1a73e8]" fill="currentColor" aria-hidden>
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14" />
          </svg>
        )}
        <span className="ml-1.5 h-6 border-l border-black/[0.07]" />
        <button
          onClick={onAsk}
          aria-pressed={chatOpen}
          title="Chat with VARUNA about any river, dam or place"
          className={`ml-1.5 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium tracking-wide transition-colors ${
            chatOpen ? "bg-[#1a73e8] text-white" : "text-[#1a73e8] hover:bg-[#e8f0fe]"
          }`}
        >
          <SparkleIcon className="h-4 w-4" />
          Ask VARUNA
        </button>
      </div>

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-12 z-30 overflow-hidden maps-glass-strong !rounded-t-none !rounded-b-3xl !border-t-black/[0.06] pb-2"
        >
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${i === active ? "bg-white/55" : ""}`}
            >
              <KindIcon kind={r.kind} />
              <div className="min-w-0">
                <div className="truncate text-sm text-[#202124]">{r.name}</div>
                <div className="truncate text-xs text-[#70757a]">{r.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
