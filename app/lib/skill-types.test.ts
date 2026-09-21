import { describe, expect, it } from "vitest";
import { SKILL_TIERS } from "./skill-tier";
import {
  AdvancementFormSchema,
  PrerequisiteFormSchema,
  ReorderFormSchema,
  SkillFormSchema,
} from "./skill-types";

describe("SkillFormSchema", () => {
  it("accepts a valid skill", () => {
    const r = SkillFormSchema.safeParse({ name: "Front Lever", description: "Drabina pleców" });
    expect(r.success).toBe(true);
  });
  it("trims and rejects empty name", () => {
    expect(SkillFormSchema.safeParse({ name: "   ", description: "" }).success).toBe(false);
  });
  it("defaults description to empty string", () => {
    const r = SkillFormSchema.safeParse({ name: "Planche" });
    expect(r.success && r.data.description).toBe("");
  });
});

describe("AdvancementFormSchema", () => {
  it("accepts a valid advancement", () => {
    const r = AdvancementFormSchema.safeParse({
      toVariationId: "11111111-1111-1111-1111-111111111111",
      advancedOn: "2026-06-01",
      note: "czysto 5×20s",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a bad date", () => {
    expect(
      AdvancementFormSchema.safeParse({
        toVariationId: "11111111-1111-1111-1111-111111111111",
        advancedOn: "01-06-2026",
      }).success,
    ).toBe(false);
  });
  it("rejects a non-uuid variation id", () => {
    expect(
      AdvancementFormSchema.safeParse({ toVariationId: "nope", advancedOn: "2026-06-01" }).success,
    ).toBe(false);
  });
});

describe("ReorderFormSchema", () => {
  it("accepts a list of uuids", () => {
    const r = ReorderFormSchema.safeParse({
      variationIds: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an empty list", () => {
    expect(ReorderFormSchema.safeParse({ variationIds: [] }).success).toBe(false);
  });
});

describe("PrerequisiteFormSchema", () => {
  it("przyjmuje dwa poprawne uuid", () => {
    const r = PrerequisiteFormSchema.safeParse({
      skillId: "11111111-1111-1111-1111-111111111111",
      requiresSkillId: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.success).toBe(true);
  });
  it("odrzuca nie-uuid", () => {
    const r = PrerequisiteFormSchema.safeParse({ skillId: "x", requiresSkillId: "y" });
    expect(r.success).toBe(false);
  });
});

describe("SkillFormSchema — tier", () => {
  it("bez pola tier wpada w domyślny basic", () => {
    const parsed = SkillFormSchema.safeParse({ name: "Front Lever" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tier).toBe("basic");
  });
  it("przyjmuje każdą wartość ze słownika tierów", () => {
    for (const t of SKILL_TIERS) {
      expect(SkillFormSchema.safeParse({ name: "X", tier: t }).success).toBe(true);
    }
  });
  it("odrzuca wartość spoza słownika", () => {
    expect(SkillFormSchema.safeParse({ name: "X", tier: "nope" }).success).toBe(false);
  });
});
