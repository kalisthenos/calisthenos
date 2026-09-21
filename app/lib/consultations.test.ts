import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import type { AdhocConsultationForm, ConsultationDocForm } from "./consultation-types";
import {
  type ConsultationDetail,
  ConsultationError,
  type ConsultationView,
  LIST_WINDOW_DAYS,
  appWallClockNow,
  canTraineeRespond,
  cancelOccurrence,
  createAdhocConsultation,
  deleteConsultation,
  documentConsultation,
  fromAppWallClock,
  getConsultationDetail,
  listOccurrencesForTrainer,
  listOccurrencesInRange,
  loadUpcomingConsultations,
  rescheduleOccurrence,
  respondToOccurrence,
  runConsultationSync,
  setActionItemStatus,
  toAppWallClock,
} from "./consultations";

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

const DAY_MS = 24 * 60 * 60 * 1000;

// Moment `16:00Z` w lipcu to 18:00 czasu warszawskiego (CEST, UTC+2).
const TERMIN: ConsultationView = {
  id: "c-1",
  scheduledAt: "2026-07-10T16:00:00.000Z",
  durationMin: 45,
  status: "planned",
  meetingUrl: null,
  traineeNote: null,
  trainee: { id: "t-1", displayName: "Anna Kowalska" },
  fromSchedule: true,
  presentation: { key: "planned", tone: "neutral" },
  allowedActions: ["confirm", "request_change", "decline"],
};

const SZCZEGOL: ConsultationDetail = {
  ...TERMIN,
  summary: "Notatki",
  actionItems: [
    { id: "i-1", ordinal: 0, body: "Więcej mobilności", status: "open", resolvedAt: null },
  ],
  // Notatka AI (klient 0.7.0) — oba pola są w kontrakcie WYMAGANE, więc ta
  // fikstura musi je nieść, choć żaden test w tym pliku ich nie dotyczy.
  // `disabled`, nie `no-meeting-url`: ta fikstura nie mówi nic o integracji
  // notetakera, a `disabled` jest jedynym stanem, który znaczy dokładnie to.
  // `no-meeting-url` twierdziłoby, że integracja JEST włączona i brakuje tylko
  // odnośnika — a `TERMIN` wyżej ma `meetingUrl: null` przypadkiem, nie po to.
  aiNotes: null,
  aiNotesState: "disabled",
};

