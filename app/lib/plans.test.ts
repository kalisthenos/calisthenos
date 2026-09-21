import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import type { PlanForm } from "./plan-types";
import {
  PlanError,
  createBlankPlan,
  createDraftFromActive,
  deletePlan,
  findDraftForTrainee,
  listPlansForTrainee,
  listPlansForTrainer,
  loadPlanForTrainer,
  planDeleteOutcomeMessage,
  publishPlan,
  saveDraftPlan,
  toSavePlanDto,
} from "./plans";

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

const PLAN_LISTY = {
  id: "p-1",
  name: "Siła 1",
  status: "active" as const,
  version: 2,
  traineeId: "t-1",
  traineeName: "Anna Kowalska",
  sessionCount: 3,
  publishedAt: "2026-08-01T10:00:00.000Z",
  createdAt: "2026-07-20T10:00:00.000Z",
};

const LICZNIKI = { all: 5, active: 3, draft: 2 };

function strona(
  items: unknown[],
  page = 1,
  totalPages = 1,
  total = items.length,
  counts = LICZNIKI,
) {
  return { items, page, totalPages, total, counts };
}

describe("listPlansForTrainer — lista planów na kontrakcie", () => {
  it("sortowanie i strona idą do kontraktu bez tłumaczenia", async () => {
    // Adresy list są zakładkowalne (`?sort=published`), a kontrakt nazywa
    // sortowania DOKŁADNIE tak samo — słownika, jaki mają ćwiczenia, tu nie ma
    // i test pilnuje, żeby nikt go nie dopisał „dla symetrii".
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([PLAN_LISTY]));
    });

    await listPlansForTrainer(api, { status: "all", sort: "published", page: 2 });

    expect(zapytanie).toContain("sort=published");
    expect(zapytanie).toContain("page=2");
  });

  it("`all` nie wysyła parametru `status`, a puste `q` nie trafia do zapytania", async () => {
    // Lista nigdy nie niesie zarchiwizowanych, więc `all` to brak zawężenia —
    // a `status=all` kontrakt by zignorował jako nieznaną wartość. Puste `q=`
    // znaczy z kolei „szukaj pustego łańcucha", nie „bez filtra".
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([PLAN_LISTY]));
    });

    await listPlansForTrainer(api, { status: "all", q: "", sort: "newest", page: 1 });

    expect(zapytanie).not.toContain("status=");
    expect(zapytanie).not.toContain("q=");
  });

  it("filtr statusu i szukajka idą do kontraktu, gdy są ustawione", async () => {
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([PLAN_LISTY]));
    });

    await listPlansForTrainer(api, { status: "draft", q: "Anna", sort: "newest", page: 1 });

    expect(zapytanie).toContain("status=draft");
    expect(zapytanie).toContain("q=Anna");
  });

  it("liczniki zakładek i liczby stron przychodzą z kontraktu, moduł ich nie przelicza", async () => {
    // Do integracji trasa robiła trzy zapytania i liczyła `safePage` sama.
    // Teraz `counts` przychodzą z tą samą odpowiedzią, a stronę spoza zakresu
    // przycina BE — dwa niezależne liczenia rozjechałyby się przy pierwszej
    // zmianie rozmiaru strony po tamtej stronie.
    const api = klient(() => json(200, strona([PLAN_LISTY], 3, 3, 41)));

    const wynik = await listPlansForTrainer(api, { status: "all", sort: "newest", page: 99 });

    expect(wynik.page).toBe(3);
    expect(wynik.totalPages).toBe(3);
    expect(wynik.total).toBe(41);
    expect(wynik.counts).toEqual(LICZNIKI);
    expect(wynik.items).toEqual([PLAN_LISTY]);
  });
});

// Koperta błędu BE: `{ error: { code, message, details } }` — dokładnie to, co
// rozbiera `parseApiError`. Nazwa `odmowa`, bo `blad` jest w tym pliku zmienną
// lokalną na złapany wyjątek (idiom z `exercises.test.ts`).
function odmowa(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, details } });
}

