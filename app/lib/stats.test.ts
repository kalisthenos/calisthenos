import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import { loadTraineeOverview } from "./stats";

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

const PRZEGLAD = {
  activePlan: {
    id: "p-1",
    name: "Siła 1",
    version: 2,
    publishedAt: "2026-08-01T10:00:00.000Z",
    totals: { sets: 120, reps: 900, seconds: 340 },
    sessions: [
      {
        sessionId: "s-1",
        name: "Dzień A",
        ordinal: 0,
        doneCount: 7,
        lastPerformedOn: "2026-08-30",
        exercises: [],
      },
      {
        sessionId: "s-2",
        name: "Dzień B",
        ordinal: 1,
        doneCount: 5,
        lastPerformedOn: null,
        exercises: [],
      },
    ],
  },
  draftPlan: { id: "p-2", name: "Siła 2", version: 3 },
  health: {
    daysSinceLastSession: 2,
    sessionsLast7: 3,
    sessionsLast30: 11,
    avgIntervalDays: 2.5,
    recentAvgRpe: 7.4,
    historicalAvgRpe: 7.1,
    rpeTrend: "up" as const,
    redZonePct: 22,
    allDonePct: 88,
    hasAnyLog30d: true,
  },
  plateau: [
    {
      exerciseId: "e-1",
      name: "Podciąganie",
      unit: "REPS" as const,
      sessionsConsidered: 4,
      recentBest: 9,
      recentAvgRpe: 8.5,
      pr: 11,
    },
  ],
  tags: {
    shares: [{ tag: "plecy", count: 12, pct: 40 }],
    untagged: 3,
    totalExerciseLogs: 30,
  },
  videoCoverage: { pct: 25, withVideo: 5, total: 20 },
  bodyPhotoCoverage: {
    shared: true,
    totalPhotos: 6,
    daysSinceLast: 12,
    views: { front: true, side: true, back: false },
  },
};

describe("loadTraineeOverview — przegląd klienta jednym wywołaniem", () => {
  it("idzie pod `/v1/trainees/{id}/overview` metodą GET, bez parametrów zapytania", async () => {
    // Do integracji ten ekran robił osiem równoległych zapytań przez siedem
    // funkcji tego modułu. Test pilnuje, że jest ich dokładnie tyle, ile trasa
    // ma prawo wysłać: JEDNO.
    let sciezka = "";
    let metoda = "";
    let zapytanie = "";
    let liczbaZadan = 0;
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      metoda = req.method;
      zapytanie = url.search;
      liczbaZadan += 1;
      return json(200, PRZEGLAD);
    });

    await loadTraineeOverview(api, "t-1");

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/trainees/t-1/overview");
    expect(zapytanie).toBe("");
    expect(liczbaZadan).toBe(1);
  });

  it("oddaje widok nietknięty — moduł niczego nie przelicza", async () => {
    // Siedem dawnych typów FE (`HealthStats`, `PlateauExercise`, `TagShare`…)
    // zastąpiły re-eksporty kontraktu, więc pola przechodzą 1:1. Nowe nazwy
    // (`plateau[].name`, `plateau[].recentBest`) są ustaleniem BE i to one
    // obowiązują — test utrwala je, żeby nikt nie „naprawił" ich z powrotem.
    const api = klient(() => json(200, PRZEGLAD));

    const wynik = await loadTraineeOverview(api, "t-1");

    expect(wynik.health.rpeTrend).toBe("up");
    expect(wynik.plateau[0]?.name).toBe("Podciąganie");
    expect(wynik.plateau[0]?.recentBest).toBe(9);
    expect(wynik.activePlan?.totals).toEqual({ sets: 120, reps: 900, seconds: 340 });
    expect(wynik.tags.untagged).toBe(3);
    expect(wynik.bodyPhotoCoverage.views.back).toBe(false);
  });

  it("`bodyPhotoCoverage.shared: false` przechodzi nietknięte — moduł nie zakłada udostępnienia", async () => {
    // Znaczenie ma wyłącznie `false` (ADR-0047 BE): `true` przeszłoby także przez
    // mapowanie, które pole gubi albo dopisuje domyślne `true` — a wtedy
    // `CoverageCard` wzięłaby wartości neutralne za „0 zdjęć" u podopiecznego,
    // który nie udostępnia trenerowi zdjęć — o ich liczbie kontrakt wtedy milczy.
    const api = klient(() =>
      json(200, {
        ...PRZEGLAD,
        bodyPhotoCoverage: {
          shared: false,
          totalPhotos: 0,
          daysSinceLast: null,
          views: { front: false, side: false, back: false },
        },
      }),
    );

    const wynik = await loadTraineeOverview(api, "t-1");

    expect(wynik.bodyPhotoCoverage.shared).toBe(false);
  });

  it("liczbę sesji na planie ekran liczy z `doneCount` — kontrakt jej nie niesie", async () => {
    // Luka L S5-3: `PlanTotals` ma serie, powtórzenia i sekundy, ale nie ma
    // odpowiednika dawnego `totalSessionsOnPlan`. Suma jest liczona nad TĄ SAMĄ
    // odpowiedzią, bez dodatkowego żądania — test zapisuje, skąd bierze się
    // liczba w kafelku „Sesji".
    const api = klient(() => json(200, PRZEGLAD));

    const wynik = await loadTraineeOverview(api, "t-1");

    expect((wynik.activePlan?.sessions ?? []).reduce((s, x) => s + x.doneCount, 0)).toBe(12);
  });

  it("`404` (cudzy podopieczny) leci jako ApiError — sygnatura nie ma `| null`", async () => {
    // Reguła D3: `| null` łapie `404`, każda inna sygnatura pozwala mu lecieć.
    // Tu ma polecieć — trasa i tak odbija cudzego podopiecznego wcześniej,
    // a pusty przegląd byłby nie do odróżnienia od podopiecznego bez danych.
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono podopiecznego."));

    const blad = await loadTraineeOverview(api, "t-obcy").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).status).toBe(404);
  });
});
