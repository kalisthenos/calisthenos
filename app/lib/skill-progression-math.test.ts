import { describe, expect, it } from "vitest";
import {
  type AdvanceSignals,
  type AdvancementEvent,
  HIGH_RPE,
  currentLevelFromEvents,
  suggestAdvancement,
} from "./skill-progression-math";

const ev = (
  toVariationId: string,
  toOrdinal: number,
  advancedOn: string,
  createdAt: number,
): AdvancementEvent => ({ toVariationId, toOrdinal, advancedOn, createdAt });

describe("currentLevelFromEvents", () => {
  it("returns null when there are no events", () => {
    expect(currentLevelFromEvents([])).toBeNull();
  });
  it("returns the only event", () => {
    expect(currentLevelFromEvents([ev("v1", 1, "2026-05-01", 1000)])).toEqual({
      toVariationId: "v1",
      toOrdinal: 1,
    });
  });
  it("picks the latest by advancedOn", () => {
    const events = [ev("v1", 1, "2026-05-01", 1000), ev("v2", 2, "2026-05-10", 1100)];
    expect(currentLevelFromEvents(events)?.toVariationId).toBe("v2");
  });
  it("tie-breaks same advancedOn by createdAt (newer wins)", () => {
    const events = [ev("v2", 2, "2026-05-10", 1100), ev("v3", 3, "2026-05-10", 1200)];
    expect(currentLevelFromEvents(events)?.toVariationId).toBe("v3");
  });
  it("handles a regress event (lower ordinal) as the current level", () => {
    const events = [ev("v3", 3, "2026-05-10", 1200), ev("v2", 2, "2026-05-12", 1300)];
    expect(currentLevelFromEvents(events)).toEqual({ toVariationId: "v2", toOrdinal: 2 });
  });
});

const sig = (over: Partial<AdvanceSignals>): AdvanceSignals => ({
  sessionsOnCurrent: 6,
  status: "flat",
  easierAtSameReps: false,
  inPlateau: false,
  recentAvgRpe: 7,
  hasHigherVariant: true,
  hasLowerVariant: true,
  ...over,
});

describe("suggestAdvancement", () => {
  it("suggests advance when status up, enough sessions, not plateaued, higher variant exists", () => {
    expect(suggestAdvancement(sig({ status: "up" }))).toBe("advance");
  });
  it("suggests advance when 'easier at same reps' even if status is flat", () => {
    expect(suggestAdvancement(sig({ status: "flat", easierAtSameReps: true }))).toBe("advance");
  });
  it("does NOT advance below the session guard", () => {
    expect(suggestAdvancement(sig({ status: "up", sessionsOnCurrent: 3 }))).toBeNull();
  });
  it("does NOT advance while in plateau", () => {
    expect(suggestAdvancement(sig({ status: "up", inPlateau: true }))).toBeNull();
  });
  it("does NOT advance with no higher variant", () => {
    expect(suggestAdvancement(sig({ status: "up", hasHigherVariant: false }))).toBeNull();
  });
  it("suggests regress when status down and RPE high and lower variant exists", () => {
    expect(suggestAdvancement(sig({ status: "down", recentAvgRpe: 9 }))).toBe("regress");
  });
  it("does NOT regress when RPE is not high", () => {
    expect(suggestAdvancement(sig({ status: "down", recentAvgRpe: 6 }))).toBeNull();
  });
  it("regresses exactly at the RPE threshold (>=, not >)", () => {
    expect(suggestAdvancement(sig({ status: "down", recentAvgRpe: HIGH_RPE }))).toBe("regress");
  });
  it("advances regardless of RPE (advance path ignores recentAvgRpe, incl. null)", () => {
    expect(suggestAdvancement(sig({ status: "up", recentAvgRpe: null }))).toBe("advance");
  });
  it("does NOT regress with no lower variant", () => {
    expect(
      suggestAdvancement(sig({ status: "down", recentAvgRpe: 9, hasLowerVariant: false })),
    ).toBeNull();
  });
  it("returns null for a flat, unremarkable signal", () => {
    expect(suggestAdvancement(sig({}))).toBeNull();
  });
});
