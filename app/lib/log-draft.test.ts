import { describe, expect, it } from "vitest";
import {
  type DraftEntry,
  type SetDraft,
  descriptorOf,
  draftHasContent,
  parseDraft,
  rehydrateEntries,
  serializeDraft,
} from "./log-draft";
// TYLKO typ — `workouts.ts` woła klienta kontraktu, a ten test go nie potrzebuje.
import type { LogEntry } from "./workouts";

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

/** Wpis PLANU, taki jak z `toLogEntries` — punkt odniesienia dla przywracania. */
function wpisPlanu(over: Partial<LogEntry> = {}): LogEntry {
  return {
    key: "i-1",
    exerciseId: "a",
    exerciseName: "Podciąganie",
    unit: "REPS",
    tracksRpe: true,
    origin: "planned",
    substitutedExerciseId: null,
    substitutedExerciseName: null,
    plannedSets: 3,
    expectedReps: 8,
    note: "kontrola na dole",
    isDropsetItem: false,
    sets: [seria(), seria(), seria()],
    ...over,
  };
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
describe("descriptorOf — kształt wpisu dla akcji trasy", () => {
  it("niesie LICZBĘ wierszy zamiast serii, i cel z planu obok niej", () => {
    // Deskryptor jedzie ukrytym polem obok właściwych pól formularza. Gdyby wiózł
    // serie, dublowałby dane, które akcja i tak czyta z `e_{i}_s_{j}_*`; gdyby nie
    // wiózł `plannedSets`, akcja nie odróżniłaby wiersza planowanego od dołożonego
    // i wiersz dorzucony ponad plan psułby `allDone`.
    expect(descriptorOf(wpisPlanu({ sets: [seria(), seria(), seria(), seria()] }))).toEqual({
      exerciseId: "a",
      exerciseName: "Podciąganie",
      unit: "REPS",
      tracksRpe: true,
      origin: "planned",
      substitutedExerciseId: null,
      plannedSets: 3,
      setCount: 4,
    });
  });

  it("wpis spoza planu oddaje plannedSets null — nie ma czym skłamać o celu", () => {
    // `plannedSets: null` jest dla akcji sygnałem „ten wpis nie wchodzi do
    // rachunku `allDone`". Podstawienie tu jakiejkolwiek liczby sprawiłoby, że
    // dorzucone ćwiczenie mogłoby zepsuć flagę wykonania planu.
    const d = descriptorOf(
      wpisPlanu({ origin: "extra", plannedSets: null, expectedReps: null, sets: [seria()] }),
    );
    expect(d).toMatchObject({ origin: "extra", plannedSets: null, setCount: 1 });
  });
});

describe("rehydrateEntries — szkic wraca na wpisy formularza", () => {
  const PLAN = [
    wpisPlanu(),
    wpisPlanu({
      key: "i-2",
      exerciseId: "b",
      exerciseName: "Dip",
      tracksRpe: false,
      plannedSets: 2,
      expectedReps: 10,
      note: null,
      isDropsetItem: true,
      sets: [seria(), seria()],
    }),
  ];

  it("zamiennik NIE dziedziczy celu powtórzeń ani notatki po ćwiczeniu, które zastąpił", () => {
    // TA asercja jest sednem: cel „× 8" z planu „Podciąganie 3×8" jest WPISYWANY
    // do pola powtórzeń, gdy podopieczny kliknie trudność. Zamiennik „Plank"
    // (jednostka SEC) dostałby wtedy osiem SEKUND zamiast sześćdziesięciu — i nikt
    // nie musi tego zauważyć, bo liczba jest prawdopodobna. Notatka trenera też
    // dotyczyła ćwiczenia, którego już tu nie ma.
    const [zamiennik] = rehydrateEntries(PLAN, [
      wpis({
        exerciseId: "z",
        exerciseName: "Plank",
        unit: "SEC",
        tracksRpe: false,
        origin: "substitute",
        substitutedExerciseId: "a",
        sets: [seria(), seria(), seria()],
      }),
      wpis({ exerciseId: "b" }),
    ]);

    expect(zamiennik?.expectedReps).toBeNull();
    expect(zamiennik?.note).toBeNull();
    // Liczba serii ZOSTAJE: to cel planu niezależnie od tego, czym się go wykona.
    expect(zamiennik?.plannedSets).toBe(3);
  });

  it("zamiennik zostaje na pozycji planu i zna nazwę tego, co zastąpił", () => {
    const [zamiennik] = rehydrateEntries(PLAN, [
      wpis({
        exerciseId: "z",
        exerciseName: "Plank",
        origin: "substitute",
        substitutedExerciseId: "a",
      }),
      wpis({ exerciseId: "b" }),
    ]);

    expect(zamiennik).toMatchObject({
      key: "i-1",
      exerciseId: "z",
      origin: "substitute",
      substitutedExerciseId: "a",
      substitutedExerciseName: "Podciąganie",
      isDropsetItem: false,
    });
  });

  it("wpis planowany wraca z celem, notatką i flagą dropsetu Z PLANU", () => {
    // Szkic ich nie wozi — są potrzebne wyłącznie do NARYSOWANIA karty. Wzięcie
    // ich z niewłaściwej pozycji planu pokazałoby cudzą notatkę przy ćwiczeniu.
    const wpisy = rehydrateEntries(PLAN, [wpis(), wpis({ exerciseId: "b" })]);

    expect(wpisy[1]).toMatchObject({
      key: "i-2",
      plannedSets: 2,
      expectedReps: 10,
      note: null,
      isDropsetItem: true,
    });
    expect(wpisy[0]).toMatchObject({ expectedReps: 8, note: "kontrola na dole" });
  });

  it("dodatek spoza planu NIE zjada pozycji planu — kursor idzie tylko po wpisach z planu", () => {
    // Gdyby dopasowanie szło indeksem tablicy szkicu, dodatek przesunąłby wszystko
    // po sobie o jedno i drugi wpis planu dostałby cel oraz notatkę trzeciego.
    // Dziś dodatki doklejają się na końcu, ale szkic jest danymi niezaufanymi
    // i kolejność w nim może być dowolna.
    const wpisy = rehydrateEntries(PLAN, [
      wpis({ exerciseId: "x", exerciseName: "Wiosło", origin: "extra" }),
      wpis(),
      wpis({ exerciseId: "b" }),
    ]);

    expect(wpisy.map((w) => [w.key, w.origin, w.plannedSets])).toEqual([
      ["extra:r0", "extra", null],
      ["i-1", "planned", 3],
      ["i-2", "planned", 2],
    ]);
  });

  it("nadmiar wpisów z planu ponad pozycje planu degraduje się do wpisu spoza planu", () => {
    // Kształt, którego formularz nigdy nie wytwarza — czyli szkic podrobiony albo
    // uszkodzony. Degradacja do `extra` BEZ wskaźnika zamiany jest bezpieczna:
    // wskaźnik na ćwiczenie spoza sesji backend odrzuciłby (N13), a tak zostaje
    // zwykły wpis dodatkowy, który da się usunąć jednym kliknięciem.
    const wpisy = rehydrateEntries(
      [wpisPlanu()],
      [wpis(), wpis({ exerciseId: "b", origin: "substitute", substitutedExerciseId: "a" })],
    );

    expect(wpisy[1]).toMatchObject({
      origin: "extra",
      substitutedExerciseId: null,
      plannedSets: null,
      expectedReps: null,
    });
  });
});
