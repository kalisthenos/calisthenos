import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear, scalePoint, scaleTime } from "@visx/scale";
import { Bar, LinePath } from "@visx/shape";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { useCallback, useMemo } from "react";
import type { ComparisonSeriesView } from "~/lib/progression";
import type { ChartPoint, ProgressionStatus, StatusSummary } from "~/lib/progression-math";

// ============================================================
// Progression charts — visx, matching stat-widgets.tsx idiom:
// all colors via var(--*), numbers in var(--font-mono), role="img" +
// aria-label, responsive via <ParentSize> (returns null at width 0 → SSR safe),
// shared "za mało danych" empty state.
// Pure presentation: no data fetching, no router imports.
// ============================================================

type Unit = "REPS" | "SEC";

/** Shared empty-state span, matching stat-widgets.tsx Sparkline. */
function NotEnough({ text = "za mało danych" }: { text?: string }) {
  return (
    <span className="muted text-xs" style={{ fontStyle: "italic" }}>
      {text}
    </span>
  );
}

/** Color a dot by mean RPE: easy → green, mid → amber, hard → red. */
function rpeColor(avgRpe: number | null): string {
  if (avgRpe == null) return "var(--muted)";
  if (avgRpe < 7) return "var(--ok)";
  if (avgRpe < 9) return "var(--warn)";
  return "var(--danger)";
}

/** Format a best value by unit ("12" vs "30 s"). */
function fmtBest(best: number, unit: Unit): string {
  return unit === "SEC" ? `${best} s` : `${best}`;
}

// ============================================================
// Wspólne helpery prezentacji (pasek statusów + kolor sparkline)
// ============================================================

