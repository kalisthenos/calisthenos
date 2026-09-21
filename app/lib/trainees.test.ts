import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  TraineeDeleteError,
  deleteTraineeFully,
  findTraineeRef,
  listClientsForTrainer,
  listTraineesOfTrainer,
} from "./trainees";

// Mocka `~/lib/env` tu już nie ma: `trainees.ts` przestał importować
// `file-uploads.ts` (kaskada `deleteFileBlob` zniknęła), a `createApiClient`
// z jawnym `baseUrl` nie czyta konfiguracji.
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

function odmowa(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, details } });
}

const PODOPIECZNY = {
  id: "t-1",
  displayName: "Anna Kowalska",
  sessionCount: 12,
  lastSessionOn: "2026-08-30",
  hasActivePlan: true,
};

function strona(items: unknown[], page = 1, totalPages = 1, total = items.length) {
  return { items, page, totalPages, total };
}

describe("listClientsForTrainer — lista podopiecznych na kontrakcie", () => {
  it("idzie pod `/v1/trainees` z sortowaniem, filtrem planu, szukajką i stroną bez tłumaczenia", async () => {
    // Pięć wartości `sort` i trzy `plan` są w kontrakcie DOKŁADNIE tymi z zakładkowalnego
    // adresu listy — słownika nie ma, test pilnuje, żeby nikt go nie dopisał.
    let sciezka = "";
    let zapytanie = "";
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      zapytanie = url.search;
      return json(200, strona([PODOPIECZNY]));
    });

    await listClientsForTrainer(api, { page: 2, sort: "most_sessions", q: "anna", plan: "with" });

    expect(sciezka).toBe("/v1/trainees");
    expect(zapytanie).toContain("page=2");
    expect(zapytanie).toContain("sort=most_sessions");
    expect(zapytanie).toContain("q=anna");
    expect(zapytanie).toContain("plan=with");
  });

  it("`plan: all` i puste `q` nie trafiają do zapytania", async () => {
    // `all` to brak zawężenia, a puste `q=` znaczy w kontrakcie „szukaj pustego
    // łańcucha", nie „bez filtra" — dlatego oba muszą zniknąć z zapytania.
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([PODOPIECZNY]));
    });

    await listClientsForTrainer(api, { page: 1, sort: "name_asc", q: "", plan: "all" });

    expect(zapytanie).not.toContain("plan=");
    expect(zapytanie).not.toContain("q=");
  });

  it("strona i licznik przychodzą razem — moduł nie liczy stron", async () => {
    // Do integracji trasa robiła dwa zapytania (`countClientsForTrainer` + lista)
    // i liczyła `safePage` sama; rozmiar strony (30) należy teraz do BE.
    const api = klient(() => json(200, strona([PODOPIECZNY], 2, 2, 31)));

    const wynik = await listClientsForTrainer(api, { page: 9, sort: "name_asc" });

    expect(wynik.page).toBe(2);
    expect(wynik.totalPages).toBe(2);
    expect(wynik.total).toBe(31);
    expect(wynik.items[0]?.hasActivePlan).toBe(true);
  });
});

const DRUGI = { ...PODOPIECZNY, id: "t-2", displayName: "Bartek Nowak" };
const TRZECI = { ...PODOPIECZNY, id: "t-3", displayName: "Cezary Wolny" };

