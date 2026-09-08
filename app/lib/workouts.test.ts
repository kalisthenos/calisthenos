import { describe, expect, it, vi } from "vitest";

// Od Zadania 5 moduł woła `publicFileUrl` (origin dla podpisanych ścieżek nagrań),
// a ten czyta `getEnv().API_PUBLIC_URL`. Wzorzec i uzasadnienie: `exercises.test.ts`.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({
    MAX_UPLOAD_BYTES: 250_000_000,
    MAX_VIDEO_UPLOAD_BYTES: 30_000_000,
    API_URL: "http://be.internal",
    API_PUBLIC_URL: "https://api.kalisthenos.test",
  }),
}));

import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import type { SetDraft } from "./log-draft";
import {
  type LogEntry,
  WorkoutSaveError,
  buildLogPayload,
  listMyLogs,
  listTraineeLogs,
  loadMyActivePlan,
  loadMyLog,
  loadSessionForLogging,
  loadTraineeLog,
  saveWorkoutLog,
  toLogEntries,
  toLoggingEntries,
} from "./workouts";

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

// Koperta błędu BE: `{ error: { code, message, details } }` — to, co rozbiera `parseApiError`.
function odmowa(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, details } });
}

const LOG_LISTY = {
  id: "l-1",
  performedOn: "2026-08-30",
  sessionName: "Push A",
  note: null,
  exerciseCount: 4,
  setCount: 12,
  hasVideo: true,
  avgDifficulty: 6.5,
};

function strona(items: unknown[], page = 1, totalPages = 1, total = items.length) {
  return { items, page, totalPages, total };
}

describe("listMyLogs / listTraineeLogs — historia na kontrakcie", () => {
  it("własna historia idzie pod `/v1/me/workout-logs` z sortowaniem i stroną bez tłumaczenia", async () => {
    // Adresy list są zakładkowalne (`?sort=hardest`), a kontrakt nazywa sortowania
    // DOKŁADNIE tak samo — słownika nie ma i test pilnuje, żeby nikt go nie dopisał.
    let sciezka = "";
    let zapytanie = "";
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      zapytanie = url.search;
      return json(200, strona([LOG_LISTY]));
    });

    await listMyLogs(api, { page: 2, sort: "hardest", q: "Push", video: "with" });

    expect(sciezka).toBe("/v1/me/workout-logs");
    expect(zapytanie).toContain("page=2");
    expect(zapytanie).toContain("sort=hardest");
    expect(zapytanie).toContain("q=Push");
    expect(zapytanie).toContain("video=with");
  });

  it("`video: all` i puste `q` nie trafiają do zapytania", async () => {
    // `all` to brak zawężenia, a puste `q=` znaczy „szukaj pustego łańcucha",
    // nie „bez filtra" — ten sam wzorzec co `status`/`q` w planach.
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([LOG_LISTY]));
    });

    await listMyLogs(api, { page: 1, sort: "date_desc", q: "", video: "all" });

    expect(zapytanie).not.toContain("video=");
    expect(zapytanie).not.toContain("q=");
  });

  it("strona wraca z kontraktu nietknięta — liczb stron moduł nie przelicza", async () => {
    // Do integracji trasa liczyła `safePage` z osobnego licznika. Teraz `page`
    // spoza zakresu przycina BE, a `total` przychodzi razem z listą.
    const api = klient(() => json(200, strona([LOG_LISTY], 3, 3, 41)));

    const wynik = await listMyLogs(api, { page: 99, sort: "date_desc" });

    expect(wynik.page).toBe(3);
    expect(wynik.totalPages).toBe(3);
    expect(wynik.total).toBe(41);
    expect(wynik.items).toEqual([LOG_LISTY]);
  });

  it("historia podopiecznego u trenera idzie pod `/v1/trainees/{id}/workout-logs`", async () => {
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, strona([]));
    });

    const wynik = await listTraineeLogs(api, "t-1", { page: 1, sort: "sets_desc" });

    expect(sciezka).toBe("/v1/trainees/t-1/workout-logs");
    // Cudzy podopieczny daje po stronie BE PUSTĄ stronę, nie `404` — moduł oddaje
    // ją jak każdą inną; o `404` decyduje wcześniejszy `getTraineeOfTrainer` w trasie.
    expect(wynik.items).toEqual([]);
  });
});