/** Pasek podsumowania statusów nad listą Progresji (obie role). */
export function StatusSummaryBar({ summary }: { summary: StatusSummary }) {
  const items: Array<{ label: string; value: number; color: string }> = [
    { label: "▲ rośnie", value: summary.up, color: "var(--ok)" },
    { label: "= stabilnie", value: summary.flat, color: "var(--muted)" },
    { label: "▼ spada", value: summary.down, color: "var(--danger)" },
    { label: "nowe", value: summary.new, color: "var(--muted)" },
  ];
  return (
    <div
      className="row wrap"
      style={{
        gap: 16,
        marginBottom: 18,
        padding: "10px 14px",
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} className="row" style={{ gap: 6, alignItems: "baseline" }}>
          <span className="text-xs" style={{ color: it.color, fontWeight: 600 }}>
            {it.label}
          </span>
          <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: it.color }}>
            {it.value}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Kolor linii sparkline wg statusu trendu (zielony/czerwony/szary). */
export function sparkStrokeForStatus(status: ProgressionStatus): string {
  if (status === "up") return "var(--ok)";
  if (status === "down") return "var(--danger)";
  return "var(--muted)"; // flat / new
}

// ============================================================
// 1. ProgressionLineChart — hero: best set per session over time.
// ============================================================

export function ProgressionLineChart({
  points,
  unit,
  height = 240,
}: {
  points: ChartPoint[];
  unit: Unit;
  height?: number;
}) {
  // Pusto tylko gdy 0 punktów. Pojedynczy punkt rysujemy jako kropkę (linia się
  // nie pojawia — LinePath na 1 punkcie nic nie kreśli), zamiast „za mało danych".
  if (points.length === 0) return <NotEnough />;
  return (
    <div>
      <div style={{ width: "100%", height }}>
        <ParentSize debounceTime={30}>
          {({ width }) =>
            width > 0 ? (
              <LineChartInner width={width} height={height} points={points} unit={unit} />
            ) : null
          }
        </ParentSize>
      </div>
      <RpeLegend />
    </div>
  );
}

const MARGIN = { top: 22, right: 16, bottom: 26, left: 34 };

function LineChartInner({
  width,
  height,
  points,
  unit,
}: {
  width: number;
  height: number;
  points: ChartPoint[];
  unit: Unit;
}) {
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const innerH = Math.max(height - MARGIN.top - MARGIN.bottom, 1);

  const bests = points.map((p) => p.best);
  const min = Math.min(...bests);
  const max = Math.max(...bests);
  const span = Math.max(max - min, 1);

  const xScale = useMemo(
    () =>
      scalePoint<string>({ domain: points.map((p) => p.key), range: [0, innerW], padding: 0.5 }),
    [points, innerW],
  );
  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [min - span * 0.12, max + span * 0.12],
        range: [innerH, 0],
        nice: true,
      }),
    [min, max, span, innerH],
  );

  const prIndex = bests.indexOf(max);

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<ChartPoint>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    detectBounds: true,
    scroll: true,
  });

  // Nearest-point detection — działa dla myszy (move) i dotyku (touchmove).
  const handleMove = useCallback(
    (event: React.PointerEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      const coords = localPoint(event.nativeEvent);
      if (!coords) return;
      const xInner = coords.x - MARGIN.left;
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      points.forEach((p, i) => {
        const px = xScale(p.key) ?? 0;
        const d = Math.abs(px - xInner);
        if (d < best) {
          best = d;
          nearest = i;
        }
      });
      const p = points[nearest]!;
      showTooltip({
        tooltipData: p,
        tooltipLeft: MARGIN.left + (xScale(p.key) ?? 0),
        tooltipTop: MARGIN.top + yScale(p.best),
      });
    },
    [points, xScale, yScale, showTooltip],
  );

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg width={width} height={height} role="img" aria-label="Wykres rekordu w czasie">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows
            scale={yScale}
            width={innerW}
            numTicks={4}
            stroke="var(--line)"
            strokeDasharray="4 4"
            opacity={0.5}
          />
          <AxisLeft
            scale={yScale}
            numTicks={4}
            hideAxisLine
            hideTicks
            tickFormat={(v) => `${v}`}
            tickLabelProps={() => ({
              fill: "var(--muted)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              textAnchor: "end",
              dy: "0.33em",
              dx: "-2",
            })}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            // Dedupe: for a 2-point series the midpoint collides with the
            // first, which would render overlapping labels + duplicate React keys.
            tickValues={[
              ...new Set([
                points[0]!.key,
                points[Math.floor((points.length - 1) / 2)]!.key,
                points[points.length - 1]!.key,
              ]),
            ]}
            hideTicks
            stroke="var(--line)"
            tickFormat={(k) => points.find((p) => p.key === k)?.label ?? ""}
            tickLabelProps={() => ({
              fill: "var(--muted)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              textAnchor: "middle",
            })}
          />
          <LinePath
            data={points}
            x={(p) => xScale(p.key) ?? 0}
            y={(p) => yScale(p.best)}
            stroke="var(--ink)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => {
            const isPr = i === prIndex;
            const cx = xScale(p.key) ?? 0;
            const cy = yScale(p.best);
            return (
              <g key={p.key}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isPr ? 6 : 3.5}
                  fill={rpeColor(p.avgRpe)}
                  stroke={isPr ? "#fff" : "none"}
                  strokeWidth={isPr ? 1.5 : 0}
                />
                {isPr && (
                  <text
                    x={cx}
                    y={cy - 11}
                    fontSize={10}
                    fontFamily="var(--font-mono)"
                    fill="var(--ink)"
                    fontWeight={600}
                    textAnchor="middle"
                  >
                    {fmtBest(p.best, unit)}
                  </text>
                )}
              </g>
            );
          })}
          {/* Warstwa przechwytująca wskaźnik/dotyk */}
          <rect
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={hideTooltip}
            onTouchMove={handleMove}
            onTouchEnd={hideTooltip}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipInPortal
          key={Math.random()}
          top={tooltipTop}
          left={tooltipLeft}
          style={{
            background: "var(--ink)",
            color: "var(--surface)",
            fontSize: 11,
            padding: "6px 8px",
            borderRadius: 6,
            lineHeight: 1.4,
            fontFamily: "var(--font-mono)",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {tooltipData.label} · {fmtBest(tooltipData.best, unit)}
          </div>
          <div>RPE {tooltipData.avgRpe ?? "—"}</div>
          {tooltipData.isPr && <div style={{ color: "var(--accent)" }}>nowy rekord ★</div>}
        </TooltipInPortal>
      )}
    </div>
  );
}

