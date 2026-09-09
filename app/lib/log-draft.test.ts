import { describe, expect, it } from "vitest";
import {
  type DraftEntry,
  type SetDraft,
  descriptorOf,
  draftHasContent,
  moveEntry,
  parseDraft,
  rehydrateEntries,
  serializeDraft,
} from "./log-draft";
// TYLKO typ — `workouts.ts` woła klienta kontraktu, a ten test go nie potrzebuje.
import type { LogEntry } from "./workouts";

const PLAN = ["a", "b"];
const KLUCZE = ["i-1", "i-2"];

function wpis(over: Partial<DraftEntry> = {}): DraftEntry {
  return {
    key: "i-1",
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

/**
 * Ten sam wpis w kształcie v4 — bez klucza. `JSON.stringify` gubi pola równe
 * `undefined`, więc w tekście szkicu klucza po prostu nie ma.
 */
function wpisBezKlucza(): Record<string, unknown> {
  return { ...wpis(), key: undefined };
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

describe("serializeDraft / parseDraft — szkic v5", () => {
  it("przywraca szkic z LICZBĄ SERII inną niż plan", () => {
    // Sedno v4: dokładnie ten przypadek v3 odrzucało, i to bez komunikatu.
    const raw = serializeDraft(PLAN, [
      wpis({ sets: [seria(), seria(), seria()] }),
      wpis({ key: "i-2", exerciseId: "b" }),
    ]);
    expect(parseDraft(raw, { planExerciseIds: PLAN, planKeys: KLUCZE })?.[0]?.sets).toHaveLength(3);
  });

  it("przywraca zamiennik razem z tym, co zastąpił", () => {
    const raw = serializeDraft(PLAN, [
      wpis({
        exerciseId: "z",
        exerciseName: "Wiosło",
        origin: "substitute",
        substitutedExerciseId: "a",
      }),
      wpis({ key: "i-2", exerciseId: "b" }),
    ]);
    expect(parseDraft(raw, { planExerciseIds: PLAN, planKeys: KLUCZE })?.[0]).toMatchObject({
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
      wpis({ key: "i-2", exerciseId: "b" }),
      wpis({ exerciseId: "c", exerciseName: "Rower", tracksRpe: false, origin: "extra" }),
    ]);
    const wynik = parseDraft(raw, { planExerciseIds: PLAN, planKeys: KLUCZE });
    expect(wynik?.[2]).toMatchObject({ origin: "extra", exerciseName: "Rower", tracksRpe: false });
  });

  it("odrzuca szkic, gdy trener zmienił ćwiczenia planu", () => {
    const raw = serializeDraft(["a", "b"], [wpis(), wpis({ key: "i-2", exerciseId: "b" })]);
    expect(parseDraft(raw, { planExerciseIds: ["a", "x"], planKeys: KLUCZE })).toBeNull();
    // Ta sama bramka łapie też zmianę LICZBY ćwiczeń planu, nie tylko podmianę.
    expect(parseDraft(raw, { planExerciseIds: ["a"], planKeys: ["i-1"] })).toBeNull();
    expect(
      parseDraft(raw, { planExerciseIds: ["a", "b", "c"], planKeys: ["i-1", "i-2", "i-3"] }),
    ).toBeNull();
  });

  it("szkic v4 jest MIGROWANY, nie odrzucany — klucze wracają z kolejności planu", () => {
    // Odstępstwo od decyzji z v2/v3 i ma powód: tamtych nie dało się zmigrować
    // (v3 nie znało pojęcia zamiany ani zmiennej liczby serii), a tu brakuje
    // WYŁĄCZNIE klucza — a w v4 wpisy z planu stały z definicji w kolejności
    // planu, bo parował je kursor. Cena odrzucenia byłaby najwyższa z całej
    // serii: wdrożenie w trakcie treningu kasuje wypełniony formularz bez słowa,
    // bo trasa po nieudanym parsowaniu USUWA szkic ze storage.
    const v4 = JSON.stringify({
      v: 4,
      planExerciseIds: PLAN,
      entries: [
        wpisBezKlucza(),
        { ...wpisBezKlucza(), exerciseId: "b" },
        { ...wpisBezKlucza(), exerciseId: "x", origin: "extra" },
      ],
    });

    const wynik = parseDraft(v4, { planExerciseIds: PLAN, planKeys: KLUCZE });

    expect(wynik?.map((w) => w.key)).toEqual(["i-1", "i-2", "extra:v4-2"]);
    // Treść przechodzi nietknięta — migracja dotyczy klucza, niczego więcej.
    expect(wynik?.[0]?.sets).toEqual([
      { reps: "8", difficulty: "7", skipped: false, videoFileId: null },
    ]);
  });

  it("szkic v4 o innej liczbie wpisów z planu niż pozycji planu jest odrzucany", () => {
    // Kursor nie ma czego odtworzyć: szkic uszkodzony albo podrobiony. Ta sama
    // odpowiedź co przy każdym innym rozjeździe z planem.
    const v4 = JSON.stringify({ v: 4, planExerciseIds: PLAN, entries: [wpisBezKlucza()] });
    expect(parseDraft(v4, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("odrzuca szkice v3 — tych migracja nie sięga", () => {
    // v3 nie ma jak powiedzieć, który wpis jest zamianą ani ile serii ma dodatek,
    // bo tych pojęć nie znało. Wstawienie danych o takim kształcie byłoby gorsze
    // niż start od zera; ta sama decyzja co przy odrzuceniu v2.
    expect(
      parseDraft(JSON.stringify({ v: 3, exerciseIds: PLAN, sets: [[]] }), {
        planExerciseIds: PLAN,
        planKeys: KLUCZE,
      }),
    ).toBeNull();
  });

  it("odrzuca szkic v5 bez klucza wpisu", () => {
    // Numer wersji się zgadza, pole nie — szkic podrobiony albo z połowicznej
    // migracji. sessionStorage jest danymi niezaufanymi tak samo jak ciało
    // żądania, więc brak klucza jest odmową, nie domysłem.
    expect(
      parseDraft(JSON.stringify({ v: 5, planExerciseIds: PLAN, entries: [wpisBezKlucza()] }), {
        planExerciseIds: PLAN,
        planKeys: KLUCZE,
      }),
    ).toBeNull();
  });

  it("odrzuca szkic v5, gdy klucz wpisu nie jest kluczem ŻADNEJ pozycji tego planu", () => {
    // Tak wygląda plan, w którym trener skasował pozycję i dodał z powrotem to
    // samo ćwiczenie: `planExerciseIds` bez zmian, `plan_items.id` nowe. Bez
    // tego sprawdzenia szkic przechodziłby, a `rehydrateEntries` degradowałby
    // wpis po wpisie do „spoza planu" — z utratą celu, notatki i wskaźnika
    // zamiany, po cichu. Rozjazd kluczy to ten sam fakt co rozjazd ćwiczeń
    // planu — trener zmienił plan — więc i ta sama odpowiedź.
    const raw = serializeDraft(PLAN, [
      wpis({ key: "i-STARY" }),
      wpis({ key: "i-2", exerciseId: "b" }),
    ]);
    expect(parseDraft(raw, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("odrzuca szkic v5, w którym dwa wpisy wskazują tę samą pozycję planu", () => {
    const raw = serializeDraft(PLAN, [wpis(), wpis({ exerciseId: "b" })]);
    expect(parseDraft(raw, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("zwraca null dla braku danych", () => {
    expect(parseDraft(null, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
    expect(parseDraft("", { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("odrzuca niepoprawny JSON", () => {
    expect(parseDraft("{nie-json", { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("odrzuca szkic o błędnych typach pól wpisu", () => {
    const bad = JSON.stringify({
      v: 5,
      planExerciseIds: PLAN,
      entries: [{ ...wpis(), tracksRpe: "tak" }, wpis({ key: "i-2", exerciseId: "b" })],
    });
    expect(parseDraft(bad, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("odrzuca szkic o błędnych typach pól serii", () => {
    const bad = JSON.stringify({
      v: 5,
      planExerciseIds: PLAN,
      entries: [
        { ...wpis(), sets: [{ reps: 8, difficulty: "7", skipped: false, videoFileId: null }] },
        wpis({ key: "i-2", exerciseId: "b" }),
      ],
    });
    expect(parseDraft(bad, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });

  it("odrzuca szkic z nieznanym pochodzeniem wpisu", () => {
    const bad = JSON.stringify({
      v: 5,
      planExerciseIds: PLAN,
      entries: [{ ...wpis(), origin: "nieznane" }, wpis({ key: "i-2", exerciseId: "b" })],
    });
    expect(parseDraft(bad, { planExerciseIds: PLAN, planKeys: KLUCZE })).toBeNull();
  });
});

describe("draftHasContent", () => {
  const KLUCZE_PLANU = ["i-1", "i-2"];

  it("false, gdy wpisy stoją w kolejności planu i wszystkie serie są puste", () => {
    expect(
      draftHasContent(
        [wpis({ sets: [seria()] }), wpis({ key: "i-2", exerciseId: "b", sets: [seria()] })],
        KLUCZE_PLANU,
      ),
    ).toBe(false);
  });

  it("true, gdy jakakolwiek seria wpisu planned ma reps, trudność, pominięcie lub nagranie", () => {
    expect(draftHasContent([wpis({ sets: [seria({ reps: "8" })] })], ["i-1"])).toBe(true);
    expect(draftHasContent([wpis({ sets: [seria({ difficulty: "5" })] })], ["i-1"])).toBe(true);
    expect(draftHasContent([wpis({ sets: [seria({ skipped: true })] })], ["i-1"])).toBe(true);
    expect(draftHasContent([wpis({ sets: [seria({ videoFileId: "f-1" })] })], ["i-1"])).toBe(true);
  });

  it("szkic z samym dodatkiem MA treść", () => {
    // Dodatek spoza planu jest treścią sam w sobie, nawet z pustymi seriami:
    // podopieczny podjął decyzję, której nie chcemy mu kazać podejmować drugi raz.
    expect(draftHasContent([wpis({ origin: "extra", sets: [seria({ reps: "" })] })], [])).toBe(
      true,
    );
  });

  it("szkic z samym PRZESTAWIENIEM też MA treść", () => {
    // Ta sama reguła co przy dodatku i z tego samego powodu. Bez niej trening
    // poprzestawiany, ale jeszcze niewypełniony, byłby po awarii przywrócony
    // w kolejności PLANU — czyli w tej, której podopieczny właśnie nie wybrał —
    // a szkic zostałby po cichu skasowany (usuwa go removeItem w trasie), więc nie
    // zostałby nawet ślad do odzyskania.
    expect(
      draftHasContent(
        [wpis({ key: "i-2", exerciseId: "b", sets: [seria()] }), wpis({ sets: [seria()] })],
        KLUCZE_PLANU,
      ),
    ).toBe(true);
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
      wpis({ key: "i-2", exerciseId: "b" }),
    ]);

    expect(zamiennik?.expectedReps).toBeNull();
    expect(zamiennik?.note).toBeNull();
    // Liczba serii ZOSTAJE: to cel planu niezależnie od tego, czym się go wykona.
    expect(zamiennik?.plannedSets).toBe(3);
  });

  it("zamiennik zna nazwę tego, co zastąpił, i zachowuje klucz swojej pozycji planu", () => {
    const [zamiennik] = rehydrateEntries(PLAN, [
      wpis({
        exerciseId: "z",
        exerciseName: "Plank",
        origin: "substitute",
        substitutedExerciseId: "a",
      }),
      wpis({ key: "i-2", exerciseId: "b" }),
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
    const wpisy = rehydrateEntries(PLAN, [wpis(), wpis({ key: "i-2", exerciseId: "b" })]);

    expect(wpisy[1]).toMatchObject({
      key: "i-2",
      plannedSets: 2,
      expectedReps: 10,
      note: null,
      isDropsetItem: true,
    });
    expect(wpisy[0]).toMatchObject({ expectedReps: 8, note: "kontrola na dole" });
  });

  it("PRZESTAWIONY szkic wraca w swojej kolejności, a każdy wpis ze SWOIMI polami z planu", () => {
    // Kanarek zmiany „kolejność wykonania". Parowanie szło dotąd KURSOREM po
    // pozycjach planu, więc pierwszy wpis szkicu zawsze dostawał pola pierwszej
    // pozycji planu. Po przestawieniu ćwiczeń przez podopiecznego dałoby to
    // Dipowi cel „2 serie × 8" i notatkę „kontrola na dole" od Podciągania —
    // po cichu, bo liczby są prawdopodobne, a szkic wraca bez komunikatu.
    const wpisy = rehydrateEntries(PLAN, [
      wpis({ key: "i-2", exerciseId: "b", exerciseName: "Dip" }),
      wpis(),
    ]);

    expect(
      wpisy.map((w) => [w.key, w.exerciseId, w.plannedSets, w.expectedReps, w.isDropsetItem]),
    ).toEqual([
      ["i-2", "b", 2, 10, true],
      ["i-1", "a", 3, 8, false],
    ]);
    expect(wpisy[0]?.note).toBeNull();
    expect(wpisy[1]?.note).toBe("kontrola na dole");
  });

  it("dodatek spoza planu dostaje ŚWIEŻY klucz i nie zabiera go żadnej pozycji planu", () => {
    // Klucz dodatku ze szkicu jest ignorowany celowo: szkic to dane niezaufane,
    // a klucz nadany na nowo z pozycji w tablicy nie ma jak powtórzyć się ani
    // zderzyć z kluczem pozycji planu.
    const wpisy = rehydrateEntries(PLAN, [
      wpis({ key: "extra:n0", exerciseId: "x", exerciseName: "Wiosło", origin: "extra" }),
      wpis(),
      wpis({ key: "i-2", exerciseId: "b" }),
    ]);

    expect(wpisy.map((w) => [w.key, w.origin, w.plannedSets])).toEqual([
      ["extra:r0", "extra", null],
      ["i-1", "planned", 3],
      ["i-2", "planned", 2],
    ]);
  });

  it("wpis o NIEZNANYM kluczu degraduje się do wpisu spoza planu", () => {
    // Kształt, którego formularz nigdy nie wytwarza — czyli szkic podrobiony,
    // uszkodzony albo z planu, który trener właśnie przebudował. Degradacja do
    // `extra` BEZ wskaźnika zamiany jest bezpieczna: wskaźnik na ćwiczenie spoza
    // sesji backend odrzuciłby (N13), a tak zostaje zwykły wpis dodatkowy, który
    // da się usunąć jednym kliknięciem.
    const wpisy = rehydrateEntries(PLAN, [
      wpis(),
      wpis({ key: "i-999", exerciseId: "b", origin: "substitute", substitutedExerciseId: "a" }),
    ]);

    expect(wpisy[1]).toMatchObject({
      origin: "extra",
      substitutedExerciseId: null,
      plannedSets: null,
      expectedReps: null,
    });
  });

  it("dwa wpisy o TYM SAMYM kluczu — drugi degraduje się, klucze zostają unikalne", () => {
    // Dziura otwarta przez parowanie po kluczu, więc zamknięta razem z nim:
    // podrobiony szkic mógłby wskazać jedną pozycję planu dwa razy, a dwie karty
    // o tym samym `key` to dla Reacta nie ostrzeżenie, tylko przepisanie stanu
    // jednej karty na drugą — z nagraniem i wpisanymi seriami włącznie.
    const wpisy = rehydrateEntries(PLAN, [
      wpis(),
      wpis({ exerciseId: "c", exerciseName: "Rower" }),
    ]);

    expect(wpisy.map((w) => w.key)).toEqual(["i-1", "extra:r1"]);
    expect(wpisy[1]).toMatchObject({ origin: "extra", plannedSets: null });
  });
});

describe("moveEntry — kolejność WYKONANIA, nie kolejność planu", () => {
  const A = wpisPlanu();
  const B = wpisPlanu({ key: "i-2", exerciseId: "b", exerciseName: "Dip" });
  const C = wpisPlanu({
    key: "extra:n0",
    exerciseId: "c",
    exerciseName: "Rower",
    origin: "extra",
    plannedSets: null,
    expectedReps: null,
    note: null,
  });
  const LISTA = [A, B, C];

  it("przesuwa wpis wyżej i nie rusza pozostałych", () => {
    expect(moveEntry(LISTA, 1, 0).map((w) => w.key)).toEqual(["i-2", "i-1", "extra:n0"]);
  });

  it("przesuwa wpis niżej, przez całą listę", () => {
    expect(moveEntry(LISTA, 0, 2).map((w) => w.key)).toEqual(["i-2", "extra:n0", "i-1"]);
  });

  it("dodatek spoza planu wolno wciągnąć NAD ćwiczenia z planu", () => {
    // To jest cały powód tej funkcji: „rower zrobiłem na rozgrzewkę, przed
    // planem". Backend nie ma tu zdania — kolejność wpisów w ładunku jest
    // kolejnością wykonania i nic w niej nie musi zgadzać się z planem.
    expect(moveEntry(LISTA, 2, 0).map((w) => w.key)).toEqual(["extra:n0", "i-1", "i-2"]);
  });

  it("zachowuje wpis, nie tylko jego miejsce", () => {
    expect(moveEntry([A, B], 1, 0)[0]).toBe(B);
  });

  it("nie ma dokąd — oddaje TĘ SAMĄ tablicę, nie kopię", () => {
    // Referencja, nie kopia, i to nie są porządki: „wyżej" z pierwszego wiersza
    // i „niżej" z ostatniego to w tym ekranie zwykłe kliknięcie w wyszarzony
    // przycisk, a nowa tablica kazałaby Reactowi przerysować wszystkie karty
    // za nic — w tym pola z trwającą wysyłką nagrania.
    expect(moveEntry(LISTA, 0, -1)).toBe(LISTA);
    expect(moveEntry(LISTA, 2, 3)).toBe(LISTA);
    expect(moveEntry(LISTA, 1, 1)).toBe(LISTA);
  });

  it("indeks spoza listy nie wywraca się ani nie gubi wpisu", () => {
    // `findIndex` w trasie oddaje -1, gdy wpisu już nie ma — to jest ta ścieżka.
    expect(moveEntry(LISTA, -1, 0)).toBe(LISTA);
    expect(moveEntry(LISTA, 9, 0)).toBe(LISTA);
  });
});