const SZCZEGOL_LOGU = {
  id: "l-1",
  performedOn: "2026-08-30",
  sessionName: "Push A",
  note: "Dobrze poszło",
  allDone: false,
  exercises: [
    {
      exerciseId: "e-1",
      exerciseName: "Pull-up",
      unit: "REPS" as const,
      sets: [
        {
          ordinal: 0,
          reps: 8,
          difficulty: 7,
          hasVideo: true,
          videoUrl: "/v1/files/f-1?exp=1&partyId=p&trainerId=t&sig=s",
        },
        { ordinal: 2, reps: 6, difficulty: null, hasVideo: false, videoUrl: null },
      ],
    },
  ],
};

describe("loadMyLog / loadTraineeLog — szczegół z podpisanymi nagraniami", () => {
  it("własny log idzie pod `/v1/me/workout-logs/{id}`, a `videoUrl` dostaje origin z `API_PUBLIC_URL`", async () => {
    // Kontrakt oddaje `videoUrl` jako ŚCIEŻKĘ (`/v1/files/…`). Włożona wprost
    // w `<a href>` rozwiązałaby się względem origin FE, gdzie takiej trasy nie ma —
    // bez błędu, jak brak nagrania. Origin dokłada moduł, nie trasa (jak `demoUrl`
    // w ćwiczeniach), i jest to adres PUBLICZNY BE, nie `API_URL` z sieci prywatnej.
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, SZCZEGOL_LOGU);
    });

    const wynik = await loadMyLog(api, "l-1");

    expect(sciezka).toBe("/v1/me/workout-logs/l-1");
    expect(wynik?.exercises[0]?.sets[0]?.videoUrl).toBe(
      "https://api.kalisthenos.test/v1/files/f-1?exp=1&partyId=p&trainerId=t&sig=s",
    );
    expect(wynik?.exercises[0]?.sets[1]?.videoUrl).toBeNull();
    expect(wynik?.allDone).toBe(false);
  });

  it("`404` daje `null` — cudzy log jest nieodróżnialny od nieistniejącego", async () => {
    // Reguła D3: sygnatura `| null` włącza `orNull` — cudzy zasób ma wyglądać
    // jak brak zasobu, nie jak osobny błąd do obsłużenia.
    const api = klient(() => odmowa(404, "WORKOUT_LOG_NOT_FOUND", "Nie znaleziono treningu."));

    expect(await loadMyLog(api, "l-9")).toBeNull();
  });

  it("log podopiecznego u trenera idzie pod `/v1/trainees/{traineeId}/workout-logs/{id}`", async () => {
    // Parę (podopieczny, log) sprawdza BE — dotychczasowe porównanie `traineeId`
    // w trasie trenera znika, bo niezgodna para to po tamtej stronie `404`.
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, SZCZEGOL_LOGU);
    });

    await loadTraineeLog(api, "t-1", "l-1");

    expect(sciezka).toBe("/v1/trainees/t-1/workout-logs/l-1");
  });

  it("`404` na cudzej parze (podopieczny, log) też daje `null`", async () => {
    // Niezgodna para (podopieczny, log) to po stronie BE `404` — ta sama reguła
    // co u podopiecznego (`loadMyLog`), ale osobna trasa, więc osobna asercja.
    const api = klient(() => odmowa(404, "WORKOUT_LOG_NOT_FOUND", "Nie znaleziono treningu."));

    expect(await loadTraineeLog(api, "t-1", "l-9")).toBeNull();
  });

  it("`500` przechodzi jako ApiError — odczyt nie mapuje niczego poza `404`", async () => {
    // Gdyby moduł łykał każdy błąd, awaria BE pokazałaby się jako pusty ekran
    // szczegółu — objaw nie do odróżnienia od „nic tu nie ma".
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await loadTraineeLog(api, "t-1", "l-1").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
  });
});