describe("listTraineesOfTrainer — komplet do pickera ze sklejonych stron", () => {
  it("dobiera kolejne strony aż do `totalPages` z PIERWSZEJ odpowiedzi", async () => {
    // Picker planu potrzebuje kompletu, a kontrakt stronicuje po 30 i nie ma
    // parametru „wszystko". Granicą pętli jest `totalPages` z pierwszej
    // odpowiedzi — inaczej dopisanie podopiecznego między żądaniami mogłoby
    // ją przesuwać w nieskończoność.
    const zapytania: string[] = [];
    const api = klient((req) => {
      const zapytanie = new URL(req.url).search;
      zapytania.push(zapytanie);
      return json(
        200,
        zapytanie.includes("page=1")
          ? strona([PODOPIECZNY, DRUGI], 1, 2, 3)
          : strona([TRZECI], 2, 2, 3),
      );
    });

    const wynik = await listTraineesOfTrainer(api);

    expect(zapytania).toHaveLength(2);
    expect(zapytania[0]).toContain("page=1");
    expect(zapytania[1]).toContain("page=2");
    expect(wynik).toEqual([
      { id: "t-1", displayName: "Anna Kowalska" },
      { id: "t-2", displayName: "Bartek Nowak" },
      { id: "t-3", displayName: "Cezary Wolny" },
    ]);
  });

  it("sortowanie idzie JAWNIE, choć `name_asc` jest domyślne w kontrakcie", async () => {
    // Sklejanie stron ma sens tylko przy porządku stabilnym między żądaniami,
    // a domyślna wartość jest cudzą decyzją, która może się zmienić bez naszego
    // udziału — wtedy strony skleiłyby się w losowej kolejności.
    const zapytania: string[] = [];
    const api = klient((req) => {
      zapytania.push(new URL(req.url).search);
      return json(200, strona([PODOPIECZNY], 1, 1, 1));
    });

    await listTraineesOfTrainer(api);

    expect(zapytania[0]).toContain("sort=name_asc");
  });

  it("jedna strona to jedno żądanie", async () => {
    const zapytania: string[] = [];
    const api = klient((req) => {
      zapytania.push(new URL(req.url).search);
      return json(200, strona([PODOPIECZNY], 1, 1, 1));
    });

    expect(await listTraineesOfTrainer(api)).toHaveLength(1);
    expect(zapytania).toHaveLength(1);
  });
});

describe("findTraineeRef — nazwa podopiecznego do nagłówka (obejście L S5-2)", () => {
  it("znajduje podopiecznego także na dalszej stronie", async () => {
    // Kontrakt nie ma `GET /v1/trainees/{id}`, a `q` szuka po nazwie i e-mailu,
    // nie po identyfikatorze — więc szukanego trzeba znaleźć w sklejonej liście,
    // a nie tylko na pierwszej stronie.
    const api = klient((req) =>
      json(
        200,
        new URL(req.url).search.includes("page=1")
          ? strona([PODOPIECZNY], 1, 2, 2)
          : strona([DRUGI], 2, 2, 2),
      ),
    );

    expect(await findTraineeRef(api, "t-2")).toEqual({ id: "t-2", displayName: "Bartek Nowak" });
  });

  it("cudzy albo nieistniejący daje `null` — tak samo, jak dawny `findTraineeOfTrainer`", async () => {
    // `null` prowadzi w trasach do `404`, więc gałąź zachowania nie zmieniła się
    // ani o krok mimo zmiany źródła danych. Zakresu tenanta ta funkcja NIE stanowi
    // — lista przychodzi już zawężona przez BE.
    const api = klient(() => json(200, strona([PODOPIECZNY], 1, 1, 1)));

    expect(await findTraineeRef(api, "t-obcy")).toBeNull();
  });
});

describe("deleteTraineeFully — usunięcie przez kontrakt", () => {
  it("wysyła `DELETE /v1/trainees/{id}` bez ciała i nie oczekuje odpowiedzi", async () => {
    // `204` bez treści: nazwy do komunikatu trasa NIE bierze z odpowiedzi (ma ją
    // z nagłówka), a liczba skasowanych plików zniknęła razem z kaskadą.
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return new Response(null, { status: 204 });
    });

    await expect(deleteTraineeFully(api, "t-1")).resolves.toBeUndefined();

    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/trainees/t-1");
  });

  it("`409 TRAINEE_HAS_OTHER_TIES` zamienia na TraineeDeleteError z komunikatem BE", async () => {
    // Podmiot prowadzi kogoś innego albo ma rolę spoza `trainee` — odmowa
    // z treścią dla trenera, do paska akcji, nie ekran błędu.
    const api = klient(() =>
      odmowa(
        409,
        "TRAINEE_HAS_OTHER_TIES",
        "Ta osoba prowadzi innych podopiecznych — usunięcie zabrałoby ich dane.",
      ),
    );

    const blad = await deleteTraineeFully(api, "t-1").catch((e) => e);

    expect(blad).toBeInstanceOf(TraineeDeleteError);
    expect((blad as TraineeDeleteError).userMessage).toBe(
      "Ta osoba prowadzi innych podopiecznych — usunięcie zabrałoby ich dane.",
    );
  });

  it("`404` (cudzy, były, nieistniejący) też idzie do paska akcji", async () => {
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono podopiecznego."));

    const blad = await deleteTraineeFully(api, "t-obcy").catch((e) => e);

    expect(blad).toBeInstanceOf(TraineeDeleteError);
    expect((blad as TraineeDeleteError).userMessage).toBe("Nie znaleziono podopiecznego.");
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await deleteTraineeFully(api, "t-1").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(TraineeDeleteError);
  });
});