describe("czas — moment BE ↔ czas ścienny FE", () => {
  it("moment z BE staje się czasem ściennym strefy aplikacji zapisanym jako „UTC”", () => {
    // Harmonogram o 18:00 daje po stronie BE `16:00Z` latem i `17:00Z` zimą.
    // FE czyta godzinę przez `getUTC*`, więc bez przeliczenia pokazałby 16:00.
    expect(toAppWallClock("2026-07-10T16:00:00.000Z")).toBe("2026-07-10T18:00:00.000Z");
    expect(toAppWallClock("2026-01-10T17:00:00.000Z")).toBe("2026-01-10T18:00:00.000Z");
    // Przez północ: zmienia się też data, nie tylko godzina.
    expect(toAppWallClock("2026-07-10T22:30:00.000Z")).toBe("2026-07-11T00:30:00.000Z");
  });

  it("czas ścienny FE staje się momentem — i wraca bez straty", () => {
    expect(fromAppWallClock("2026-07-10T18:00:00.000Z")).toBe("2026-07-10T16:00:00.000Z");
    expect(fromAppWallClock("2026-01-10T18:00:00.000Z")).toBe("2026-01-10T17:00:00.000Z");
    expect(toAppWallClock(fromAppWallClock("2026-03-15T09:15:00.000Z"))).toBe(
      "2026-03-15T09:15:00.000Z",
    );
  });

  /**
   * D-FE-3. `scheduledAt` opuszcza ten moduł jako CZAS ŚCIENNY zapisany
   * w komponentach UTC, a `Date.now()` jest PRAWDZIWYM momentem. Porównanie
   * jednego z drugim myli się dokładnie o offset strefy — dwie godziny latem,
   * godzinę zimą — więc spotkanie sprzed półtorej godziny wypada latem jako
   * przyszłe.
   *
   * **Dlaczego nie złapał tego żaden z testów wyżej:** wszystkie operują na
   * datach oddalonych o dni, a pomyłka jest rzędu godzin. Test na danych,
   * w których obie strony i tak się zgadzają, nie odróżnia poprawnej
   * implementacji od zepsutej.
   */
  const TERAZ_LATEM = new Date("2026-09-21T12:00:00.000Z");

  it("„teraz” da się wyrazić w konwencji tego modułu, nie tylko jako moment", () => {
    expect(appWallClockNow(TERAZ_LATEM)).toBe(
      Date.parse(toAppWallClock(TERAZ_LATEM.toISOString())),
    );
    expect(appWallClockNow(TERAZ_LATEM) - TERAZ_LATEM.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it("zimą przesunięcie jest godzinne — wartość zależy od momentu, nie jest stałą", () => {
    const teraz = new Date("2026-01-21T12:00:00.000Z");
    expect(appWallClockNow(teraz) - teraz.getTime()).toBe(60 * 60 * 1000);
  });

  it("termin sprzed 90 minut jest MINIONY, a wobec surowego momentu wyglądałby na przyszły", () => {
    const zaczalSie = Date.parse(toAppWallClock("2026-09-21T10:30:00.000Z"));

    expect(zaczalSie).toBeLessThan(appWallClockNow(TERAZ_LATEM));
    // Kontrast, nie ozdoba: bez tej asercji test przechodziłby także przed
    // poprawką, bo nie odróżniałby jednej konwencji czasu od drugiej.
    expect(zaczalSie).toBeGreaterThan(TERAZ_LATEM.getTime());
  });
});

describe("listOccurrencesInRange — siatka miesiąca na kontrakcie", () => {
  it("zakres miesiąca idzie do kontraktu jako momenty, a terminy wracają jako czas ścienny", async () => {
    // `monthRangeUTC` liczy okno w konwencji FE (północ „UTC” = północ ścienna),
    // więc do BE musi wyjść moment o dwie godziny wcześniejszy latem.
    let sciezka = "";
    let metoda = "";
    let zapytanie = new URLSearchParams();
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      metoda = req.method;
      zapytanie = url.searchParams;
      return json(200, [TERMIN]);
    });

    const wynik = await listOccurrencesInRange(api, {
      fromISO: "2026-07-01T00:00:00.000Z",
      toISO: "2026-07-31T23:59:59.000Z",
    });

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/consultations");
    expect(zapytanie.get("from")).toBe("2026-06-30T22:00:00.000Z");
    expect(zapytanie.get("to")).toBe("2026-07-31T21:59:59.000Z");
    expect(wynik[0]?.scheduledAt).toBe("2026-07-10T18:00:00.000Z");
    expect(wynik[0]?.trainee.displayName).toBe("Anna Kowalska");
  });

  it("`500` przechodzi jako ApiError — lista nie ma własnego typu błędu", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await listOccurrencesInRange(api, {
      fromISO: "2026-07-01T00:00:00.000Z",
      toISO: "2026-07-31T23:59:59.000Z",
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
  });
});

describe("listOccurrencesForTrainer — terminy pary z listy zbiorczej", () => {
  it("zawęża do pary W MODULE, jednym wywołaniem, w oknie roku wokół teraz", async () => {
    // Kontrakt nie ma listy per podopieczny: trener dostaje wszystkich, a filtr
    // po `trainee.id` dzieje się tutaj — bez N wywołań i bez drugiego żądania.
    let zadan = 0;
    let zapytanie = new URLSearchParams();
    const api = klient((req) => {
      zadan += 1;
      zapytanie = new URL(req.url).searchParams;
      return json(200, [
        TERMIN,
        { ...TERMIN, id: "c-2", trainee: { id: "t-2", displayName: "Jan Nowak" } },
      ]);
    });
    const nowISO = "2026-07-01T10:00:00.000Z";

    const wynik = await listOccurrencesForTrainer(api, "t-1", { nowISO });

    expect(zadan).toBe(1);
    expect(wynik.map((c) => c.id)).toEqual(["c-1"]);
    expect(zapytanie.get("from")).toBe(
      new Date(Date.parse(nowISO) - LIST_WINDOW_DAYS * DAY_MS).toISOString(),
    );
    expect(zapytanie.get("to")).toBe(
      new Date(Date.parse(nowISO) + LIST_WINDOW_DAYS * DAY_MS).toISOString(),
    );
  });
});

describe("loadUpcomingConsultations — najbliższy termin i oczekujące z jednej listy", () => {
  const nowISO = "2026-07-01T10:00:00.000Z";
  const lista = [
    {
      ...TERMIN,
      id: "c-0",
      status: "documented" as const,
      scheduledAt: "2026-07-05T16:00:00.000Z",
    },
    { ...TERMIN, id: "c-1", status: "planned" as const, scheduledAt: "2026-07-10T16:00:00.000Z" },
    { ...TERMIN, id: "c-2", status: "confirmed" as const, scheduledAt: "2026-07-08T16:00:00.000Z" },
  ];

  it("lista od teraz do roku w przód, najwcześniejszy ŻYWY jako `next`, `planned` jako `pending`", async () => {
    // Dwa dawne zapytania (`nextUpcomingForTrainee`, `countPendingForTrainee`)
    // to jedno wywołanie; udokumentowany nie jest „najbliższym”, choć jest pierwszy.
    let zadan = 0;
    let zapytanie = new URLSearchParams();
    const api = klient((req) => {
      zadan += 1;
      zapytanie = new URL(req.url).searchParams;
      return json(200, lista);
    });

    const wynik = await loadUpcomingConsultations(api, { nowISO });

    expect(zadan).toBe(1);
    expect(zapytanie.get("from")).toBe(nowISO);
    expect(zapytanie.get("to")).toBe(
      new Date(Date.parse(nowISO) + LIST_WINDOW_DAYS * DAY_MS).toISOString(),
    );
    expect(wynik.next?.id).toBe("c-2");
    expect(wynik.next?.scheduledAt).toBe("2026-07-08T18:00:00.000Z");
    expect(wynik.pending).toBe(1);
  });

  it("`traineeId` zawęża do pary — przegląd klienta u trenera", async () => {
    const api = klient(() =>
      json(200, [
        ...lista,
        {
          ...TERMIN,
          id: "c-9",
          scheduledAt: "2026-07-02T16:00:00.000Z",
          trainee: { id: "t-2", displayName: "Jan Nowak" },
        },
      ]),
    );

    const para = await loadUpcomingConsultations(api, { nowISO, traineeId: "t-1" });
    const wszyscy = await loadUpcomingConsultations(api, { nowISO });

    expect(para.next?.id).toBe("c-2");
    expect(para.pending).toBe(1);
    expect(wszyscy.next?.id).toBe("c-9");
    expect(wszyscy.pending).toBe(2);
  });

  it("brak żywych terminów daje `null` i zero", async () => {
    const api = klient(() => json(200, [lista[0]]));

    expect(await loadUpcomingConsultations(api, { nowISO })).toEqual({ next: null, pending: 0 });
  });
});

describe("getConsultationDetail — szczegół terminu", () => {
  it("szczegół spod `/v1/consultations/{id}` z czasem ściennym i punktami", async () => {
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, SZCZEGOL);
    });

    const wynik = await getConsultationDetail(api, "c-1");

    expect(sciezka).toBe("/v1/consultations/c-1");
    expect(wynik?.scheduledAt).toBe("2026-07-10T18:00:00.000Z");
    expect(wynik?.actionItems[0]?.body).toBe("Więcej mobilności");
  });

  it("`404` daje `null` — sygnatura z `| null` łapie brak zasobu", async () => {
    // Także termin kolegi u tego samego trenera: najemcą jest para, nie trener.
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono terminu."));

    expect(await getConsultationDetail(api, "c-x")).toBeNull();
  });
});