const SESJA = {
  id: "s-1",
  name: "Push A",
  planId: "p-1",
  planStatus: "active" as const,
  blocks: [
    {
      id: "b-1",
      kind: "single" as const,
      sets: null,
      restSeconds: null,
      items: [
        {
          id: "i-1",
          exerciseId: "e-1",
          exerciseName: "Pull-up",
          reps: 8,
          unit: "REPS" as const,
          tracksRpe: true,
          sets: 3,
          restSeconds: 90,
          note: "kontrola na dole",
          demoUrl: "/v1/files/f-1?exp=1&partyId=p&trainerId=t&sig=s",
        },
      ],
    },
    {
      id: "b-2",
      kind: "dropset" as const,
      sets: 2,
      restSeconds: 120,
      items: [
        {
          id: "i-2",
          exerciseId: "e-2",
          exerciseName: "Dip",
          reps: 10,
          unit: "REPS" as const,
          tracksRpe: false,
          sets: null,
          restSeconds: null,
          note: null,
          demoUrl: null,
        },
        {
          id: "i-3",
          exerciseId: "e-3",
          exerciseName: "Push-up",
          reps: 15,
          unit: "REPS" as const,
          tracksRpe: false,
          sets: null,
          restSeconds: null,
          note: null,
          demoUrl: null,
        },
      ],
    },
  ],
};

describe("toLoggingEntries — spłaszczenie sesji do wpisów formularza", () => {
  it("w dropsecie liczbę serii niesie BLOK, w single/superset — pozycja", () => {
    // Ta reguła była do integracji zaszyta w zapytaniu Drizzle i nie miała testu.
    // Pomylenie źródła daje formularz z jedną serią zamiast dwóch dla każdego
    // dropu — a podopieczny nie ma jak zauważyć, że brakuje mu wierszy.
    const wpisy = toLoggingEntries(SESJA);

    expect(wpisy.map((w) => [w.exerciseName, w.expectedSets, w.isDropsetItem])).toEqual([
      ["Pull-up", 3, false],
      ["Dip", 2, true],
      ["Push-up", 2, true],
    ]);
  });

  it("przenosi cel, jednostkę, notatkę i flagę RPE per pozycja; brak liczby serii to 1", () => {
    // Pozycja bez liczby serii ma dać JEDNĄ serię, nie zero: `sets: null` znaczy
    // „trener nie podał ile", a nie „nie rób tego ćwiczenia". Zero zwinęłoby kartę
    // do zera wierszy i podopieczny nie miałby gdzie wpisać wykonania. Reszta pól
    // (cel, jednostka, notatka, RPE) pochodzi z POZYCJI, nie z bloku — mieszanie
    // źródeł pokazałoby cudzą jednostkę albo notatkę przy złym ćwiczeniu.
    const [pierwszy, drugi] = toLoggingEntries({
      ...SESJA,
      blocks: [{ ...SESJA.blocks[0]!, items: [{ ...SESJA.blocks[0]!.items[0]!, sets: null }] }],
    });

    expect(pierwszy).toMatchObject({
      planItemId: "i-1",
      exerciseId: "e-1",
      unit: "REPS",
      expectedSets: 1,
      expectedReps: 8,
      note: "kontrola na dole",
      tracksRpe: true,
    });
    expect(drugi).toBeUndefined();
  });

  it("sesja bez bloków i blok bez pozycji dają pustą listę", () => {
    // Sesja bez ćwiczeń jest legalna (trener zaczął układać plan i nie skończył),
    // a formularz ma wtedy pokazać pusty stan „Brak ćwiczeń". Spłaszczenie musi
    // więc oddać `[]`, a nie wywrócić się ani dorzucić wpisu-widma.
    expect(toLoggingEntries({ ...SESJA, blocks: [] })).toEqual([]);
    expect(toLoggingEntries({ ...SESJA, blocks: [{ ...SESJA.blocks[0]!, items: [] }] })).toEqual(
      [],
    );
  });

  it("w supersecie liczba serii pochodzi z POZYCJI, nie z bloku", () => {
    // Gałąź „nie-dropset" była dotąd sprawdzana wyłącznie blokiem `single`, który
    // `sets` na bloku ma zawsze `null` — pomyłka `block.sets` zamiast `item.sets`
    // przeszłaby tam niezauważona. `superset` jest jedynym nie-dropsetem, który
    // NIESIE własne `sets`, więc dopiero on tę gałąź naprawdę bada.
    const wpisy = toLoggingEntries({
      ...SESJA,
      blocks: [
        {
          ...SESJA.blocks[1]!,
          kind: "superset" as const,
          sets: 5,
          items: [{ ...SESJA.blocks[1]!.items[0]!, sets: 4 }],
        },
      ],
    });

    expect(wpisy.map((w) => [w.expectedSets, w.isDropsetItem])).toEqual([[4, false]]);
  });
});

