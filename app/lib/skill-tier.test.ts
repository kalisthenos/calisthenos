import { describe, expect, it } from "vitest";
import {
  SKILL_TIERS,
  type SkillTier,
  TIER_LABEL,
  canBePrerequisite,
  highestEarnedTier,
  tierRank,
} from "./skill-tier";

describe("TIER_LABEL", () => {
  it("ma niepustą etykietę dla każdego tieru", () => {
    for (const t of SKILL_TIERS) {
      expect(TIER_LABEL[t]).toBeTruthy();
    }
  });
  it("etykiety są unikalne", () => {
    const labels = SKILL_TIERS.map((t) => TIER_LABEL[t]);
    expect(new Set(labels).size).toBe(SKILL_TIERS.length);
  });
  it("ma dokładnie te etykiety, których wymaga specyfikacja", () => {
    expect(TIER_LABEL).toEqual({
      basic: "Podstawowy",
      intermediate: "Średnio zaawansowany",
      advanced: "Zaawansowany",
      expert: "Ekspert",
    });
  });
});

describe("tierRank", () => {
  it("rośnie ściśle monotonicznie w kolejności SKILL_TIERS", () => {
    for (let i = 1; i < SKILL_TIERS.length; i++) {
      expect(tierRank(SKILL_TIERS[i]!)).toBeGreaterThan(tierRank(SKILL_TIERS[i - 1]!));
    }
  });
  it("basic jest najniższy, expert najwyższy", () => {
    expect(tierRank("basic")).toBe(0);
    expect(tierRank("expert")).toBe(SKILL_TIERS.length - 1);
  });
});

describe("canBePrerequisite", () => {
  it("dopuszcza równy i niższy tier, odrzuca wyższy — wszystkie pary", () => {
    for (const prereq of SKILL_TIERS) {
      for (const skill of SKILL_TIERS) {
        expect(canBePrerequisite(prereq, skill)).toBe(tierRank(prereq) <= tierRank(skill));
      }
    }
  });
  it("PODSTAWOWY nie może wymagać EKSPERTA", () => {
    expect(canBePrerequisite("expert", "basic")).toBe(false);
  });
  it("ten sam tier jest dozwolony (podrzędy w pasie)", () => {
    expect(canBePrerequisite("intermediate", "intermediate")).toBe(true);
  });
});

describe("highestEarnedTier", () => {
  it("pusta lista → null", () => {
    expect(highestEarnedTier([])).toBeNull();
  });
  it("brak opanowanych → null", () => {
    expect(highestEarnedTier([{ tier: "expert", mastered: false }])).toBeNull();
  });
  it("ignoruje nieopanowane wyższe tiery", () => {
    expect(
      highestEarnedTier([
        { tier: "intermediate", mastered: true },
        { tier: "expert", mastered: false },
      ]),
    ).toBe("intermediate");
  });
  it("wybiera najwyższy spośród opanowanych niezależnie od kolejności wejścia", () => {
    const nodes: Array<{ tier: SkillTier; mastered: boolean }> = [
      { tier: "advanced", mastered: true },
      { tier: "basic", mastered: true },
    ];
    expect(highestEarnedTier(nodes)).toBe("advanced");
  });
});