describe("deletePlan — usuwanie przez kontrakt", () => {
  it("oddaje `outcome` z odpowiedzi, bez liczby logów", async () => {
    // O wyniku decydują logi po stronie BE. Liczby logów kontrakt nie niesie —
    // komunikat trasy przestał ją pokazywać (decyzja B12), więc moduł nie ma
    // skąd jej wziąć i nie udaje, że ma.
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, { outcome: "archived" });
    });

    const wynik = await deletePlan(api, "p-1");

    expect(wynik).toBe("archived");
    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/plans/p-1");
  });

  it("`409` zamienia na PlanError z komunikatem BE", async () => {
    // Plan już zarchiwizowany, mający logi — dziś FE składał to zdanie sam,
    // teraz zdanie należy do BE. Trasa pokazuje `userMessage` w pasku akcji.
    const api = klient(() =>
      odmowa(409, "PLAN_NOT_ARCHIVABLE", "Archiwizować można wyłącznie plan aktywny.", {
        status: "archived",
      }),
    );

    const blad = await deletePlan(api, "p-1").catch((e) => e);

    expect(blad).toBeInstanceOf(PlanError);
    expect((blad as PlanError).userMessage).toBe("Archiwizować można wyłącznie plan aktywny.");
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await deletePlan(api, "p-1").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(PlanError);
  });

  it("komunikat sukcesu zależy od outcome, jedno zdanie na obie trasy", () => {
    // Dwie trasy (lista, widok podopiecznego) pokazywały ten sam ternary nad
    // `outcome` — dosłowna duplikacja. Zdanie mieszka teraz tu, w module, obok
    // reszty komunikatów tego obszaru (`PlanError.userMessage`), więc trasy
    // wołają jedną funkcję zamiast powtarzać dwa identyczne stringi.
    expect(planDeleteOutcomeMessage("deleted")).toContain("usunięty");
    expect(planDeleteOutcomeMessage("archived")).toContain("zarchiwizowany");
  });
});

const PLAN_PARY = {
  id: "p-2",
  name: "Siła 2",
  status: "draft" as const,
  version: 3,
  basedOnVersion: 2,
  sessionCount: 0,
  publishedAt: null,
  createdAt: "2026-08-20T10:00:00.000Z",
};

describe("listPlansForTrainee / findDraftForTrainee — plany pary", () => {
  it("lista pary idzie pod `/v1/trainees/{id}/plans` i wraca nietknięta", async () => {
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, [PLAN_PARY, { ...PLAN_LISTY, basedOnVersion: null }]);
    });

    const wynik = await listPlansForTrainee(api, "t-1");

    expect(sciezka).toBe("/v1/trainees/t-1/plans");
    expect(wynik).toHaveLength(2);
  });

  it("szkic pary to pozycja ze statusem `draft`, a jej brak to `null`", async () => {
    // Cudzy podopieczny daje po stronie BE PUSTĄ listę, nie `404` — więc `null`
    // bierze się stąd naturalnie, bez `orNull`. Test pilnuje obu gałęzi.
    const zeSzkicem = klient(() => json(200, [PLAN_PARY, { ...PLAN_LISTY, basedOnVersion: null }]));
    const bezSzkicu = klient(() => json(200, [{ ...PLAN_LISTY, basedOnVersion: null }]));

    expect((await findDraftForTrainee(zeSzkicem, "t-1"))?.id).toBe("p-2");
    expect(await findDraftForTrainee(bezSzkicu, "t-1")).toBeNull();
  });
});

describe("createBlankPlan — nowy pusty plan", () => {
  it("wysyła wyłącznie `traineeId` i `name`, oddaje identyfikator i `created: true`", async () => {
    // `trainerId` w ciele byłoby polem spoza DTO, czyli `400` (forbidNonWhitelisted).
    let cialo: unknown;
    const api = klient(async (req) => {
      cialo = await req.json();
      return json(201, { id: "p-9" });
    });

    const wynik = await createBlankPlan(api, { traineeId: "t-1", name: "Nowy plan" });

    expect(cialo).toEqual({ traineeId: "t-1", name: "Nowy plan" });
    expect(wynik).toEqual({ id: "p-9", created: true });
  });

  it("`409 PLAN_DRAFT_EXISTS` oddaje istniejący szkic zamiast błędu", async () => {
    // Kontrakt „wskazuje istniejący" (`details.planId`) właśnie po to, żeby
    // trasa miała dokąd przekierować — dzisiejszy pre-check w akcji znika, a
    // wyścig „dwa szkice naraz" domyka unikat po stronie BE.
    const api = klient(() =>
      odmowa(409, "PLAN_DRAFT_EXISTS", "Ten podopieczny ma już szkic planu.", { planId: "p-2" }),
    );

    const wynik = await createBlankPlan(api, { traineeId: "t-1", name: "Nowy plan" });

    expect(wynik).toEqual({ id: "p-2", created: false });
  });

  it("`409` bez `details.planId` idzie do formularza jako PlanError, nie na granicę błędu", async () => {
    // BE zawsze niesie `planId` przy `PLAN_DRAFT_EXISTS`, ale odmowa bez wskazania
    // (i każdy inny `409`) ma zostać zdaniem w formularzu, tak jak `404` — nie
    // ekranem błędu.
    const api = klient(() =>
      odmowa(409, "PLAN_DRAFT_EXISTS", "Ten podopieczny ma już szkic planu."),
    );

    const blad = await createBlankPlan(api, { traineeId: "t-1", name: "Nowy plan" }).catch(
      (e) => e,
    );

    expect(blad).toBeInstanceOf(PlanError);
    expect((blad as PlanError).userMessage).toBe("Ten podopieczny ma już szkic planu.");
  });

  it("`404` (cudzy podopieczny) zamienia na PlanError do formularza", async () => {
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono podopiecznego."));

    const blad = await createBlankPlan(api, { traineeId: "t-x", name: "Nowy plan" }).catch(
      (e) => e,
    );

    expect(blad).toBeInstanceOf(PlanError);
    expect((blad as PlanError).userMessage).toBe("Nie znaleziono podopiecznego.");
  });
});