/**
 * Dokumentacja niesie DOKŁADNIE to, co przyjmuje `POST …/document` — od
 * 2026-09-21 (D-FE-5) nie ma tu już terminu, czasu trwania, odnośnika, tytułu
 * ani okresu. Pięć pól, które formularz zbierał, Zod walidował, a moduł
 * wyrzucał przed wysyłką.
 */
const FORMULARZ: ConsultationDocForm = {
  summary: "Notatki",
  items: [
    { body: "A", status: "open" },
    { body: "B", status: "resolved" },
  ],
};

/** Termin poza serią przyjmuje więcej — stąd osobny kształt. */
const FORMULARZ_NOWY: AdhocConsultationForm = {
  ...FORMULARZ,
  scheduledAt: "2026-07-10T18:00",
  durationMin: 45,
  meetingUrl: null,
};

describe("createAdhocConsultation — termin poza serią", () => {
  it("`planned`: ciało bez tytułu, okresu, podsumowania i punktów; termin jako moment", async () => {
    // `title` nie istnieje w `/v1`, okresu kontrakt nie zna, a podsumowanie
    // przy `planned` BE odrzuca — każde z tych pól w ciele to `400`/`409`.
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(201, SZCZEGOL);
    });

    const id = await createAdhocConsultation(api, {
      traineeId: "t-1",
      form: FORMULARZ_NOWY,
      documented: false,
    });

    expect(id).toBe("c-1");
    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/consultations");
    expect(cialo).toEqual({
      traineeId: "t-1",
      scheduledAt: "2026-07-10T16:00:00.000Z",
      durationMin: 45,
      meetingUrl: null,
      status: "planned",
    });
  });

  it("`documented`: podsumowanie i SAME treści punktów — statusy punktów nie mają pola w DTO", async () => {
    let cialo: unknown;
    const api = klient(async (req) => {
      cialo = await req.json();
      return json(201, SZCZEGOL);
    });

    await createAdhocConsultation(api, {
      traineeId: "t-1",
      form: FORMULARZ_NOWY,
      documented: true,
    });

    expect(cialo).toEqual({
      traineeId: "t-1",
      scheduledAt: "2026-07-10T16:00:00.000Z",
      durationMin: 45,
      meetingUrl: null,
      status: "documented",
      summary: "Notatki",
      actionItems: ["A", "B"],
    });
  });

  it("`404` (cudzy podopieczny) idzie do formularza jako ConsultationError, `500` leci jako ApiError", async () => {
    const cudzy = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono podopiecznego."));
    const awaria = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));
    const wejscie = { traineeId: "t-x", form: FORMULARZ_NOWY, documented: false };

    const odmowaPary = await createAdhocConsultation(cudzy, wejscie).catch((e) => e);
    const bladAwarii = await createAdhocConsultation(awaria, wejscie).catch((e) => e);

    expect(odmowaPary).toBeInstanceOf(ConsultationError);
    expect((odmowaPary as ConsultationError).userMessage).toBe("Nie znaleziono podopiecznego.");
    expect(bladAwarii).toBeInstanceOf(ApiError);
    expect(bladAwarii).not.toBeInstanceOf(ConsultationError);
  });
});

