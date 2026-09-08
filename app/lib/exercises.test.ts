import { describe, expect, it, vi } from "vitest";

// `exercises.ts` importuje `file-uploads.ts`, a ten czyta `getEnv()` w `maxUploadBytesFor`.
// Bez mocka test wysadza się na braku zmiennych środowiskowych, zanim dojdzie do asercji.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({
    MAX_UPLOAD_BYTES: 250_000_000,
    MAX_VIDEO_UPLOAD_BYTES: 30_000_000,
    // `publicFileUrl` składa origin dla podpisanych ścieżek plików. Adres jest
    // INNY niż `be.test` z klienta testowego świadomie: w produkcji `API_URL`
    // bywa siecią prywatną, a do HTML-a idzie `API_PUBLIC_URL` — asercje niżej
    // sprawdzają, że do `<video src>` trafia ten drugi.
    API_URL: "http://be.internal",
    API_PUBLIC_URL: "https://api.kalisthenos.test",
  }),
}));

import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  createExercise,
  ExerciseError,
  getExerciseDetail,
  listActiveExercisesForTrainee,
  listActiveExercisesForTrainer,
  listExercisesForTrainer,
  setExerciseArchived,
  updateExercise,
} from "./exercises";
import { UploadError } from "./file-uploads";

// `Promise<Response>` w sygnaturze jest konieczne: część przypadków niżej czyta
// ciało żądania (`await req.json()`), więc reguła bywa funkcją asynchroniczną.
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

const CWICZENIE = {
  id: "e-1",
  name: "Podciąganie",
  unit: "REPS" as const,
  description: "",
  tags: ["plecy"],
  tracksRpe: true,
  archivedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  demoUrl: null,
};

function strona(items: unknown[], page = 1, totalPages = 1, total = items.length) {
  return { items, page, totalPages, total };
}

describe("listExercisesForTrainer — lista biblioteki na kontrakcie", () => {
  it("sortowanie z URL-a tłumaczy się na słownik kontraktu", async () => {
    // Adresy list są zakładkowalne, więc `?sort=name_desc` musi przeżyć integrację.
    // Kontrakt nazywa to samo `-name` — tłumaczenie jest zadaniem modułu, nie trasy.
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([CWICZENIE]));
    });

    await listExercisesForTrainer(api, { sort: "name_desc", page: 2 });

    expect(zapytanie).toContain("sort=-name");
    expect(zapytanie).toContain("page=2");
    // Biblioteka pokazuje wyłącznie aktywne — zarchiwizowane są osiągalne
    // tylko adresem szczegółu. Bez tego parametru kontrakt oddałby domyślny zbiór.
    expect(zapytanie).toContain("status=active");
  });

  it("filtry nieustawione nie trafiają do zapytania", async () => {
    // Puste `q=` znaczy w kontrakcie co innego niż brak `q` — pierwsze jest
    // szukaniem pustego łańcucha, drugie brakiem filtra.
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([CWICZENIE]));
    });

    await listExercisesForTrainer(api, { sort: "name_asc", page: 1 });

    expect(zapytanie).not.toContain("q=");
    expect(zapytanie).not.toContain("tag=");
    expect(zapytanie).not.toContain("unit=");
  });

  it("wszystkie trzy filtry idą do kontraktu, gdy są ustawione", async () => {
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([CWICZENIE]));
    });

    await listExercisesForTrainer(api, {
      sort: "newest",
      page: 1,
      q: "pod",
      tag: "plecy",
      unit: "REPS",
    });

    expect(zapytanie).toContain("q=pod");
    expect(zapytanie).toContain("tag=plecy");
    expect(zapytanie).toContain("unit=REPS");
  });

  it("liczby stron przychodzą z kontraktu, moduł ich nie przelicza", async () => {
    // Do integracji `safePage` liczyła trasa z `total / PAGE_SIZE`. Teraz przycina
    // BE (`paginate`), a FE ma pokazać to, co dostał — dwa niezależne liczenia
    // rozjechałyby się przy pierwszej zmianie rozmiaru strony po tamtej stronie.
    const api = klient(() => json(200, strona([CWICZENIE], 3, 3, 60)));

    const wynik = await listExercisesForTrainer(api, { sort: "name_asc", page: 99 });

    expect(wynik.page).toBe(3);
    expect(wynik.totalPages).toBe(3);
    expect(wynik.total).toBe(60);
    expect(wynik.items).toEqual([CWICZENIE]);
  });

  it("kafelki listy też dostają demo z publicznym originem", async () => {
    // Ta sama pułapka co w szczególe: `<video src>` na liście dostaje ścieżkę
    // z kontraktu i bez origin wskazuje na FE, gdzie takiej trasy nie ma.
    const sciezka = "/v1/files/f-2?exp=1&partyId=p-1&trainerId=t-1&sig=xyz";
    const api = klient(() => json(200, strona([{ ...CWICZENIE, demoUrl: sciezka }])));

    const wynik = await listExercisesForTrainer(api, { sort: "name_asc", page: 1 });

    expect(wynik.items[0]?.demoUrl).toBe(`https://api.kalisthenos.test${sciezka}`);
  });
});

