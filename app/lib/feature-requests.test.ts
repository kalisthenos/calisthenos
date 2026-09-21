import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  FeatureRequestError,
  createFeatureRequest,
  deleteFeatureRequest,
  getForTrainer,
  listForTrainee,
  listForTrainer,
  respondToFeatureRequest,
} from "./feature-requests";

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

function pusto(status: number): Response {
  return new Response(null, { status });
}

// Koperta błędu BE: `{ error: { code, message, details } }` — dokładnie to, co
// rozbiera `parseApiError` (idiom z `plans.test.ts`).
function odmowa(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, details } });
}

const ZGLOSZENIE = {
  id: "fr-1",
  kind: "idea" as const,
  title: "Ciemny motyw",
  body: "Przydałby się ciemny motyw w aplikacji.",
  status: "new" as const,
  trainerResponse: null,
  respondedAt: null,
  createdAt: "2026-08-20T10:00:00.000Z",
};

const ZGLOSZENIE_U_TRENERA = { ...ZGLOSZENIE, authorId: "t-1", authorName: "Anna Kowalska" };

function strona(items: unknown[], page = 1, totalPages = 1, total = items.length) {
  return { items, page, totalPages, total };
}

describe("listForTrainee — własne zgłoszenia na kontrakcie", () => {
  it("idzie pod `/v1/me/feature-requests` z sortowaniem i stroną bez tłumaczenia", async () => {
    // Kontrakt nazywa sortowania DOKŁADNIE tak, jak zakładkowalny adres listy
    // (`?sort=oldest`) — słownika nie ma i test pilnuje, żeby nikt go nie dopisał.
    let sciezka = "";
    let metoda = "";
    let zapytanie = "";
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      zapytanie = url.search;
      metoda = req.method;
      return json(200, strona([ZGLOSZENIE]));
    });

    await listForTrainee(api, { page: 2, sort: "oldest", status: "all" });

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/me/feature-requests");
    expect(zapytanie).toContain("sort=oldest");
    expect(zapytanie).toContain("page=2");
  });

  it("`all` nie wysyła `status`, a konkretny status idzie do zapytania", async () => {
    // `status=all` kontrakt zignorowałby jako nieznaną wartość — `all` to brak
    // zawężenia, czyli brak parametru.
    const zapytania: string[] = [];
    const api = klient((req) => {
      zapytania.push(new URL(req.url).search);
      return json(200, strona([]));
    });

    await listForTrainee(api, { page: 1, sort: "newest", status: "all" });
    await listForTrainee(api, { page: 1, sort: "newest", status: "planned" });

    expect(zapytania[0]).not.toContain("status=");
    expect(zapytania[1]).toContain("status=planned");
  });

  it("oddaje całą stronę z kontraktu — `total` i `totalPages` nie są liczone w module", async () => {
    // Do integracji trasa robiła dwa zapytania (`count` + `list`) i liczyła
    // `safePage` sama. Teraz stronę spoza zakresu przycina BE, a liczby przychodzą
    // z tą samą odpowiedzią — dwa niezależne liczenia rozjechałyby się przy
    // pierwszej zmianie rozmiaru strony po tamtej stronie.
    const api = klient(() => json(200, strona([ZGLOSZENIE], 3, 3, 41)));

    const wynik = await listForTrainee(api, { page: 99, sort: "newest" });

    expect(wynik.page).toBe(3);
    expect(wynik.totalPages).toBe(3);
    expect(wynik.total).toBe(41);
    expect(wynik.items).toEqual([ZGLOSZENIE]);
  });
});