describe("respondToOccurrence — reakcja podopiecznego", () => {
  it("`POST …/respond` z `response`; notatka w ciele tylko wtedy, gdy jest", async () => {
    const ciala: unknown[] = [];
    let sciezka = "";
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      ciala.push(await req.json());
      return json(200, SZCZEGOL);
    });

    await respondToOccurrence(api, { consultationId: "c-1", action: "confirm" });
    await respondToOccurrence(api, {
      consultationId: "c-1",
      action: "request_change",
      note: "Wolę rano",
    });

    expect(sciezka).toBe("/v1/consultations/c-1/respond");
    expect(ciala).toEqual([
      { response: "confirm" },
      { response: "request_change", note: "Wolę rano" },
    ]);
  });

  it("`409` (niedozwolone przejście) zamienia na ConsultationError z komunikatem BE", async () => {
    // Guard `canTraineeAct` przestał stać w module — tabela przejść należy do BE.
    const api = klient(() =>
      odmowa(409, "CONSULTATION_TRANSITION_NOT_ALLOWED", "Tego terminu nie można już zmienić."),
    );

    const blad = await respondToOccurrence(api, { consultationId: "c-1", action: "decline" }).catch(
      (e) => e,
    );

    expect(blad).toBeInstanceOf(ConsultationError);
    expect((blad as ConsultationError).userMessage).toBe("Tego terminu nie można już zmienić.");
  });
});