describe("listActiveExercisesForTrainer — picker", () => {
  it("skleja wszystkie strony i oddaje trzy pola", async () => {
    // Kontrakt nie ma „bez stronicowania", a picker potrzebuje pełnej listy:
    // urwanie jej na pierwszej stronie okroiłoby edytor planu po cichu.
    const strony: Record<string, unknown> = {
      "1": strona([{ ...CWICZENIE, id: "e-1" }], 1, 3, 3),
      "2": strona([{ ...CWICZENIE, id: "e-2" }], 2, 3, 3),
      "3": strona([{ ...CWICZENIE, id: "e-3" }], 3, 3, 3),
    };
    const zadania: string[] = [];
    const api = klient((req) => {
      const nr = new URL(req.url).searchParams.get("page") ?? "1";
      zadania.push(nr);
      return json(200, strony[nr]);
    });

    const wynik = await listActiveExercisesForTrainer(api);

    expect(zadania).toEqual(["1", "2", "3"]);
    expect(wynik).toEqual([
      { id: "e-1", name: "Podciąganie", unit: "REPS" },
      { id: "e-2", name: "Podciąganie", unit: "REPS" },
      { id: "e-3", name: "Podciąganie", unit: "REPS" },
    ]);
  });

  it("jedna strona to jedno żądanie", async () => {
    let wywolan = 0;
    const api = klient(() => {
      wywolan += 1;
      return json(200, strona([CWICZENIE], 1, 1, 1));
    });

    await listActiveExercisesForTrainer(api);

    expect(wywolan).toBe(1);
  });
});

describe("listActiveExercisesForTrainee — picker podopiecznego (GET /v1/me/exercises)", () => {
  it("skleja wszystkie strony, licząc się z totalPages, nie z długością pierwszej strony", async () => {
    // Dwie strony po dwa: pętla ma zejść po `totalPages`, nie po długości pierwszej
    // strony — inaczej biblioteka powyżej rozmiaru strony urywa się po cichu, a
    // wybierak pokazuje wycinek wyglądający jak całość.
    const strony: Record<string, unknown> = {
      "1": strona(
        [
          { ...CWICZENIE, id: "a", name: "Podciąganie" },
          { ...CWICZENIE, id: "b", name: "Deska" },
        ],
        1,
        2,
        4,
      ),
      "2": strona(
        [
          { ...CWICZENIE, id: "c", name: "Rower" },
          { ...CWICZENIE, id: "d", name: "Wiosło" },
        ],
        2,
        2,
        4,
      ),
    };
    const api = klient((req) => {
      const nr = new URL(req.url).searchParams.get("page") ?? "1";
      return json(200, strony[nr]);
    });

    const wynik = await listActiveExercisesForTrainee(api);

    expect(wynik.map((e) => e.name)).toEqual(["Podciąganie", "Deska", "Rower", "Wiosło"]);
  });

  it("wozi tracksRpe, bo od niego zależy kształt wiersza serii", async () => {
    // Bliźniak trenera go nie niesie — trener wybiera ćwiczenie DO PLANU, gdzie flaga
    // nie wpływa na formularz. Podopieczny wybiera ćwiczenie DO ZALOGOWANIA, a od tej
    // flagi zależy, czy wiersz serii pokaże pole oceny trudności.
    const api = klient(() =>
      json(200, strona([{ ...CWICZENIE, id: "a", name: "Deska", tracksRpe: false }])),
    );

    const wynik = await listActiveExercisesForTrainee(api);

    expect(wynik).toEqual([{ id: "a", name: "Deska", unit: "REPS", tracksRpe: false }]);
  });

  it("nie wysyła `status` — ten kontrakt go nie zna i oddałby 400, nie ciche pominięcie", async () => {
    // `MyExercisesControllerListData.query` zna wyłącznie `page`/`q`/`sort`/`unit`/`tag`.
    // Backend stoi na whitelist + forbidNonWhitelisted, więc skopiowanie `status` z
    // wariantu trenera nie zostałoby po cichu zignorowane, tylko wróciłoby jako 400.
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([CWICZENIE]));
    });

    await listActiveExercisesForTrainee(api);

    expect(zapytanie).not.toContain("status");
  });
});

