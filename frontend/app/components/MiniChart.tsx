type XY = [number, number];

export interface ChartLine {
  points: XY[];
  color: string;
  width?: number;
  dash?: string;
}
export interface ChartBand {
  upper: XY[];
  lower: XY[];
  color: string;
  opacity?: number;
}
export interface ChartRef {
  y: number;
  color: string;
  label?: string;
}

/** Tiny dependency-free SVG chart: lines, shaded bands, horizontal reference lines, a "now" marker. */
export function MiniChart({
  lines = [],
  bands = [],
  refs = [],
  nowX,
  height = 72,
  yPad = 0.08,
  xLabels,
}: {
  lines?: ChartLine[];
  bands?: ChartBand[];
  refs?: ChartRef[];
  nowX?: number;
  height?: number;
  yPad?: number;
  xLabels?: { x: number; label: string }[];
}) {
  const W = 300;
  const H = height;
  const all = [...lines.flatMap((l) => l.points), ...bands.flatMap((b) => [...b.upper, ...b.lower])];
  if (!all.length) return null;
  const xs = all.map((p) => p[0]);
  const ys = [...all.map((p) => p[1]), ...refs.map((r) => r.y)];
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [rawY0, rawY1] = [Math.min(...ys), Math.max(...ys)];
  const span = rawY1 - rawY0 || 1;
  const [y0, y1] = [rawY0 - span * yPad, rawY1 + span * yPad];
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = (y: number) => H - ((y - y0) / (y1 - y0)) * H;
  const path = (pts: XY[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}>
        {bands.map((b, i) => (
          <path
            key={`b${i}`}
            d={`${path(b.upper)} ${b.lower
              .slice()
              .reverse()
              .map(([x, y]) => `L${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
              .join(" ")} Z`}
            fill={b.color}
            opacity={b.opacity ?? 0.2}
          />
        ))}
        {refs.map((r, i) => (
          <line key={`r${i}`} x1={0} x2={W} y1={sy(r.y)} y2={sy(r.y)} stroke={r.color} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        ))}
        {nowX !== undefined && nowX >= x0 && nowX <= x1 && (
          <line x1={sx(nowX)} x2={sx(nowX)} y1={0} y2={H} stroke="#5f6368" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
        {lines.map((l, i) => (
          <path
            key={`l${i}`}
            d={path(l.points)}
            fill="none"
            stroke={l.color}
            strokeWidth={l.width ?? 2}
            strokeDasharray={l.dash}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {(xLabels || refs.some((r) => r.label)) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#70757a]">
          <span className="flex gap-3">
            {refs.filter((r) => r.label).map((r) => (
              <span key={r.label} className="flex items-center gap-1">
                <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: r.color }} />
                {r.label}
              </span>
            ))}
          </span>
          {xLabels && (
            <span className="flex gap-2 tabular-nums">
              {xLabels.map((l) => (
                <span key={l.label}>{l.label}</span>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