/** Format a % change value with sign ("+" prefix for positives). */
const fmtPct = (pct: number) => `${pct > 0 ? "+" : ""}${Math.round(pct)}%`;

/** Legenda kolorów RPE pod wykresem rekordu. */
function RpeLegend() {
  const items = [
    { c: "var(--ok)", t: "łatwo" },
    { c: "var(--warn)", t: "średnio" },
    { c: "var(--danger)", t: "ciężko" },
  ];
  return (
    <div className="row wrap" style={{ gap: 12, fontSize: 11, marginTop: 8 }}>
      <span className="muted">kolor = jak ciężko (RPE):</span>
      {items.map((it) => (
        <span key={it.t} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: it.c,
            }}
          />
          <span className="muted">{it.t}</span>
        </span>
      ))}
    </div>
  );
}

// ============================================================
// 2. VolumeBars — one bar per session, height ∝ volume.
// ============================================================

export function VolumeBars({ points, height = 110 }: { points: ChartPoint[]; height?: number }) {
  if (points.length === 0) return <NotEnough />;
  return (
    <div style={{ width: "100%", height }}>
      <ParentSize debounceTime={30}>
        {({ width }) =>
          width > 0 ? <VolumeBarsInner width={width} height={height} points={points} /> : null
        }
      </ParentSize>
    </div>
  );
}

const VB_MARGIN = { top: 8, right: 8, bottom: 20, left: 30 };

function VolumeBarsInner({
  width,
  height,
  points,
}: {
  width: number;
  height: number;
  points: ChartPoint[];
}) {
  const innerW = Math.max(width - VB_MARGIN.left - VB_MARGIN.right, 1);
  const innerH = Math.max(height - VB_MARGIN.top - VB_MARGIN.bottom, 1);
  const max = Math.max(...points.map((p) => p.volume), 1);
  const x = useMemo(
    () => scaleBand<string>({ domain: points.map((p) => p.key), range: [0, innerW], padding: 0.2 }),
    [points, innerW],
  );
  const y = useMemo(
    () => scaleLinear<number>({ domain: [0, max], range: [innerH, 0], nice: true }),
    [max, innerH],
  );
  const lastKey = points[points.length - 1]!.key;
  return (
    <svg width={width} height={height} role="img" aria-label="Łączna praca w sesji">
      <Group left={VB_MARGIN.left} top={VB_MARGIN.top}>
        <AxisLeft
          scale={y}
          numTicks={3}
          hideAxisLine
          hideTicks
          tickLabelProps={() => ({
            fill: "var(--muted)",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            textAnchor: "end",
            dy: "0.33em",
            dx: "-2",
          })}
        />
        {points.map((p) => {
          const bx = x(p.key) ?? 0;
          const by = y(p.volume);
          const h = innerH - by;
          return (
            <Bar
              key={p.key}
              x={bx}
              y={by}
              width={x.bandwidth()}
              height={Math.max(h, p.volume > 0 ? 2 : 0)}
              rx={3}
              fill={p.key === lastKey ? "#9bbf2e" : "var(--accent)"}
            >
              <title>
                {p.label}: {p.volume}
              </title>
            </Bar>
          );
        })}
      </Group>
    </svg>
  );
}

/** Small square legend swatch, mirroring SegmentedBarLegend in stat-widgets. */
function LegendDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 2,
        background: color,
      }}
    />
  );
}

// ============================================================
// 3. ComparisonChart — multiple exercises on one % timeline.
// ============================================================

// Categorical palette for overlaid comparison lines — distinct hues, not theme tokens.
const COMPARE_COLORS = ["var(--ink)", "#3f6212", "var(--warn)", "var(--muted)", "var(--danger)"];

