import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  type WrappedSummaryView,
  describeArchetype,
  formatYM,
  isPastMonth,
  latestWrappedMonth,
  loadWrappedSummary,
  monthLabel,
  parseYM,
} from "./wrapped";

function klient(reguly: (req: Request) => Response | Promise<Response>) {
  return createApiClient({
    baseUrl: "http://be.test",
    getToken: () => "T",
    fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
  });
}

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function odmowa(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

describe("latestWrappedMonth — najświeższy miesiąc podsumowań", () => {
  it("wybiera najpóźniejszy miesiąc po `ym`, niezależnie od kolejności w liście", () => {
    // Porządek `wrappedMonths` z kontraktu nie jest częścią kontraktu. Baner
    // „świeży wrapped" ma pokazać ostatni zamknięty miesiąc, nie pierwszy
    // element tablicy — inaczej zmiana `ORDER BY` po stronie BE cofnęłaby baner
    // o rok bez żadnego błędu.
    const miesiace = [
      { ym: "2026-06", year: 2026, month: 6, label: "czerwiec 2026", sessions: 4 },
      { ym: "2026-08", year: 2026, month: 8, label: "sierpień 2026", sessions: 9 },
      { ym: "2026-07", year: 2026, month: 7, label: "lipiec 2026", sessions: 2 },
    ];

    expect(latestWrappedMonth(miesiace)?.ym).toBe("2026-08");
  });

  it("pusta lista daje `null` — baner się nie renderuje", () => {
    expect(latestWrappedMonth([])).toBeNull();
  });

  it("granica roku: `2026-01` jest późniejszy niż `2025-12`, mimo niższego `month`", () => {
    // Porównanie leksykograficzne `YYYY-MM` jest poprawne z konstrukcji, ale to
    // jedyne miejsce, które tę własność zapisuje — naiwne porównanie samego
    // `month` przeszłoby pozostałe przypadki.
    const miesiace = [
      { ym: "2026-01", year: 2026, month: 1, label: "styczeń 2026", sessions: 3 },
      { ym: "2025-12", year: 2025, month: 12, label: "grudzień 2025", sessions: 5 },
    ];

    expect(latestWrappedMonth(miesiace)?.ym).toBe("2026-01");
  });
});

describe("parseYM / formatYM / monthLabel / isPastMonth — czyste helpery miesiąca", () => {
  it("`parseYM` przyjmuje wyłącznie `YYYY-MM` z miesiącem 01–12", () => {
    // Trasa `/podopieczny/wrapped/:ym` bierze `ym` wprost z adresu, więc to
    // jedyna bramka między ręcznie zedytowanym URL-em a żądaniem do BE.
    expect(parseYM("2026-08")).toEqual({ year: 2026, month: 8 });
    expect(parseYM("2026-13")).toBeNull();
    expect(parseYM("2026-00")).toBeNull();
    expect(parseYM("2026-8")).toBeNull();
    expect(parseYM("sierpień")).toBeNull();
  });

  it("`formatYM` dopełnia miesiąc zerem — `parseYM` przyjmuje własny wynik", () => {
    expect(formatYM(2026, 3)).toBe("2026-03");
    expect(parseYM(formatYM(2026, 3))).toEqual({ year: 2026, month: 3 });
  });

  it("`monthLabel` daje polską nazwę miesiąca z rokiem", () => {
    expect(monthLabel(2026, 1)).toBe("Styczeń 2026");
    expect(monthLabel(2026, 12)).toBe("Grudzień 2026");
  });

  it("`isPastMonth` odcina miesiąc bieżący i przyszły", () => {
    // Podsumowanie otwiera się dopiero pierwszego dnia następnego miesiąca —
    // bieżący miesiąc ma dać `404`, nie połowiczne dane. Punkt odniesienia
    // liczony z zegara, żeby test nie zgnił po zmianie roku.
    const teraz = new Date();
    const rok = teraz.getUTCFullYear();
    const miesiac = teraz.getUTCMonth() + 1;

    expect(isPastMonth(rok, miesiac)).toBe(false);
    expect(isPastMonth(rok + 1, 1)).toBe(false);
    expect(isPastMonth(rok - 1, 12)).toBe(true);
  });
});

const PODSUMOWANIE: WrappedSummaryView = {
  ym: "2026-08",
  year: 2026,
  month: 8,
  label: "Sierpień 2026",
  sessions: 12,
  totalSets: 140,
  totalReps: 980,
  totalSeconds: 210,
  topExercise: {
    exerciseId: "e-1",
    exerciseName: "Podciąganie",
    unit: "REPS",
    sessionsInvolved: 9,
    pctOfSessions: 75,
  },
  prs: [
    { exerciseId: "e-1", exerciseName: "Podciąganie", unit: "REPS", reps: 12, previousBest: 10 },
  ],
  heaviestDay: {
    date: "2026-08-14",
    sessionName: "Dzień A",
    setCount: 18,
    totalReps: 140,
    avgRpe: 8.2,
  },
  archetype: { key: "specialist", emoji: "🎯", newExercises: 1, distinctExercises: 4 },
  vsPrevious: {
    hasPrevious: true,
    sessionsThis: 12,
    sessionsPrev: 9,
    sessionsDelta: 3,
    repsThis: 980,
    repsPrev: 800,
    repsDeltaPct: 23,
    avgRpeThis: 7.6,
    avgRpePrev: 7.2,
    rpeDelta: 0.4,
  },
};

describe("loadWrappedSummary — podsumowanie miesiąca z kontraktu", () => {
  it("idzie pod `/v1/me/wrapped/{ym}` — jednoelementowa tablica `path.ym` serializuje się do segmentu", async () => {
    // Generator typuje `path.ym` jako `Array<string>`, choć ścieżka ma jeden
    // segment (L S5-4). Styl `simple` bez `explode` skleja tablicę przecinkami,
    // więc jeden element daje goły `2026-08` — ten test jest jedynym dowodem,
    // że opakowanie w `[ym]` niczego nie psuje.
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, PODSUMOWANIE);
    });

    const wynik = await loadWrappedSummary(api, "2026-08");

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/me/wrapped/2026-08");
    expect(wynik?.sessions).toBe(12);
  });

  it("cała arytmetyka przychodzi gotowa — moduł nie liczy ani sum, ani porównania", async () => {
    // Sumy, rekordy, najcięższy dzień i delta miesiąc-do-miesiąca liczyły się
    // do integracji w FE sześcioma zapytaniami. Test utrwala, że pola idą 1:1
    // i że nikt nie dopisał tu ponownego przeliczania.
    const api = klient(() => json(200, PODSUMOWANIE));

    const wynik = await loadWrappedSummary(api, "2026-08");

    expect(wynik?.totalReps).toBe(980);
    expect(wynik?.prs).toHaveLength(1);
    expect(wynik?.heaviestDay?.avgRpe).toBe(8.2);
    expect(wynik?.vsPrevious.repsDeltaPct).toBe(23);
  });

  it("`404` daje `null` — miesiąc bez danych, a nie awaria", async () => {
    // `docs/04`: „`404`, gdy brak danych". Dawna flaga `hasData` zniknęła —
    // brak treningów i nieistniejący miesiąc to po tamtej stronie jedna odpowiedź.
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Brak danych za ten miesiąc."));

    expect(await loadWrappedSummary(api, "2020-01")).toBeNull();
  });

  it("`500` przechodzi jako ApiError — awaria BE nie może wyglądać jak pusty miesiąc", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await loadWrappedSummary(api, "2026-08").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
  });
});