describe("createFeatureRequest — nowe zgłoszenie", () => {
  it("wysyła WYŁĄCZNIE `kind`, `title` i `body` — bez identyfikatorów pary", async () => {
    // Trener wynika z konta autora, nigdy z ładunku. `trainerId`/`traineeId`
    // w ciele byłyby polami spoza DTO, czyli `400` (forbidNonWhitelisted).
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(201, ZGLOSZENIE);
    });

    const wynik = await createFeatureRequest(api, {
      kind: "idea",
      title: "Ciemny motyw",
      body: "Przydałby się ciemny motyw w aplikacji.",
    });

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/me/feature-requests");
    expect(cialo).toEqual({
      kind: "idea",
      title: "Ciemny motyw",
      body: "Przydałby się ciemny motyw w aplikacji.",
    });
    expect(wynik.id).toBe("fr-1");
  });

  it("`400` (reguły BE ostrzejsze niż Zod) zamienia na FeatureRequestError z komunikatem BE", async () => {
    const api = klient(() =>
      odmowa(400, "VALIDATION_FAILED", "Tytuł może mieć najwyżej 120 znaków."),
    );

    const blad = await createFeatureRequest(api, {
      kind: "bug",
      title: "x".repeat(121),
      body: "Opis zgłoszenia testowego.",
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(FeatureRequestError);
    expect((blad as FeatureRequestError).userMessage).toBe("Tytuł może mieć najwyżej 120 znaków.");
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await createFeatureRequest(api, {
      kind: "idea",
      title: "Ciemny motyw",
      body: "Przydałby się ciemny motyw w aplikacji.",
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(FeatureRequestError);
  });
});

describe("deleteFeatureRequest — wycofanie własnego zgłoszenia", () => {
  it("to `DELETE /v1/me/feature-requests/{id}` bez ciała", async () => {
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return pusto(204);
    });

    await deleteFeatureRequest(api, "fr-1");

    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/me/feature-requests/fr-1");
  });

  it("`404` (nie istnieje, cudze ALBO już nie `new` — BE nie rozróżnia) zamienia na FeatureRequestError", async () => {
    // Warunek `status = 'new'` siedzi w `DELETE` po stronie BE, a zero usuniętych
    // wierszy to `404`, nie `409`. Trasa pokazuje zdanie przy liście — ekran
    // błędu za kliknięcie w nieaktualny przycisk byłby gorszy.
    const api = klient(() =>
      odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono zasobu.", {
        resource: "featureRequest",
        id: "fr-1",
      }),
    );

    const blad = await deleteFeatureRequest(api, "fr-1").catch((e) => e);

    expect(blad).toBeInstanceOf(FeatureRequestError);
    expect((blad as FeatureRequestError).userMessage).toBe("Nie znaleziono zasobu.");
  });

  it("`500` przechodzi jako ApiError", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await deleteFeatureRequest(api, "fr-1").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(FeatureRequestError);
  });
});

describe("listForTrainer — skrzynka trenera", () => {
  it("filtry statusu i rodzaju, szukajka, sortowanie i strona idą pod `/v1/feature-requests`", async () => {
    let sciezka = "";
    let zapytanie = "";
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      zapytanie = url.search;
      return json(200, strona([ZGLOSZENIE_U_TRENERA]));
    });

    await listForTrainer(api, {
      page: 2,
      sort: "oldest",
      status: "considering",
      kind: "bug",
      q: "Anna",
    });

    expect(sciezka).toBe("/v1/feature-requests");
    expect(zapytanie).toContain("page=2");
    expect(zapytanie).toContain("sort=oldest");
    expect(zapytanie).toContain("status=considering");
    expect(zapytanie).toContain("kind=bug");
    expect(zapytanie).toContain("q=Anna");
  });

  it("`all` i puste `q` nie trafiają do zapytania", async () => {
    // Puste `q=` znaczy w kontrakcie „szukaj pustego łańcucha", nie „bez filtra".
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([]));
    });

    await listForTrainer(api, { page: 1, sort: "newest", status: "all", kind: "all", q: "" });

    expect(zapytanie).not.toContain("status=");
    expect(zapytanie).not.toContain("kind=");
    expect(zapytanie).not.toContain("q=");
  });

  it("wiersze niosą autora (`authorName`) — moduł nie dokleja go osobnym zapytaniem", async () => {
    // Dawny `innerJoin` na `users` przeszedł na drugą stronę razem z szukajką
    // po nazwie autora (`docs/04` §Zgłoszenia).
    const api = klient(() => json(200, strona([ZGLOSZENIE_U_TRENERA], 1, 1, 1)));

    const wynik = await listForTrainer(api, { page: 1, sort: "newest" });

    expect(wynik.items[0]?.authorName).toBe("Anna Kowalska");
    expect(wynik.total).toBe(1);
  });
});