describe("rescheduleOccurrence — nowy moment", () => {
  it("czas ścienny z formularza idzie jako moment; czas trwania tylko, gdy podany", async () => {
    const ciala: unknown[] = [];
    let sciezka = "";
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      ciala.push(await req.json());
      return json(200, SZCZEGOL);
    });

    await rescheduleOccurrence(api, {
      consultationId: "c-1",
      scheduledAtLocal: "2026-07-10T19:00",
    });
    await rescheduleOccurrence(api, {
      consultationId: "c-1",
      scheduledAtLocal: "2026-07-10T19:00",
      durationMin: 60,
    });

    expect(sciezka).toBe("/v1/consultations/c-1/reschedule");
    expect(ciala).toEqual([
      { scheduledAt: "2026-07-10T17:00:00.000Z" },
      { scheduledAt: "2026-07-10T17:00:00.000Z", durationMin: 60 },
    ]);
  });

  it("niepoprawna wartość pola nie wychodzi z modułu — ConsultationError bez żądania", async () => {
    // Ta trasa nie ma Zoda przed modułem; `new Date("")` rzuciłoby dopiero przy
    // serializacji, ekranem błędu zamiast zdaniem w formularzu.
    let zadan = 0;
    const api = klient(() => {
      zadan += 1;
      return json(200, SZCZEGOL);
    });

    const blad = await rescheduleOccurrence(api, {
      consultationId: "c-1",
      scheduledAtLocal: "",
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(ConsultationError);
    expect(zadan).toBe(0);
  });
});

describe("cancelOccurrence / deleteConsultation", () => {
  it("odwołanie to `POST …/cancel`, usunięcie to `DELETE /v1/consultations/{id}`", async () => {
    const wywolania: string[] = [];
    const api = klient((req) => {
      wywolania.push(`${req.method} ${new URL(req.url).pathname}`);
      return req.method === "DELETE" ? pusto(204) : json(200, SZCZEGOL);
    });

    await cancelOccurrence(api, "c-1");
    await deleteConsultation(api, "c-1");

    expect(wywolania).toEqual([
      "POST /v1/consultations/c-1/cancel",
      "DELETE /v1/consultations/c-1",
    ]);
  });

  it("`409` przy odwołaniu udokumentowanego i `404` przy usuwaniu idą do paska akcji jako ConsultationError", async () => {
    const udokumentowany = klient(() =>
      odmowa(409, "CONSULTATION_DOCUMENTED", "Udokumentowanego terminu nie można odwołać."),
    );
    const cudzy = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono terminu."));

    const bladOdwolania = await cancelOccurrence(udokumentowany, "c-1").catch((e) => e);
    const bladUsuwania = await deleteConsultation(cudzy, "c-x").catch((e) => e);

    expect(bladOdwolania).toBeInstanceOf(ConsultationError);
    expect((bladOdwolania as ConsultationError).userMessage).toBe(
      "Udokumentowanego terminu nie można odwołać.",
    );
    expect(bladUsuwania).toBeInstanceOf(ConsultationError);
    expect((bladUsuwania as ConsultationError).userMessage).toBe("Nie znaleziono terminu.");
  });
});

