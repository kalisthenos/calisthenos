import { describe, expect, it } from "vitest";
import {
  type ProgressionListRow,
  type SessionPoint,
  aggregateToWeeks,
  classifyStatus,
  computePeriodChangePct,
  excludeByExerciseId,
  markPrs,
  normalizeToPctFromStart,
  rangeStartIso,
  seriesForRange,
  shouldAggregateWeekly,
  sortProgressionRows,
  statusFromSessions,
  summarizeStatuses,
  unitLabelPl,
  weekStartIso,
} from "./progression-math";

const sp = (
  performedOn: string,
  best: number,
  avgReps = best,
  avgRpe: number | null = 7,
  volume = best * 3,
): SessionPoint => ({
  performedOn,
  best,
  avgReps,
  avgRpe,
  volume,
});

describe("rangeStartIso", () => {
  it("returns null for 'all'", () => {
    expect(rangeStartIso("all", "2026-05-31")).toBeNull();
  });
  it("subtracts 28 days for '4w'", () => {
    expect(rangeStartIso("4w", "2026-05-31")).toBe("2026-05-03");
  });
  it("subtracts 90 days for '3m'", () => {
    expect(rangeStartIso("3m", "2026-05-31")).toBe("2026-03-02");
  });
});

describe("seriesForRange (A: szerszy okres nie pokazuje mniej punktów niż węższy)", () => {
  it("krótki zakres ('4w'): zawsze per-sesja", () => {
    const inRange = [sp("2026-05-01", 5), sp("2026-05-03", 6)];
    const r = seriesForRange(inRange, "4w");
    expect(r.granularity).toBe("session");
    expect(r.series).toEqual(inRange);
  });

  it("długi zakres ('6m') z sesjami w ≥2 tygodniach: ujęcie tygodniowe", () => {
    // 2026-01-05 (pon) i 2026-01-12 (pon następnego tygodnia) → dwa kubełki.
    const inRange = [sp("2026-01-05", 5), sp("2026-01-12", 7)];
    const r = seriesForRange(inRange, "6m");
    expect(r.granularity).toBe("week");
    expect(r.series).toHaveLength(2);
  });

  it("długi zakres ('6m') z sesjami w JEDNYM tygodniu: fallback do per-sesja", () => {
    // pon/wt/śr tego samego tygodnia → tygodniowo zwija się do 1 punktu.
    const inRange = [sp("2026-01-05", 5), sp("2026-01-06", 6), sp("2026-01-07", 7)];
    expect(aggregateToWeeks(inRange)).toHaveLength(1); // sanity
    const r = seriesForRange(inRange, "6m");
    expect(r.granularity).toBe("session");
    expect(r.series).toEqual(inRange);
  });

  it("'all' z jedną sesją: per-sesja (1 punkt — render obsłuży Fix B)", () => {
    const inRange = [sp("2026-01-05", 5)];
    const r = seriesForRange(inRange, "all");
    expect(r.granularity).toBe("session");
    expect(r.series).toEqual(inRange);
  });

  it("pusty zakres: per-sesja, pusta seria", () => {
    const r = seriesForRange([], "6m");
    expect(r.granularity).toBe("session");
    expect(r.series).toEqual([]);
  });
});

describe("shouldAggregateWeekly", () => {
  it("aggregates only for 6m and all", () => {
    expect(shouldAggregateWeekly("4w")).toBe(false);
    expect(shouldAggregateWeekly("3m")).toBe(false);
    expect(shouldAggregateWeekly("6m")).toBe(true);
    expect(shouldAggregateWeekly("all")).toBe(true);
  });
});

describe("weekStartIso", () => {
  it("maps any day to its Monday (UTC)", () => {
    expect(weekStartIso("2026-05-31")).toBe("2026-05-25");
    expect(weekStartIso("2026-05-25")).toBe("2026-05-25");
  });
  it("handles a week crossing a year boundary", () => {
    // 2026-01-01 is a Thursday → Monday is 2025-12-29
    expect(weekStartIso("2026-01-01")).toBe("2025-12-29");
  });
});