const CMP_MARGIN = { top: 12, right: 14, bottom: 24, left: 40 };

export function ComparisonChart({
  series,
  height = 240,
}: {
  series: ComparisonSeriesView[];
  height?: number;
}) {
  if (series.length === 0)
    return <NotEnough text="wybierz co najmniej 2 ćwiczenia do porównania" />;
  const hasPoints = series.some((s) => s.points.length > 0);
  if (!hasPoints) return <NotEnough text="brak punktów do porównania" />;
  return (
    <div style={{ width: "100%", height }}>
      <ParentSize debounceTime={30}>
        {({ width }) =>
          width > 0 ? <ComparisonInner width={width} height={height} series={series} /> : null
        }
      </ParentSize>
    </div>
  );
}

function ComparisonInner({
  width,
  height,
  series,
}: {
  width: number;
  height: number;
  series: ComparisonSeriesView[];
}) {
  const innerW = Math.max(width - CMP_MARGIN.left - CMP_MARGIN.right, 1);
  const innerH = Math.max(height - CMP_MARGIN.top - CMP_MARGIN.bottom, 1);

  // Punkt serii z kontraktu niesie datę jako `on` (dawne `performedOn`).
  const [minTime, maxTime] = useMemo(() => {
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (const s of series) {
      for (const pt of s.points) {
        const t = new Date(pt.on).getTime();
        if (t < mn) mn = t;
        if (t > mx) mx = t;
      }
    }
    return [mn, mx] as const;
  }, [series]);

  const [pMin, pMax] = useMemo(() => {
    let mn = 0;
    let mx = 0;
    for (const s of series) {
      for (const pt of s.points) {
        if (pt.pct < mn) mn = pt.pct;
        if (pt.pct > mx) mx = pt.pct;
      }
    }
    return [mn, mx] as const;
  }, [series]);

  const xScale = useMemo(() => {
    // Guard a degenerate domain: if every in-range session shares one date
    // (e.g. two logs the same day), minTime===maxTime → scaleTime would map
    // every point to x=0. Pad by ±12h so the points spread around the center.
    const HALF_DAY = 12 * 60 * 60 * 1000;
    const [d0, d1] =
      minTime === maxTime ? [minTime - HALF_DAY, maxTime + HALF_DAY] : [minTime, maxTime];
    return scaleTime<number>({ domain: [d0, d1], range: [0, innerW] });
  }, [minTime, maxTime, innerW]);
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [pMin, pMax], range: [innerH, 0], nice: true }),
    [pMin, pMax, innerH],
  );

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<{ dateMs: number; rows: Array<{ name: string; pct: number; color: string }> }>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    detectBounds: true,
    scroll: true,
  });

  const handleMove = useCallback(
    (event: React.PointerEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      const coords = localPoint(event.nativeEvent);
      if (!coords) return;
      const tMs = xScale.invert(coords.x - CMP_MARGIN.left).getTime();
      const rows = series.map((s, si) => {
        let nearest = s.points[0];
        let bestD = Number.POSITIVE_INFINITY;
        for (const pt of s.points) {
          const d = Math.abs(new Date(pt.on).getTime() - tMs);
          if (d < bestD) {
            bestD = d;
            nearest = pt;
          }
        }
        return {
          name: s.name,
          pct: nearest?.pct ?? 0,
          color: COMPARE_COLORS[si % COMPARE_COLORS.length]!,
        };
      });
      showTooltip({
        tooltipData: { dateMs: tMs, rows },
        tooltipLeft: coords.x,
        tooltipTop: CMP_MARGIN.top,
      });
    },
    [series, xScale, showTooltip],
  );

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg width={width} height={height} role="img" aria-label="Porównanie progresji ćwiczeń">
        <Group left={CMP_MARGIN.left} top={CMP_MARGIN.top}>
          <GridRows scale={yScale} width={innerW} numTicks={4} stroke="var(--line)" opacity={0.4} />
          <AxisLeft
            scale={yScale}
            numTicks={4}
            hideAxisLine
            hideTicks
            tickFormat={(v) => fmtPct(Number(v))}
            tickLabelProps={() => ({
              fill: "var(--muted)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              textAnchor: "end",
              dy: "0.33em",
              dx: "-2",
            })}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={3}
            hideTicks
            stroke="var(--line)"
            tickFormat={(d) => {
              const dt = d as Date;
              return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
            }}
            tickLabelProps={() => ({
              fill: "var(--muted)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              textAnchor: "middle",
            })}
          />
          {/* mocna linia 0% */}
          <line
            x1={0}
            x2={innerW}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="var(--line-2)"
            strokeWidth={1.5}
          />
          {series.map((s, si) => {
            const color = COMPARE_COLORS[si % COMPARE_COLORS.length]!;
            if (s.points.length === 0) return null;
            const last = s.points[s.points.length - 1]!;
            return (
              <g key={s.exerciseId}>
                <LinePath
                  data={s.points}
                  x={(pt) => xScale(new Date(pt.on).getTime())}
                  y={(pt) => yScale(pt.pct)}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle
                  cx={xScale(new Date(last.on).getTime())}
                  cy={yScale(last.pct)}
                  r={3}
                  fill={color}
                />
              </g>
            );
          })}
          {tooltipOpen && tooltipData && tooltipLeft != null && (
            <line
              x1={tooltipLeft - CMP_MARGIN.left}
              x2={tooltipLeft - CMP_MARGIN.left}
              y1={0}
              y2={innerH}
              stroke="var(--line-2)"
              strokeDasharray="3 3"
            />
          )}
          <rect
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={hideTooltip}
            onTouchMove={handleMove}
            onTouchEnd={hideTooltip}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipInPortal
          key={Math.random()}
          top={tooltipTop}
          left={tooltipLeft}
          style={{
            background: "var(--ink)",
            color: "var(--surface)",
            fontSize: 11,
            padding: "6px 8px",
            borderRadius: 6,
            lineHeight: 1.5,
            fontFamily: "var(--font-mono)",
          }}
        >
          {tooltipData.rows.map((r) => (
            <div key={r.name} className="row" style={{ gap: 6, alignItems: "center" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: r.color,
                }}
              />
              <span>
                {r.name}: {r.pct > 0 ? "+" : ""}
                {Math.round(r.pct)}%
              </span>
            </div>
          ))}
        </TooltipInPortal>
      )}
    </div>
  );
}