const SZCZEGOL = {
  id: "p-1",
  name: "Siła 1",
  status: "active",
  version: 2,
  basedOnVersion: 1,
  publishedAt: "2026-08-01T10:00:00.000Z",
  createdAt: "2026-07-20T10:00:00.000Z",
  trainee: { id: "t-1", displayName: "Anna Kowalska" },
  draftId: "p-2",
  editable: false,
  sessions: [
    {
      id: "s-1",
      name: "Dzień A",
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
              exerciseName: "Podciąganie",
              reps: 8,
              unit: "REPS" as const,
              sets: 3,
              restSeconds: 90,
              note: null,
            },
          ],
        },
      ],
    },
  ],
};

describe("loadPlanForTrainer — szczegół planu", () => {
  it("oddaje drzewo z kontraktu razem z `draftId` pary", async () => {
    // `draftId` zastępuje osobne zapytanie „czy para ma już szkic" — loader
    // edytora przekierowuje na nie przy `?edit=1` planu aktywnego.
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, SZCZEGOL);
    });

    const wynik = await loadPlanForTrainer(api, "p-1");

    expect(sciezka).toBe("/v1/plans/p-1");
    expect(wynik?.draftId).toBe("p-2");
    expect(wynik?.sessions[0]?.blocks[0]?.items[0]?.exerciseName).toBe("Podciąganie");
  });

  it("`404` daje `null` — sygnatura z `| null` łapie brak zasobu", async () => {
    const api = klient(() => odmowa(404, "PLAN_NOT_FOUND", "Nie znaleziono planu."));

    expect(await loadPlanForTrainer(api, "p-x")).toBeNull();
  });
});

function pusto(status: number): Response {
  return new Response(null, { status });
}

const FORMULARZ: PlanForm = {
  name: "Siła 1",
  sessions: [
    {
      id: "tmp-1",
      name: "Dzień A",
      blocks: [
        {
          id: "tmp-2",
          kind: "single",
          sets: 5,
          restSeconds: 120,
          items: [
            {
              id: "tmp-3",
              exerciseId: "e-1",
              reps: 8,
              unit: "REPS",
              sets: 3,
              restSeconds: 90,
              note: undefined,
            },
          ],
        },
        {
          id: "tmp-4",
          kind: "dropset",
          sets: 4,
          restSeconds: 60,
          items: [
            { id: "tmp-5", exerciseId: "e-1", reps: 10, unit: "REPS", sets: 3, restSeconds: 30 },
            { id: "tmp-6", exerciseId: "e-2", reps: 6, unit: "REPS", note: "wolno" },
          ],
        },
      ],
    },
  ],
};

describe("toSavePlanDto — formularz na DTO kontraktu", () => {
  const dto = toSavePlanDto(FORMULARZ);

  it("zdejmuje `id` z sesji, bloków i pozycji", () => {
    // `forbidNonWhitelisted: true` po stronie BE: pole spoza DTO to `400`, nie
    // ciche pominięcie. `PlanForm` jest strukturalnie szerszy niż `SavePlanDto`,
    // więc TypeScript nadmiaru NIE zgłosi — tylko ten test go pilnuje.
    expect(JSON.stringify(dto)).not.toContain('"id"');
  });

  it("single/superset: tempo na pozycjach, blok ma `null`", () => {
    const blok = dto.sessions[0]?.blocks[0];
    expect(blok).toMatchObject({ kind: "single", sets: null, restSeconds: null });
    expect(blok?.items[0]).toEqual({
      exerciseId: "e-1",
      reps: 8,
      unit: "REPS",
      sets: 3,
      restSeconds: 90,
      note: null,
    });
  });

  it("dropset: tempo na bloku, pozycje mają `null`", () => {
    // Ta sama normalizacja, którą do integracji robił `saveDraftPlan` w transakcji
    // — reguła rodzaju bloku nie zmienia właściciela, zmienia tylko miejsce.
    const blok = dto.sessions[0]?.blocks[1];
    expect(blok).toMatchObject({ kind: "dropset", sets: 4, restSeconds: 60 });
    expect(blok?.items.map((i) => [i.sets, i.restSeconds, i.note])).toEqual([
      [null, null, null],
      [null, null, "wolno"],
    ]);
  });
});