describe("aggregateToWeeks", () => {
  it("groups sessions in the same week: best=max, volume=sum, rpe=mean", () => {
    const out = aggregateToWeeks([
      sp("2026-05-25", 5, 5, 8, 15),
      sp("2026-05-27", 7, 6, 6, 18),
      sp("2026-06-01", 8, 8, 7, 24),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ performedOn: "2026-05-25", best: 7, volume: 33, avgRpe: 7 });
    expect(out[1]).toMatchObject({ performedOn: "2026-06-01", best: 8, volume: 24 });
  });
});

describe("markPrs", () => {
  it("flags each new running-high (chronological)", () => {
    const out = markPrs([sp("2026-01-01", 5), sp("2026-01-08", 5), sp("2026-01-15", 7)]);
    expect(out.map((p) => p.isPr)).toEqual([true, false, true]);
    expect(out[0]!.label).toBe("01.01");
  });
  it("returns empty for empty input", () => {
    expect(markPrs([])).toEqual([]);
    expect(aggregateToWeeks([])).toEqual([]);
  });
});

describe("classifyStatus", () => {
  it("is 'new' below 5 sessions", () => {
    expect(classifyStatus(10, 5, 4)).toBe("new");
  });
  it("is 'up' when recent beats prior by >5%", () => {
    expect(classifyStatus(11, 10, 8)).toBe("up");
  });
  it("is 'down' when recent below prior by >5%", () => {
    expect(classifyStatus(9, 10, 8)).toBe("down");
  });
  it("is 'flat' within ±5%", () => {
    expect(classifyStatus(102, 100, 8)).toBe("flat");
  });
  it("treats prior 0 as flat (no divide-by-zero)", () => {
    expect(classifyStatus(5, 0, 8)).toBe("flat");
  });
});

describe("statusFromSessions (newest-first)", () => {
  it("averages recent 4 vs prior 4 of best", () => {
    const mk = (best: number): SessionPoint => sp("2026-01-01", best, best);
    const rows = [mk(10), mk(10), mk(10), mk(10), mk(8), mk(8), mk(8), mk(8)];
    expect(statusFromSessions(rows)).toBe("up");
  });
});

describe("statusFromSessions liczy z best (nie avgReps)", () => {
  it("rośnie, gdy best ostatnich 4 > poprzednich 4, mimo płaskiego avgReps", () => {
    // avgReps stałe = 5, ale best rośnie z 8 → 12
    const mk = (best: number): SessionPoint => sp("2026-01-01", best, 5, 7, best * 3);
    const rows = [mk(12), mk(12), mk(12), mk(12), mk(8), mk(8), mk(8), mk(8)];
    expect(statusFromSessions(rows)).toBe("up");
  });
  it("spada, gdy best ostatnich 4 < poprzednich 4", () => {
    const mk = (best: number): SessionPoint => sp("2026-01-01", best, 5, 7, best * 3);
    const rows = [mk(8), mk(8), mk(8), mk(8), mk(12), mk(12), mk(12), mk(12)];
    expect(statusFromSessions(rows)).toBe("down");
  });
});

describe("unitLabelPl", () => {
  it("mapuje jednostki na polskie skróty", () => {
    expect(unitLabelPl("REPS")).toBe("powt.");
    expect(unitLabelPl("SEC")).toBe("sek.");
  });
});

describe("computePeriodChangePct (chronological)", () => {
  it("returns null below 2 points", () => {
    expect(computePeriodChangePct([sp("2026-01-01", 5)])).toBeNull();
  });
  it("compares first up-to-3 vs last up-to-3 best", () => {
    const pts = [sp("a", 5), sp("b", 5), sp("c", 5), sp("d", 10), sp("e", 10), sp("f", 10)];
    expect(computePeriodChangePct(pts)).toBe(100);
  });
  it("uses non-overlapping windows for 2-3 sessions (not always 0%)", () => {
    expect(computePeriodChangePct([sp("a", 5), sp("b", 10)])).toBe(100);
    expect(computePeriodChangePct([sp("a", 5), sp("b", 7), sp("c", 10)])).toBe(100);
  });
});