/** Legend for ComparisonChart — series name + color, English names as-is. */
export function ComparisonChartLegend({ series }: { series: ComparisonSeriesView[] }) {
  return (
    <div className="row wrap" style={{ gap: 12, fontSize: 11, marginTop: 8 }}>
      {series.map((s, si) => (
        <div key={s.exerciseId} className="row" style={{ gap: 6, alignItems: "center" }}>
          <LegendDot color={COMPARE_COLORS[si % COMPARE_COLORS.length]!} />
          <span className="muted">{s.name}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 4. ProgressionStatusBadge — small pill describing trend.
// ============================================================

const STATUS_META: Record<
  ProgressionStatus,
  { text: string; color: string; bg: string; ink: string }
> = {
  up: {
    text: "▲ rośnie",
    color: "var(--ok)",
    bg: "rgba(47, 158, 106, 0.14)",
    ink: "var(--ok)",
  },
  flat: {
    text: "= stabilnie",
    color: "var(--muted)",
    bg: "var(--surface-2)",
    ink: "var(--muted)",
  },
  down: {
    text: "▼ spadek",
    color: "var(--danger)",
    bg: "rgba(226, 92, 58, 0.14)",
    ink: "var(--danger)",
  },
  new: {
    text: "nowe",
    color: "var(--accent)",
    bg: "var(--accent-soft)",
    ink: "var(--accent-ink)",
  },
};

export function ProgressionStatusBadge({ status }: { status: ProgressionStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        background: m.bg,
        color: m.ink,
        whiteSpace: "nowrap",
      }}
    >
      {m.text}
    </span>
  );
}