describe("toLogEntries — następca toLoggingEntries, z pochodzeniem i pustymi seriami", () => {
  it("przenosi to, co toLoggingEntries, i dokłada origin, klucz oraz puste serie w liczbie planowanej", () => {
    // `toLogEntries` zastąpi `toLoggingEntries` w Zadaniu 8 (trasa). Do tego czasu obie
    // funkcje stoją obok siebie — `toLoggingEntries` zostaje jedynym, co czyta dzisiejsza
    // trasa, więc ruszenie jej złamałoby więcej niż cztery znane błędy typów (STAN DRZEWA
    // Zadania 5). `key` bierze się z `planItemId`, `plannedSets` z dawnego `expectedSets`.
    const pustaSeria = { reps: "", difficulty: "", skipped: false, videoFileId: null };

    expect(toLogEntries(SESJA)).toEqual([
      {
        key: "i-1",
        exerciseId: "e-1",
        exerciseName: "Pull-up",
        unit: "REPS",
        tracksRpe: true,
        origin: "planned",
        substitutedExerciseId: null,
        substitutedExerciseName: null,
        plannedSets: 3,
        expectedReps: 8,
        note: "kontrola na dole",
        isDropsetItem: false,
        sets: [pustaSeria, pustaSeria, pustaSeria],
      },
      {
        key: "i-2",
        exerciseId: "e-2",
        exerciseName: "Dip",
        unit: "REPS",
        tracksRpe: false,
        origin: "planned",
        substitutedExerciseId: null,
        substitutedExerciseName: null,
        plannedSets: 2,
        expectedReps: 10,
        note: null,
        isDropsetItem: true,
        sets: [pustaSeria, pustaSeria],
      },
      {
        key: "i-3",
        exerciseId: "e-3",
        exerciseName: "Push-up",
        unit: "REPS",
        tracksRpe: false,
        origin: "planned",
        substitutedExerciseId: null,
        substitutedExerciseName: null,
        plannedSets: 2,
        expectedReps: 15,
        note: null,
        isDropsetItem: true,
        sets: [pustaSeria, pustaSeria],
      },
    ]);
  });
});

function seria(overrides: Partial<SetDraft> = {}): SetDraft {
  return { reps: "8", difficulty: "7", skipped: false, videoFileId: null, ...overrides };
}

function wpis(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    key: "i-1",
    exerciseId: "e-1",
    exerciseName: "Pull-up",
    unit: "REPS",
    tracksRpe: true,
    origin: "planned",
    substitutedExerciseId: null,
    substitutedExerciseName: null,
    plannedSets: 3,
    expectedReps: 8,
    note: null,
    isDropsetItem: false,
    sets: [seria(), seria(), seria()],
    ...overrides,
  };
}

describe("buildLogPayload — ładunek zapisu budowany POZA akcją trasy", () => {
  it("wpis planowany niesie origin planned i pusty wskaźnik", () => {
    expect(buildLogPayload([wpis()])[0]).toMatchObject({
      origin: "planned",
      substitutedExerciseId: null,
    });
  });

  it("zamiennik niesie wskaźnik na zastąpione ćwiczenie", () => {
    const payload = buildLogPayload([
      wpis({ exerciseId: "z", origin: "substitute", substitutedExerciseId: "a" }),
    ]);
    expect(payload[0]).toMatchObject({ exerciseId: "z", substitutedExerciseId: "a" });
  });

  it("ćwiczenie zastąpione NIE trafia do ładunku", () => {
    // N14 po stronie backendu: „zamiast" i „oraz" wykluczają się. Wymiana
    // zastępuje wpis w miejscu, więc to wychodzi samo — ten test pilnuje, żeby
    // wyszło samo także po przyszłej zmianie kształtu stanu.
    const payload = buildLogPayload([
      wpis({ exerciseId: "z", origin: "substitute", substitutedExerciseId: "a" }),
      wpis({ exerciseId: "b" }),
    ]);
    expect(payload.map((e) => e.exerciseId)).toEqual(["z", "b"]);
  });

  it("serie pominięte zostawiają DZIURĘ w ordinalach", () => {
    // Dziura znaczy serię pominiętą i ma przeżyć zapis — `ordinal` jest pozycją
    // PLANOWANĄ, nie indeksem w tablicy.
    const payload = buildLogPayload([
      wpis({ sets: [seria({ reps: "8" }), seria({ reps: "" }), seria({ reps: "6" })] }),
    ]);
    expect(payload[0]!.sets.map((s) => s.ordinal)).toEqual([0, 2]);
  });

  it("serie dołożone ponad plan dostają kolejne ordinale", () => {
    const payload = buildLogPayload([wpis({ plannedSets: 2, sets: [seria(), seria(), seria()] })]);
    expect(payload[0]!.sets.map((s) => s.ordinal)).toEqual([0, 1, 2]);
  });

  it("wpis bez ani jednej wypełnionej serii wypada z ładunku", () => {
    // Inaczej backend odmówiłby całemu logowi (`EMPTY_WORKOUT_LOG` dotyczy
    // całości, ale ćwiczenie bez serii jest dla agregatu wyrażalne i bezużyteczne).
    expect(buildLogPayload([wpis({ sets: [seria({ reps: "" })] })])).toEqual([]);
  });
});