describe("createExercise — tworzenie na kontrakcie", () => {
  it("bez demo to jedno żądanie", async () => {
    const trafienia: string[] = [];
    let cialo: unknown = null;
    const api = klient(async (req) => {
      trafienia.push(`${req.method} ${new URL(req.url).pathname}`);
      cialo = await req.json();
      return json(201, CWICZENIE);
    });

    await createExercise(api, {
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: ["plecy"],
      tracksRpe: true,
      demo: null,
    });

    expect(trafienia).toEqual(["POST /v1/exercises"]);
    expect(cialo).toEqual({
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: ["plecy"],
      tracksRpe: true,
    });
  });

  it("z demo: najpierw wysyłka, potem utworzenie, na końcu podpięcie", async () => {
    // Kolejność jest decyzją, nie stylem (A8): wysyłka jest krokiem najbardziej
    // podatnym na odmowę, a jej porażka ma nie zostawić ćwiczenia — tak jak dziś
    // rollback transakcji. `CreateExerciseDto` nie przyjmuje `demoFileId`, więc
    // podpięcie musi być osobnym `PATCH`-em.
    const trafienia: string[] = [];
    let cialoPatcha: Record<string, unknown> = {};
    const api = klient(async (req) => {
      const sciezka = new URL(req.url).pathname;
      trafienia.push(`${req.method} ${sciezka}`);
      if (sciezka === "/v1/files/exercise-demo") {
        return json(201, { id: "f-1", bytes: 10, mimeType: "video/mp4" });
      }
      if (sciezka === "/v1/files/f-1/confirm") return new Response(null, { status: 204 });
      if (req.method === "PATCH") {
        cialoPatcha = (await req.json()) as Record<string, unknown>;
        return json(200, { ...CWICZENIE, id: "e-9" });
      }
      return json(201, { ...CWICZENIE, id: "e-9" });
    });

    const wynik = await createExercise(api, {
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: [],
      tracksRpe: true,
      demo: new File([new Uint8Array(10)], "demo.mp4", { type: "video/mp4" }),
    });

    expect(trafienia).toEqual([
      "POST /v1/files/exercise-demo",
      "POST /v1/files/f-1/confirm",
      "POST /v1/exercises",
      "PATCH /v1/exercises/e-9",
    ]);
    // Sama kolejność ścieżek przeszłaby też z pustym ciałem albo z cudzym
    // identyfikatorem pliku — a to właśnie ten przeskok (id z wysyłki trafia
    // do podpięcia) jest całym sensem sekwencji z decyzji A8.
    expect(cialoPatcha).toEqual({ demoFileId: "f-1" });
    expect(wynik).toEqual({ id: "e-9", demoError: null });
  });

  it("odmowa podpięcia PO utworzeniu nie jest wyjątkiem — niesie id i komunikat", async () => {
    // Ćwiczenie już istnieje. Rzucenie wyjątkiem zostawiłoby trenera na
    // wypełnionym formularzu z odblokowanym „Zapisz", a drugie kliknięcie
    // utworzyłoby DRUGIE ćwiczenie — dokładnie to, przed czym broni się ta trasa.
    const api = klient(async (req) => {
      const sciezka = new URL(req.url).pathname;
      if (sciezka === "/v1/files/exercise-demo") {
        return json(201, { id: "f-1", bytes: 10, mimeType: "video/mp4" });
      }
      if (sciezka === "/v1/files/f-1/confirm") return new Response(null, { status: 204 });
      if (req.method === "PATCH") {
        return json(409, {
          error: {
            code: "EXERCISE_DEMO_FILE_UNAVAILABLE",
            message: "Ten plik nie jest już dostępny do podpięcia jako demo.",
          },
        });
      }
      return json(201, { ...CWICZENIE, id: "e-9" });
    });

    const wynik = await createExercise(api, {
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: [],
      tracksRpe: true,
      demo: new File([new Uint8Array(10)], "demo.mp4", { type: "video/mp4" }),
    });

    expect(wynik.id).toBe("e-9");
    expect(wynik.demoError).toBe("Ten plik nie jest już dostępny do podpięcia jako demo.");
  });

  it("odmowa PRZED utworzeniem leci wyjątkiem — nic nie powstało, wolno ponowić", async () => {
    // Druga strona rozróżnienia z poprzedniego testu: gdy odmawia sama wysyłka,
    // po żądaniu nie zostaje nic i formularz MA prawo wrócić z komunikatem.
    // Wyjątek jest tu poprawnym kanałem — inaczej niż po utworzeniu ćwiczenia.
    const trafienia: string[] = [];
    const api = klient((req) => {
      trafienia.push(`${req.method} ${new URL(req.url).pathname}`);
      return json(413, {
        error: { code: "FILE_TOO_LARGE", message: "Plik jest za duży." },
      });
    });

    const blad = await createExercise(api, {
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: [],
      tracksRpe: true,
      demo: new File([new Uint8Array(10)], "demo.mp4", { type: "video/mp4" }),
    }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(UploadError);
    expect((blad as UploadError).userMessage).toBe("Plik jest za duży.");
    expect(trafienia).toEqual(["POST /v1/files/exercise-demo"]);
  });
});

describe("getExerciseDetail — szczegół z kontraktu", () => {
  it("404 mapuje się na null, bo sygnatura deklaruje `| null`", async () => {
    // Reguła D3 warstwy klienta: rozstrzyga sygnatura, nie ocena piszącego.
    // Cudze ćwiczenie jest w BE nieodróżnialne od nieistniejącego — oba dają 404,
    // oba mają dać ten sam ekran co dziś.
    const api = klient(() =>
      json(404, { error: { code: "NOT_FOUND", message: "Nie znaleziono." } }),
    );

    await expect(getExerciseDetail(api, "e-1")).resolves.toBeNull();
  });

  it("do podpisanej ŚCIEŻKI demo dokłada publiczny origin", async () => {
    // Kontrakt zwraca ścieżkę, nie adres (`FileUrlSigner.sign` w BE:
    // `/v1/files/{id}?exp=…&sig=…`). Przekazana dalej bez zmian rozwiązałaby się
    // w `<video src>` względem origin FE — czyli donikąd, i to bez błędu: puste
    // `<video>` wygląda jak brak nagrania. Fikstura MUSI mieć kształt prawdziwy;
    // wcześniejsza wersja podawała tu adres bezwzględny, którego BE nigdy nie
    // zwraca, i dlatego usterka przeżyła osiem przeglądów.
    const sciezka = "/v1/files/f-1?exp=1&partyId=p-1&trainerId=t-1&sig=abc";
    const api = klient(() => json(200, { ...CWICZENIE, demoUrl: sciezka }));

    const wynik = await getExerciseDetail(api, "e-1");

    expect(wynik?.demoUrl).toBe(`https://api.kalisthenos.test${sciezka}`);
  });

  it("brak demo zostaje `null`, nie adresem samego origin", async () => {
    const api = klient(() => json(200, { ...CWICZENIE, demoUrl: null }));

    const wynik = await getExerciseDetail(api, "e-1");

    expect(wynik?.demoUrl).toBeNull();
  });
});

describe("setExerciseArchived — archiwizacja i przywrócenie", () => {
  it("archiwizacja i przywrócenie to dwie różne trasy", async () => {
    const trafienia: string[] = [];
    const api = klient((req) => {
      trafienia.push(`${req.method} ${new URL(req.url).pathname}`);
      return json(200, CWICZENIE);
    });

    await setExerciseArchived(api, "e-1", true);
    await setExerciseArchived(api, "e-1", false);

    expect(trafienia).toEqual(["POST /v1/exercises/e-1/archive", "POST /v1/exercises/e-1/restore"]);
  });

  it("wariant aktywnej umiejętności wraca jako ExerciseError z komunikatem BE", async () => {
    // Bramkę trzymał do integracji FE (`findSkillForExercise` przed archiwizacją);
    // teraz trzyma ją BE i to on ma treść komunikatu. Trasa pokazuje `userMessage`
    // w formularzu — `ApiError` dałby granicę błędu, czyli inny ekran.
    const api = klient(() =>
      json(409, {
        error: {
          code: "EXERCISE_IS_SKILL_VARIATION",
          message:
            "Ćwiczenie jest wariantem aktywnej umiejętności — najpierw odepnij je od umiejętności.",
          details: { skillId: "s-1", skillName: "Muscle-up" },
        },
      }),
    );

    const blad = await setExerciseArchived(api, "e-1", true).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ExerciseError);
    expect((blad as ExerciseError).userMessage).toBe(
      "Ćwiczenie jest wariantem aktywnej umiejętności — najpierw odepnij je od umiejętności.",
    );
  });

  it("inny 409 leci dalej jako ApiError", async () => {
    // Wąsko po KODZIE, nie po statusie: `409` na tym zasobie może kiedyś znaczyć
    // coś innego, a wtedy komunikat o wariancie umiejętności byłby kłamstwem.
    const api = klient(() =>
      json(409, { error: { code: "SOMETHING_ELSE", message: "Konflikt." } }),
    );

    const blad = await setExerciseArchived(api, "e-1", true).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(ExerciseError);
  });
});

