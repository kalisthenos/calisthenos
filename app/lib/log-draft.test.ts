import { describe, expect, it } from "vitest";
import {
  type DraftEntry,
  type SetDraft,
  draftHasContent,
  parseDraft,
  serializeDraft,
} from "./log-draft";

const PLAN = ["a", "b"];

function wpis(over: Partial<DraftEntry> = {}): DraftEntry {
  return {
    exerciseId: "a",
    exerciseName: "Podciąganie",
    unit: "REPS",
    tracksRpe: true,
    origin: "planned",
    substitutedExerciseId: null,
    sets: [{ reps: "8", difficulty: "7", skipped: false, videoFileId: null }],
    ...over,
  };
}

function seria(over: Partial<SetDraft> = {}): SetDraft {
  return { reps: "", difficulty: "", skipped: false, videoFileId: null, ...over };
}

describe("serializeDraft / parseDraft — szkic v4", () => {
  it("przywraca szkic z LICZBĄ SERII inną niż plan", () => {
    // Sedno v4: dokładnie ten przypadek v3 odrzucało, i to bez komunikatu.
    const raw = serializeDraft(PLAN, [
      wpis({ sets: [seria(), seria(), seria()] }),
      wpis({ exerciseId: "b" }),
    ]);
    expect(parseDraft(raw, { planExerciseIds: PLAN })?.[0]?.sets).toHaveLength(3);
  });

  it("przywraca zamiennik razem z tym, co zastąpił", () => {
    const raw = serializeDraft(PLAN, [
      wpis({
        exerciseId: "z",
        exerciseName: "Wiosło",
        origin: "substitute",
        substitutedExerciseId: "a",
      }),
      wpis({ exerciseId: "b" }),
    ]);
    expect(parseDraft(raw, { planExerciseIds: PLAN })?.[0]).toMatchObject({
      origin: "substitute",
      substitutedExerciseId: "a",
    });
  });

  it("przywraca dodatek spoza planu wraz z jego nazwą i flagą oceny", () => {
    // Nazwa i `tracksRpe` jadą W SZKICU, nie są dociągane: przywrócenie dzieje się
    // przy montowaniu komponentu, a biblioteka schodzi dopiero przy otwarciu
    // wybieraka. Cena: po zmianie nazwy przez trenera szkic pokaże starą — przez
    // jedną sesję przeglądarki i wyłącznie w etykiecie, bo do backendu jedzie
    // identyfikator.
    const raw = serializeDraft(PLAN, [
      wpis(),
      wpis({ exerciseId: "b" }),
      wpis({ exerciseId: "c", exerciseName: "Rower", tracksRpe: false, origin: "extra" }),
    ]);
    const wynik = parseDraft(raw, { planExerciseIds: PLAN });
    expect(wynik?.[2]).toMatchObject({ origin: "extra", exerciseName: "Rower", tracksRpe: false });
  });

  it("odrzuca szkic, gdy trener zmienił ćwiczenia planu", () => {
    const raw = serializeDraft(["a", "b"], [wpis(), wpis({ exerciseId: "b" })]);
    expect(parseDraft(raw, { planExerciseIds: ["a", "x"] })).toBeNull();
    // Ta sama bramka łapie też zmianę LICZBY ćwiczeń planu, nie tylko podmianę.
    expect(parseDraft(raw, { planExerciseIds: ["a"] })).toBeNull();
    expect(parseDraft(raw, { planExerciseIds: ["a", "b", "c"] })).toBeNull();
  });

  it("odrzuca szkice v3 — migracja nie jest warta kodu", () => {
    // Szkice żyją przez sesję przeglądarki. Wstawienie danych o niepełnym
    // kształcie byłoby gorsze niż start od zera; ta sama decyzja co przy v2.
    expect(
      parseDraft(JSON.stringify({ v: 3, exerciseIds: PLAN, sets: [[]] }), {
        planExerciseIds: PLAN,
      }),
    ).toBeNull();
  });

  it("zwraca null dla braku danych", () => {
    expect(parseDraft(null, { planExerciseIds: PLAN })).toBeNull();
    expect(parseDraft("", { planExerciseIds: PLAN })).toBeNull();
  });

  it("odrzuca niepoprawny JSON", () => {
    expect(parseDraft("{nie-json", { planExerciseIds: PLAN })).toBeNull();
  });

  it("odrzuca szkic o błędnych typach pól wpisu", () => {
    const bad = JSON.stringify({
      v: 4,
      planExerciseIds: PLAN,
      entries: [{ ...wpis(), tracksRpe: "tak" }, wpis({ exerciseId: "b" })],
    });
    expect(parseDraft(bad, { planExerciseIds: PLAN })).toBeNull();
  });

  it("odrzuca szkic o błędnych typach pól serii", () => {
    const bad = JSON.stringify({
      v: 4,
      planExerciseIds: PLAN,
      entries: [
        { ...wpis(), sets: [{ reps: 8, difficulty: "7", skipped: false, videoFileId: null }] },
        wpis({ exerciseId: "b" }),
      ],
    });
    expect(parseDraft(bad, { planExerciseIds: PLAN })).toBeNull();
  });

  it("odrzuca szkic z nieznanym pochodzeniem wpisu", () => {
    const bad = JSON.stringify({
      v: 4,
      planExerciseIds: PLAN,
      entries: [{ ...wpis(), origin: "nieznane" }, wpis({ exerciseId: "b" })],
    });
    expect(parseDraft(bad, { planExerciseIds: PLAN })).toBeNull();
  });
});

describe("draftHasContent", () => {
  it("false, gdy wszystkie wpisy planned i wszystkie serie puste", () => {
    expect(
      draftHasContent([wpis({ sets: [seria()] }), wpis({ exerciseId: "b", sets: [seria()] })]),
    ).toBe(false);
  });

  it("true, gdy jakakolwiek seria wpisu planned ma reps, trudność, pominięcie lub nagranie", () => {
    expect(draftHasContent([wpis({ sets: [seria({ reps: "8" })] })])).toBe(true);
    expect(draftHasContent([wpis({ sets: [seria({ difficulty: "5" })] })])).toBe(true);
    expect(draftHasContent([wpis({ sets: [seria({ skipped: true })] })])).toBe(true);
    expect(draftHasContent([wpis({ sets: [seria({ videoFileId: "f-1" })] })])).toBe(true);
  });

  it("szkic z samym dodatkiem MA treść", () => {
    // Dodatek spoza planu jest treścią sam w sobie, nawet z pustymi seriami:
    // podopieczny podjął decyzję, której nie chcemy mu kazać podejmować drugi raz.
    expect(draftHasContent([wpis({ origin: "extra", sets: [seria({ reps: "" })] })])).toBe(true);
  });
});