describe("loadMyActivePlan / loadSessionForLogging — plan i sesja podopiecznego", () => {
  it("aktywny plan idzie pod `/v1/me/plan`, a `404 PLAN_NOT_FOUND` daje `null`", async () => {
    // Brak opublikowanego planu to po stronie BE `404` opisane jako „stan normalny,
    // nie awaria" — sygnatura `| null` włącza `orNull`, a ekran rysuje pusty stan.
    let sciezka = "";
    const zPlanem = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, {
        id: "p-1",
        name: "Siła 1",
        version: 2,
        publishedAt: "2026-08-01T10:00:00.000Z",
        sessions: [],
      });
    });
    const bezPlanu = klient(() => odmowa(404, "PLAN_NOT_FOUND", "Nie masz aktywnego planu."));

    expect((await loadMyActivePlan(zPlanem))?.name).toBe("Siła 1");
    expect(sciezka).toBe("/v1/me/plan");
    expect(await loadMyActivePlan(bezPlanu)).toBeNull();
  });

  it("sesja idzie pod `/v1/me/plan/sessions/{id}`, a `demoUrl` dostaje origin z `API_PUBLIC_URL`", async () => {
    // `demoUrl` z kontraktu to ŚCIEŻKA — wstawiona wprost w `<video src>` rozwiąże
    // się względem origin FE, gdzie takiej trasy nie ma, i wygląda to dokładnie jak
    // brak nagrania (bez błędu). Origin musi pochodzić z `API_PUBLIC_URL`, bo
    // `API_URL` bywa siecią prywatną Railway, a ten adres trafia do przeglądarki.
    // Pozycja bez demo ma zostać `null`, nie stać się adresem samego origin.
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, SESJA);
    });

    const wynik = await loadSessionForLogging(api, "s-1");

    expect(sciezka).toBe("/v1/me/plan/sessions/s-1");
    expect(wynik?.blocks[0]?.items[0]?.demoUrl).toBe(
      "https://api.kalisthenos.test/v1/files/f-1?exp=1&partyId=p&trainerId=t&sig=s",
    );
    expect(wynik?.blocks[1]?.items[0]?.demoUrl).toBeNull();
  });

  it("cudza sesja daje `null`, a sesja szkicu (`409`) leci dalej jako ApiError", async () => {
    // `409 PLAN_NOT_PUBLISHED` NIE jest „nie ma takiej sesji" — sesja istnieje,
    // tylko nie wolno jej logować. Regułę wyznacza sygnatura: `| null` łapie
    // wyłącznie `404`.
    const cudza = klient(() =>
      odmowa(404, "WORKOUT_LOG_SESSION_NOT_FOUND", "Nie znaleziono sesji treningowej."),
    );
    const szkic = klient(() =>
      odmowa(
        409,
        "PLAN_NOT_PUBLISHED",
        "Tej sesji nie da się zalogować — plan nie został opublikowany.",
      ),
    );

    expect(await loadSessionForLogging(cudza, "s-9")).toBeNull();
    const blad = await loadSessionForLogging(szkic, "s-1").catch((e) => e);
    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).code).toBe("PLAN_NOT_PUBLISHED");
  });
});