describe("documentConsultation — podsumowanie i punkty", () => {
  it("`POST …/document` z podsumowaniem i treściami punktów — bez terminu, tytułu, okresu i statusów", async () => {
    // DTO dokumentacji niesie wyłącznie `summary` i `actionItems: string[]`;
    // reszta pól formularza nie ma dokąd pójść (luki S3 w raporcie).
    let sciezka = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      cialo = await req.json();
      return json(200, SZCZEGOL);
    });

    await documentConsultation(api, { consultationId: "c-1", form: FORMULARZ });

    expect(sciezka).toBe("/v1/consultations/c-1/document");
    expect(cialo).toEqual({ summary: "Notatki", actionItems: ["A", "B"] });
  });

  it("`409` (odwołany) zamienia na ConsultationError", async () => {
    const api = klient(() =>
      odmowa(409, "CONSULTATION_CANCELLED", "Nie można udokumentować odwołanego terminu."),
    );

    const blad = await documentConsultation(api, { consultationId: "c-1", form: FORMULARZ }).catch(
      (e) => e,
    );

    expect(blad).toBeInstanceOf(ConsultationError);
  });
});

describe("setActionItemStatus — punkt do poprawy", () => {
  it("`PATCH /v1/consultations/{id}/action-items/{itemId}` ze statusem", async () => {
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(200, SZCZEGOL);
    });

    await setActionItemStatus(api, { consultationId: "c-1", itemId: "i-1", status: "resolved" });

    expect(metoda).toBe("PATCH");
    expect(sciezka).toBe("/v1/consultations/c-1/action-items/i-1");
    expect(cialo).toEqual({ status: "resolved" });
  });

  it("`404` (cudzy punkt) zamienia na ConsultationError", async () => {
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono punktu."));

    const blad = await setActionItemStatus(api, {
      consultationId: "c-1",
      itemId: "i-x",
      status: "open",
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(ConsultationError);
  });
});

describe("runConsultationSync — uzupełnienie zaległości w kalendarzu", () => {
  it("`POST /v1/trainees/{id}/consultation-sync`; `connected: false` to dane, nie błąd", async () => {
    // Wyłączona integracja i trener bez połączenia wyglądają tak samo (`200`),
    // a trasa ma o tym powiedzieć wprost zamiast raportować „0 z 0”.
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, { connected: false, attempted: 0, synced: 0 });
    });

    const wynik = await runConsultationSync(api, "t-1");

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/trainees/t-1/consultation-sync");
    expect(wynik).toEqual({ connected: false, attempted: 0, synced: 0 });
  });

  it("`409` (przebieg już trwa) to ConsultationError, `500` leci jako ApiError", async () => {
    const trwa = klient(() =>
      odmowa(409, "CALENDAR_SYNC_IN_PROGRESS", "Synchronizacja tej pary już trwa."),
    );
    const awaria = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const bladZamka = await runConsultationSync(trwa, "t-1").catch((e) => e);
    const bladAwarii = await runConsultationSync(awaria, "t-1").catch((e) => e);

    expect(bladZamka).toBeInstanceOf(ConsultationError);
    expect((bladZamka as ConsultationError).userMessage).toBe("Synchronizacja tej pary już trwa.");
    expect(bladAwarii).toBeInstanceOf(ApiError);
  });
});

describe("canTraineeRespond — akcje z listy BE, nie ze statusu", () => {
  it("prawda, gdy BE wylicza którąkolwiek z akcji podopiecznego; fałsz przy pustej liście", () => {
    // Tabela przejść należy do BE: `confirmed` nie ma już akcji podopiecznego,
    // choć dawny guard `canTraineeAct` je dopuszczał.
    expect(canTraineeRespond({ allowedActions: ["decline"] })).toBe(true);
    expect(canTraineeRespond({ allowedActions: ["reschedule", "cancel"] })).toBe(false);
    expect(canTraineeRespond({ allowedActions: [] })).toBe(false);
  });
});
