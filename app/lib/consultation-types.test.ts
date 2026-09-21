import { describe, expect, it } from "vitest";
import {
  AdhocConsultationFormSchema,
  ConsultationDocFormSchema,
  ScheduleFormSchema,
} from "~/lib/consultation-types";

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
    summary: "OK",
    items: [{ body: "Łokcie", status: "open" as const }],
  };

  it("akceptuje poprawny wpis", () => {
    expect(ConsultationDocFormSchema.safeParse(base).success).toBe(true);
  });

  it("odrzuca pustą treść punktu", () => {
    expect(
      ConsultationDocFormSchema.safeParse({ ...base, items: [{ body: " ", status: "open" }] })
        .success,
    ).toBe(false);
  });

  /**
   * D-FE-5. Dokumentacja niesie DOKŁADNIE to, co przyjmuje `POST …/document`.
   * Pięć pól, które ten schemat zbierał do 2026-09-21 — termin, czas trwania,
   * odnośnik, tytuł i okres — nie było wysyłane nigdy; formularz je pokazywał,
   * Zod walidował, a moduł wyrzucał przed żądaniem.
   */
  it("nie zbiera już pól, których ta operacja nie wysyła", () => {
    expect(Object.keys(ConsultationDocFormSchema.shape).sort()).toEqual(["items", "summary"]);
  });

  it("termin poza serią ma własny, SZERSZY schemat", () => {
    // Druga strona granicy: tam te pola są żywe, bo `POST /v1/consultations`
    // je przyjmuje. Bez tej asercji rozdzielenie schematów wyglądałoby jak
    // zwykłe skasowanie pól.
    const klucze = Object.keys(AdhocConsultationFormSchema.shape).sort();
    expect(klucze).toContain("scheduledAt");
    expect(klucze).toContain("durationMin");
    expect(klucze).toContain("meetingUrl");
    expect(
      AdhocConsultationFormSchema.safeParse({
        ...base,
        scheduledAt: "2026-06-11T18:00",
        durationMin: 45,
      }).success,
    ).toBe(true);
  });

  it("czas trwania trzyma się granic DTO backendu (5–480)", () => {
    const zScheduled = { ...base, scheduledAt: "2026-06-11T18:00" };
    expect(AdhocConsultationFormSchema.safeParse({ ...zScheduled, durationMin: 4 }).success).toBe(
      false,
    );
    expect(AdhocConsultationFormSchema.safeParse({ ...zScheduled, durationMin: 481 }).success).toBe(
      false,
    );
    expect(AdhocConsultationFormSchema.safeParse({ ...zScheduled, durationMin: 5 }).success).toBe(
      true,
    );
  });
});