const ZAPIS = {
  planSessionId: "s-1",
  performedOn: "2026-09-01",
  note: null,
  allDone: false,
  exercises: [
    {
      exerciseId: "e-1",
      sets: [
        { ordinal: 0, reps: 8, difficulty: 7, videoFileId: "f-1" },
        { ordinal: 1, reps: 7, difficulty: null, videoFileId: null },
      ],
    },
    // Ćwiczenie pominięte w całości idzie z pustą listą — DTO tego nie zabrania
    // (`@ArrayNotEmpty()` stoi wyłącznie na `exercises`), a szczegół nadal je pokaże.
    { exerciseId: "e-2", sets: [] },
  ],
};

const UTWORZONY = {
  id: "l-1",
  performedOn: "2026-09-01",
  sessionName: "Push A",
  note: null,
  allDone: false,
  exercises: [],
  personalRecords: [{ exerciseId: "e-1", exerciseName: "Pull-up", unit: "REPS", reps: 8 }],
};

describe("saveWorkoutLog — zapis przez kontrakt", () => {
  it("wysyła `POST /v1/workout-logs` z kluczem idempotencji i ciałem BEZ pól tożsamości", async () => {
    // BE ma `forbidNonWhitelisted: true`: pole spoza DTO to `400`. Dawne wejście
    // niosło `trainerId`/`traineeId`/`planId`/`sessionName` — BE wyprowadza je
    // z tokenu i z sesji, więc ciało składa się jawnie, pole po polu.
    let metoda = "";
    let sciezka = "";
    let klucz: string | null = null;
    let cialo: Record<string, unknown> = {};
    const api = klient(async (req) => {
      metoda = req.method;
      sciezka = new URL(req.url).pathname;
      klucz = req.headers.get("idempotency-key");
      cialo = (await req.json()) as Record<string, unknown>;
      return json(201, UTWORZONY);
    });

    const wynik = await saveWorkoutLog(api, ZAPIS, { idempotencyKey: "k-1" });

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/workout-logs");
    expect(klucz).toBe("k-1");
    expect(Object.keys(cialo).sort()).toEqual([
      "allDone",
      "exercises",
      "note",
      "performedOn",
      "planSessionId",
    ]);
    expect(cialo.exercises).toEqual(ZAPIS.exercises);
    expect(wynik.id).toBe("l-1");
    expect(wynik.personalRecords.map((p) => p.exerciseId)).toEqual(["e-1"]);
  });

  it("`origin` i wskaźnik zamiany docierają do WYSŁANEGO ciała, nie giną przy składaniu", async () => {
    // Dlaczego ten test istnieje: `LogPayloadExercise` (`buildLogPayload`) jest
    // strukturalnym NADZBIOREM `SaveExerciseLogInput` — kontrola nadmiarowych
    // właściwości TypeScriptu działa wyłącznie na literale obiektu, nie na
    // zmiennej, więc podanie tablicy z `buildLogPayload` tam, gdzie ta funkcja
    // oczekuje `SaveExerciseLogInput[]`, przechodzi `tsc` BEZ SŁOWA — nawet
    // gdyby składanie ciała niżej po cichu gubiło `origin`/`substitutedExerciseId`
    // (i przez chwilę naprawdę gubiło: mapowanie przepisywało tylko `exerciseId`
    // i `sets`). Żaden test `buildLogPayload` tego nie łapie, bo sprawdza
    // WYNIK BUDOWANIA, nie wysyłkę. Jedyny sposób złapać taki regres to
    // sprawdzić WYSŁANY JSON przeciw podstawionemu `fetch`, dokładnie jak tu.
    //
    // Wpis `substitute` ze wskaźnikiem jest rozróżniający: gdyby przepisywanie
    // zniknęło, pole `origin` w wysłanym JSON-ie po prostu by nie istniało
    // (`undefined` ginie w `JSON.stringify` — `bodySerializer.gen.js`), więc
    // `toMatchObject({ origin: "substitute" })` by nie przeszło. Wpis `planned`
    // z `substitutedExerciseId: null` NIE różnicowałby tak samo ostro — zbyt
    // łatwo o asercję, którą spełnia i brak klucza, i klucz o wartości `null`.
    let cialo: Record<string, unknown> = {};
    const api = klient(async (req) => {
      cialo = (await req.json()) as Record<string, unknown>;
      return json(201, UTWORZONY);
    });

    await saveWorkoutLog(api, {
      ...ZAPIS,
      exercises: [
        {
          exerciseId: "z",
          origin: "substitute",
          substitutedExerciseId: "a",
          sets: [{ ordinal: 0, reps: 8, difficulty: 7, videoFileId: null }],
        },
      ],
    });

    const wyslaneCwiczenia = cialo.exercises as Array<Record<string, unknown>>;
    expect(wyslaneCwiczenia[0]).toMatchObject({
      exerciseId: "z",
      origin: "substitute",
      substitutedExerciseId: "a",
    });
  });

  it("bez klucza nie wysyła nagłówka", async () => {
    // Pusty nagłówek znaczy dla BE „brak klucza", ale brak nagłówka jest tym samym
    // bez polegania na przycinaniu białych znaków po tamtej stronie.
    let klucz: string | null = "nie sprawdzono";
    const api = klient((req) => {
      klucz = req.headers.get("idempotency-key");
      return json(201, UTWORZONY);
    });

    await saveWorkoutLog(api, ZAPIS);

    expect(klucz).toBeNull();
  });

  it("`409 SET_VIDEO_UNAVAILABLE` zamienia na WorkoutSaveError z komunikatem BE", async () => {
    // Dawne `assertOwnedUnclaimedVideos` przeszło do BE w całości — cudze, złego
    // rodzaju, już podpięte i nieistniejące nagranie dają JEDNĄ odmowę, żeby cudze
    // było nieodróżnialne od nieistniejącego. Formularz pokazuje `userMessage`.
    const api = klient(() =>
      odmowa(409, "SET_VIDEO_UNAVAILABLE", "Któreś z nagrań nie jest już dostępne.", {
        fileIds: ["f-1"],
      }),
    );

    const blad = await saveWorkoutLog(api, ZAPIS).catch((e) => e);

    expect(blad).toBeInstanceOf(WorkoutSaveError);
    expect((blad as WorkoutSaveError).userMessage).toBe("Któreś z nagrań nie jest już dostępne.");
  });

  it("`400 PERFORMED_ON_IN_FUTURE` też trafia do formularza", async () => {
    // Reguła, której FE nie miał (ADR-0027): data nie może wyprzedzać dnia
    // bieżącego w strefie aplikacji o więcej niż dzień. Bierzemy komunikat BE.
    const api = klient(() =>
      odmowa(
        400,
        "PERFORMED_ON_IN_FUTURE",
        "Data treningu 2026-09-05 wyprzedza dzień bieżący (2026-09-01).",
      ),
    );

    const blad = await saveWorkoutLog(api, ZAPIS).catch((e) => e);

    expect(blad).toBeInstanceOf(WorkoutSaveError);
  });

  it("`404` na sesji też trafia do formularza, a nie na ekran błędu", async () => {
    // Trzeci status wąskiego `catch`, dotąd bez pokrycia. Sesja cudza albo usunięta
    // między wyświetleniem formularza a wysyłką to po stronie BE `404` (jedno i to
    // samo — cudze ma być nieodróżnialne od nieistniejącego). Podopieczny ma wtedy
    // zobaczyć ZDANIE nad formularzem i zachować wpisane serie, a nie stracić je
    // razem z odmontowanym komponentem na ekranie błędu.
    const api = klient(() =>
      odmowa(404, "WORKOUT_LOG_SESSION_NOT_FOUND", "Nie znaleziono sesji treningowej."),
    );

    const blad = await saveWorkoutLog(api, ZAPIS).catch((e) => e);

    expect(blad).toBeInstanceOf(WorkoutSaveError);
    expect((blad as WorkoutSaveError).userMessage).toBe("Nie znaleziono sesji treningowej.");
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    // Gdyby moduł łykał każdy błąd, awaria BE pokazałaby się jako komunikat
    // formularza — objaw nie do odróżnienia od „nic tu nie ma".
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await saveWorkoutLog(api, ZAPIS).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(WorkoutSaveError);
  });
});
