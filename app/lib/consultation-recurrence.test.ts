import { describe, expect, it } from "vitest";
import { type RecurrenceRule, nextOccurrences } from "~/lib/consultation-recurrence";

// 2026-06-01 to poniedziałek; środa = 2026-06-03.
const weekly: RecurrenceRule = {
  cadence: "weekly",
  weekday: 3, // środa (0=niedziela)
  dayOfMonth: null,
  timeOfDay: "18:00",
  startsOn: "2026-06-01",
};

describe("nextOccurrences", () => {
  it("weekly: kolejne środy 18:00 UTC w oknie", () => {
    const out = nextOccurrences(weekly, { from: "2026-06-01", horizonDays: 21 });
    expect(out).toEqual([
      "2026-06-03T18:00:00.000Z",
      "2026-06-10T18:00:00.000Z",
      "2026-06-17T18:00:00.000Z",
    ]);
  });

  it("biweekly: co druga środa od kotwicy", () => {
    const out = nextOccurrences(
      { ...weekly, cadence: "biweekly" },
      {
        from: "2026-06-01",
        horizonDays: 21,
      },
    );
    expect(out).toEqual(["2026-06-03T18:00:00.000Z", "2026-06-17T18:00:00.000Z"]);
  });

  it("pomija terminy przed `from`", () => {
    const out = nextOccurrences(weekly, { from: "2026-06-11", horizonDays: 14 });
    expect(out).toEqual(["2026-06-17T18:00:00.000Z", "2026-06-24T18:00:00.000Z"]);
  });

  it("monthly: 15. dnia miesiąca w oknie 70 dni (czerwiec, lipiec)", () => {
    // from=2026-06-01, okno 70 dni → koniec ~2026-08-10, więc 15 sierpnia (dzień 75)
    // wypada już poza oknem. Logika „kolejne miesiące" weryfikowana dla cze→lip.
    const monthly: RecurrenceRule = {
      cadence: "monthly",
      weekday: null,
      dayOfMonth: 15,
      timeOfDay: "09:30",
      startsOn: "2026-06-01",
    };
    const out = nextOccurrences(monthly, { from: "2026-06-01", horizonDays: 70 });
    expect(out).toEqual(["2026-06-15T09:30:00.000Z", "2026-07-15T09:30:00.000Z"]);
  });

  it("monthly: szersze okno (80 dni) łapie też trzeci miesiąc", () => {
    const monthly: RecurrenceRule = {
      cadence: "monthly",
      weekday: null,
      dayOfMonth: 15,
      timeOfDay: "09:30",
      startsOn: "2026-06-01",
    };
    const out = nextOccurrences(monthly, { from: "2026-06-01", horizonDays: 80 });
    expect(out).toEqual([
      "2026-06-15T09:30:00.000Z",
      "2026-07-15T09:30:00.000Z",
      "2026-08-15T09:30:00.000Z",
    ]);
  });
});
