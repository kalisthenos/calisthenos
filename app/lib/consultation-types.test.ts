import { describe, expect, it } from "vitest";
import { ConsultationDocFormSchema, ScheduleFormSchema } from "~/lib/consultation-types";

describe("ScheduleFormSchema", () => {
  const weekly = {
    cadence: "weekly",
    weekday: 3,
    timeOfDay: "18:00",
    durationMin: 45,
    startsOn: "2026-06-01",
  };

  it("akceptuje poprawny harmonogram weekly", () => {
    expect(ScheduleFormSchema.safeParse(weekly).success).toBe(true);
  });
  it("wymaga weekday dla weekly", () => {
    const { weekday, ...noWeekday } = weekly;
    expect(ScheduleFormSchema.safeParse(noWeekday).success).toBe(false);
  });
  it("wymaga dayOfMonth dla monthly i odrzuca >28", () => {
    expect(
      ScheduleFormSchema.safeParse({
        cadence: "monthly",
        dayOfMonth: 15,
        timeOfDay: "09:00",
        durationMin: 60,
        startsOn: "2026-06-01",
      }).success,
    ).toBe(true);
    expect(
      ScheduleFormSchema.safeParse({
        cadence: "monthly",
        dayOfMonth: 31,
        timeOfDay: "09:00",
        durationMin: 60,
        startsOn: "2026-06-01",
      }).success,
    ).toBe(false);
  });
  it("odrzuca złą godzinę i niedodatni czas trwania", () => {
    expect(ScheduleFormSchema.safeParse({ ...weekly, timeOfDay: "25:00" }).success).toBe(false);
    expect(ScheduleFormSchema.safeParse({ ...weekly, durationMin: 0 }).success).toBe(false);
  });
});

describe("ConsultationDocFormSchema", () => {
  const base = {
    scheduledAt: "2026-06-11T18:00",
    durationMin: 45,
    title: "Czerwiec",
    summary: "OK",
    items: [{ body: "Łokcie", status: "open" as const }],
  };
  it("akceptuje poprawny wpis", () => {
    expect(ConsultationDocFormSchema.safeParse(base).success).toBe(true);
  });
  it("odrzuca pusty tytuł i pustą treść punktu", () => {
    expect(ConsultationDocFormSchema.safeParse({ ...base, title: "  " }).success).toBe(false);
    expect(
      ConsultationDocFormSchema.safeParse({ ...base, items: [{ body: " ", status: "open" }] })
        .success,
    ).toBe(false);
  });
  it("waliduje okres oba-albo-żaden + from<=to", () => {
    expect(ConsultationDocFormSchema.safeParse({ ...base, periodFrom: "2026-06-01" }).success).toBe(
      false,
    );
    expect(
      ConsultationDocFormSchema.safeParse({
        ...base,
        periodFrom: "2026-06-10",
        periodTo: "2026-06-01",
      }).success,
    ).toBe(false);
  });
});