describe("saveDraftPlan / createDraftFromActive / publishPlan — zapisy edytora", () => {
  it("zapis to `PUT /v1/plans/{id}` z ciałem po `toSavePlanDto`", async () => {
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return pusto(204);
    });

    await saveDraftPlan(api, "p-2", FORMULARZ);

    expect(metoda).toBe("PUT");
    expect(sciezka).toBe("/v1/plans/p-2");
    expect(cialo).toEqual(toSavePlanDto(FORMULARZ));
  });

  it("zapis: `409 PLAN_NOT_DRAFT` i `400` reguły drzewa idą do formularza jako PlanError", async () => {
    // Trasa pokazuje `userMessage` w formularzu edytora. `400` mapujemy, choć
    // Zod stoi pierwszy — reguły drzewa po stronie BE mogą być ostrzejsze,
    // a jedno zdanie w formularzu jest lepsze niż granica błędu.
    const nieSzkic = klient(() =>
      odmowa(409, "PLAN_NOT_DRAFT", "Zmieniać można wyłącznie szkic planu.", { status: "active" }),
    );
    const drzewo = klient(() =>
      odmowa(
        400,
        "PLAN_BLOCK_CARDINALITY_INVALID",
        "Liczba ćwiczeń w bloku nie pasuje do jego rodzaju.",
      ),
    );

    const bladStatusu = await saveDraftPlan(nieSzkic, "p-1", FORMULARZ).catch((e) => e);
    const bladDrzewa = await saveDraftPlan(drzewo, "p-2", FORMULARZ).catch((e) => e);

    expect(bladStatusu).toBeInstanceOf(PlanError);
    expect((bladStatusu as PlanError).userMessage).toBe("Zmieniać można wyłącznie szkic planu.");
    expect(bladDrzewa).toBeInstanceOf(PlanError);
    expect((bladDrzewa as PlanError).userMessage).toBe(
      "Liczba ćwiczeń w bloku nie pasuje do jego rodzaju.",
    );
  });

  it("szkic z aktywnego: `201` to nowy szkic, `200` to istniejący — jedno wywołanie robi obie rzeczy", async () => {
    // BE sprawdza po kolei: cudzy → 404, para ma szkic → 200 istniejący, źródło
    // nie `active` → 409. Gałąź „użyj istniejącego szkicu" z dawnej akcji
    // edytora jest przez to zbędna.
    let sciezka = "";
    const nowy = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(201, { id: "p-3" });
    });
    const istniejacy = klient(() => json(200, { id: "p-2" }));

    expect(await createDraftFromActive(nowy, "p-1")).toEqual({ id: "p-3", created: true });
    expect(sciezka).toBe("/v1/plans/p-1/draft");
    expect(await createDraftFromActive(istniejacy, "p-1")).toEqual({ id: "p-2", created: false });
  });

  it("szkic z aktywnego: `409 PLAN_NOT_ACTIVE` to PlanError", async () => {
    const api = klient(() =>
      odmowa(409, "PLAN_NOT_ACTIVE", "Szkic można utworzyć wyłącznie z planu aktywnego.", {
        status: "archived",
      }),
    );

    const blad = await createDraftFromActive(api, "p-9").catch((e) => e);

    expect(blad).toBeInstanceOf(PlanError);
    expect((blad as PlanError).userMessage).toBe(
      "Szkic można utworzyć wyłącznie z planu aktywnego.",
    );
  });

  it("publikacja to `POST /v1/plans/{id}/publish`, a `409 PLAN_EMPTY` idzie do formularza", async () => {
    // Reguła, której FE nie miał: BE odmawia publikacji planu bez sesji.
    // Bierzemy komunikat BE dosłownie — ustalenia po tamtej stronie są nadrzędne.
    let sciezka = "";
    const ok = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return pusto(204);
    });
    const pusty = klient(() =>
      odmowa(409, "PLAN_EMPTY", "Nie można opublikować planu bez ani jednej sesji."),
    );

    await publishPlan(ok, "p-2");
    expect(sciezka).toBe("/v1/plans/p-2/publish");

    const blad = await publishPlan(pusty, "p-2").catch((e) => e);

    expect(blad).toBeInstanceOf(PlanError);
    expect((blad as PlanError).userMessage).toBe(
      "Nie można opublikować planu bez ani jednej sesji.",
    );
  });
});