describe("updateExercise — zapis edycji na kontrakcie", () => {
  it("brak nowego pliku NIE odpina istniejącego demo", async () => {
    // To jest pułapka tego obszaru i jedyna, przy której typy milczą:
    // `demoFileId: null` w kontrakcie ODPINA demo. „Zostaw dotychczasowe"
    // musi znaczyć BRAK KLUCZA w ciele, nie `null`.
    let cialo: Record<string, unknown> = {};
    const api = klient(async (req) => {
      cialo = (await req.json()) as Record<string, unknown>;
      return json(200, CWICZENIE);
    });

    await updateExercise(api, {
      exerciseId: "e-1",
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: [],
      tracksRpe: true,
      demo: null,
    });

    expect("demoFileId" in cialo).toBe(false);
  });

  it("nowy plik idzie jednym PATCH-em po wysyłce", async () => {
    const trafienia: string[] = [];
    let cialo: Record<string, unknown> = {};
    const api = klient(async (req) => {
      const sciezka = new URL(req.url).pathname;
      trafienia.push(`${req.method} ${sciezka}`);
      if (sciezka === "/v1/files/exercise-demo") {
        return json(201, { id: "f-2", bytes: 10, mimeType: "video/mp4" });
      }
      if (sciezka === "/v1/files/f-2/confirm") return new Response(null, { status: 204 });
      cialo = (await req.json()) as Record<string, unknown>;
      return json(200, CWICZENIE);
    });

    await updateExercise(api, {
      exerciseId: "e-1",
      name: "Podciąganie",
      unit: "REPS",
      description: "",
      tags: [],
      tracksRpe: true,
      demo: new File([new Uint8Array(10)], "demo.mp4", { type: "video/mp4" }),
    });

    expect(trafienia).toEqual([
      "POST /v1/files/exercise-demo",
      "POST /v1/files/f-2/confirm",
      "PATCH /v1/exercises/e-1",
    ]);
    expect(cialo.demoFileId).toBe("f-2");
  });
});