describe("getForTrainer — szczegół zgłoszenia", () => {
  it("idzie pod `/v1/feature-requests/{id}` i wraca z autorem", async () => {
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, ZGLOSZENIE_U_TRENERA);
    });

    const wynik = await getForTrainer(api, "fr-1");

    expect(sciezka).toBe("/v1/feature-requests/fr-1");
    expect(wynik?.authorName).toBe("Anna Kowalska");
    expect(wynik?.body).toBe(ZGLOSZENIE.body);
  });

  it("`404` daje `null` — sygnatura z `| null` łapie brak zasobu", async () => {
    // Cudze zgłoszenie jest po tamtej stronie nieodróżnialne od nieistniejącego;
    // trasa robi z `null` własne 404, jak do integracji.
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono zasobu."));

    expect(await getForTrainer(api, "fr-x")).toBeNull();
  });
});

describe("respondToFeatureRequest — odpowiedź trenera", () => {
  it("to `POST /v1/feature-requests/{id}/response` ze statusem i treścią", async () => {
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(201, {
        ...ZGLOSZENIE_U_TRENERA,
        status: "planned",
        trainerResponse: "Robimy w przyszłym miesiącu.",
        respondedAt: "2026-08-21T10:00:00.000Z",
      });
    });

    const wynik = await respondToFeatureRequest(api, {
      id: "fr-1",
      status: "planned",
      response: "Robimy w przyszłym miesiącu.",
    });

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/feature-requests/fr-1/response");
    expect(cialo).toEqual({ status: "planned", response: "Robimy w przyszłym miesiącu." });
    // Datę stempluje BE — moduł niczego nie dokłada, tylko oddaje odpowiedź.
    expect(wynik.respondedAt).toBe("2026-08-21T10:00:00.000Z");
  });

  it("pusta odpowiedź (`null`) NIE wysyła klucza `response` — kasowanie należy do BE", async () => {
    // DTO zna wyłącznie `response?: string`; `null` byłoby wartością spoza typu.
    // Pominięta treść kasuje po tamtej stronie odpowiedź razem z datą.
    let cialo: unknown;
    const api = klient(async (req) => {
      cialo = await req.json();
      return json(201, { ...ZGLOSZENIE_U_TRENERA, status: "considering" });
    });

    await respondToFeatureRequest(api, { id: "fr-1", status: "considering", response: null });

    expect(cialo).toEqual({ status: "considering" });
  });

  it("`400` zamienia na FeatureRequestError, a `404` przelatuje jako ApiError (trasa robi z niego 404)", async () => {
    const zaDlugie = klient(() =>
      odmowa(400, "VALIDATION_FAILED", "Odpowiedź może mieć najwyżej 2000 znaków."),
    );
    const cudze = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono zasobu."));

    const bladTresci = await respondToFeatureRequest(zaDlugie, {
      id: "fr-1",
      status: "done",
      response: "x".repeat(2001),
    }).catch((e) => e);
    const bladCudzego = await respondToFeatureRequest(cudze, {
      id: "fr-x",
      status: "done",
      response: null,
    }).catch((e) => e);

    expect(bladTresci).toBeInstanceOf(FeatureRequestError);
    expect((bladTresci as FeatureRequestError).userMessage).toBe(
      "Odpowiedź może mieć najwyżej 2000 znaków.",
    );
    expect(bladCudzego).toBeInstanceOf(ApiError);
    expect(bladCudzego).not.toBeInstanceOf(FeatureRequestError);
    expect((bladCudzego as ApiError).status).toBe(404);
  });
});