describe("describeArchetype — polska etykieta i opis nad danymi kontraktu", () => {
  it("`key` i `emoji` przechodzą z kontraktu, etykieta dochodzi ze słownika", () => {
    const wynik = describeArchetype(PODSUMOWANIE);

    expect(wynik.key).toBe("specialist");
    expect(wynik.emoji).toBe("🎯");
    expect(wynik.label).toBe("Specjalista");
  });

  it("opis specjalisty bierze procent sesji z `topExercise`", () => {
    // Cztery z dziewięciu opisów mówią „ile". Wszystkie liczby są w odpowiedzi,
    // więc żaden nie zbiegł do wersji ogólnej po przeniesieniu wyboru do BE.
    expect(describeArchetype(PODSUMOWANIE).description).toContain("75%");
  });

  it("opis power usera liczy rekordy z `prs`, a eksperymentatora bierze `newExercises`", () => {
    const powerUser = describeArchetype({
      ...PODSUMOWANIE,
      prs: [
        ...PODSUMOWANIE.prs,
        { exerciseId: "e-2", exerciseName: "Dip", unit: "REPS", reps: 14, previousBest: 11 },
        { exerciseId: "e-3", exerciseName: "Plank", unit: "SEC", reps: 90, previousBest: 70 },
      ],
      archetype: { key: "power-user", emoji: "🚀", newExercises: 0, distinctExercises: 6 },
    });
    const eksperymentator = describeArchetype({
      ...PODSUMOWANIE,
      archetype: { key: "experimenter", emoji: "🧪", newExercises: 3, distinctExercises: 7 },
    });

    expect(powerUser.label).toBe("Power user");
    expect(powerUser.description).toContain("3 rekordy");
    expect(eksperymentator.label).toBe("Eksperymentator");
    expect(eksperymentator.description).toContain("3 nowe ćwiczenia");
  });

  it("opis wszechstronnego bierze `distinctExercises` z bloku archetypu", () => {
    const wynik = describeArchetype({
      ...PODSUMOWANIE,
      archetype: { key: "all-rounder", emoji: "🌀", newExercises: 1, distinctExercises: 8 },
    });

    expect(wynik.description).toContain("8 różnych ćwiczeń");
  });

  it("specjalista bez ćwiczenia wiodącego nie pokazuje `NaN`", () => {
    // `topExercise` bywa `null` (miesiąc bez wyraźnego faworyta). Archetyp
    // `specialist` z takim miesiącem jest sprzeczny, ale to kombinacja, której
    // FE nie kontroluje — ma dać liczbę, nie `undefined%`.
    const wynik = describeArchetype({ ...PODSUMOWANIE, topExercise: null });

    expect(wynik.description).toContain("0%");
  });

  it("każdy klucz kontraktu ma etykietę i opis — słownik jest totalny", () => {
    // Dopisanie dziesiątego archetypu po stronie BE przewróci `tsc` na
    // `ARCHETYPE_LABEL`, ale dopiero ten test pokazuje, że żaden z dziewięciu
    // dzisiejszych nie oddaje pustego napisu.
    const klucze = [
      "power-user",
      "experimenter",
      "consistent",
      "maximalist",
      "specialist",
      "endurance",
      "all-rounder",
      "patient",
      "explorer",
    ] as const;

    for (const key of klucze) {
      const wynik = describeArchetype({
        ...PODSUMOWANIE,
        archetype: { ...PODSUMOWANIE.archetype, key },
      });
      expect(wynik.label.length).toBeGreaterThan(0);
      expect(wynik.description.length).toBeGreaterThan(0);
    }
  });
});