describe("normalizeToPctFromStart", () => {
  it("returns null when start is 0", () => {
    expect(normalizeToPctFromStart([0, 5, 10])).toBeNull();
  });
  it("returns null below 2 values", () => {
    expect(normalizeToPctFromStart([5])).toBeNull();
  });
  it("expresses each value as % change from first", () => {
    expect(normalizeToPctFromStart([5, 6, 10])).toEqual([0, 20, 100]);
  });
});

describe("sortProgressionRows", () => {
  const row = (
    name: string,
    status: ProgressionListRow["status"],
    lastPerformedOn: string,
  ): ProgressionListRow => ({
    exerciseId: name,
    name,
    unit: "REPS",
    tags: [],
    sessionCount: 6,
    lastPerformedOn,
    pr: 10,
    prAchievedOn: lastPerformedOn,
    sparkline: [1, 2],
    status,
  });
  it("'recent' sorts by lastPerformedOn desc", () => {
    const out = sortProgressionRows(
      [row("a", "up", "2026-01-01"), row("b", "up", "2026-02-01")],
      "recent",
    );
    expect(out.map((r) => r.name)).toEqual(["b", "a"]);
  });
  it("'attention' puts down → flat → up → new", () => {
    const out = sortProgressionRows(
      [row("a", "up", "x"), row("b", "down", "x"), row("c", "new", "x"), row("d", "flat", "x")],
      "attention",
    );
    expect(out.map((r) => r.status)).toEqual(["down", "flat", "up", "new"]);
  });
});

describe("summarizeStatuses", () => {
  it("counts statuses", () => {
    expect(
      summarizeStatuses([
        { status: "up" },
        { status: "up" },
        { status: "down" },
        { status: "new" },
      ]),
    ).toEqual({
      up: 2,
      flat: 0,
      down: 1,
      new: 1,
    });
  });
});

describe("aggregateToWeeks z nullowalnym RPE", () => {
  it("uśrednia tylko nie-null RPE w obrębie tygodnia", () => {
    const out = aggregateToWeeks([sp("2026-05-25", 5, 5, 8, 15), sp("2026-05-27", 7, 6, null, 18)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.avgRpe).toBe(8); // null pominięte
  });
  it("daje avgRpe=null gdy wszystkie punkty tygodnia bez RPE", () => {
    const out = aggregateToWeeks([
      sp("2026-05-25", 5, 5, null, 15),
      sp("2026-05-27", 7, 6, null, 18),
    ]);
    expect(out[0]!.avgRpe).toBeNull();
  });
});

describe("markPrs z nullowalnym RPE", () => {
  it("przepuszcza avgRpe=null bez zmiany isPr", () => {
    const out = markPrs([sp("2026-01-01", 5, 5, null), sp("2026-01-08", 7, 7, 6)]);
    expect(out[0]!.avgRpe).toBeNull();
    expect(out[1]!.avgRpe).toBe(6);
    expect(out.map((p) => p.isPr)).toEqual([true, true]);
  });
});

describe("excludeByExerciseId", () => {
  const row = (exerciseId: string): ProgressionListRow => ({
    exerciseId,
    name: exerciseId,
    unit: "REPS",
    tags: [],
    sessionCount: 1,
    lastPerformedOn: "2026-06-01",
    pr: 10,
    prAchievedOn: "2026-06-01",
    sparkline: [10],
    status: "new",
  });

  it("usuwa wiersze, których exerciseId jest w zbiorze", () => {
    const rows = [row("a"), row("b"), row("c")];
    const out = excludeByExerciseId(rows, new Set(["b"]));
    expect(out.map((r) => r.exerciseId)).toEqual(["a", "c"]);
  });

  it("pusty zbiór = brak zmian", () => {
    const rows = [row("a"), row("b")];
    expect(excludeByExerciseId(rows, new Set())).toHaveLength(2);
  });

  it("nie mutuje wejścia", () => {
    const rows = [row("a"), row("b")];
    excludeByExerciseId(rows, new Set(["a"]));
    expect(rows).toHaveLength(2);
  });
});
