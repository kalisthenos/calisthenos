import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  type ConsultationScheduleView,
  ScheduleError,
  deactivateSchedule,
  defaultTitle,
  getActiveSchedule,
  upsertSchedule,
} from "./consultation-schedules";
import type { ScheduleForm } from "./consultation-types";

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

function odmowa(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, details } });
}

const HARMONOGRAM: ConsultationScheduleView = {
  id: "s-1",
  traineeId: "t-1",
  cadence: "weekly",
  weekday: 3,
  dayOfMonth: null,
  timeOfDay: "18:00",
  durationMin: 45,
  startsOn: "2026-07-01",
  defaultMeetingUrl: null,
};

describe("getActiveSchedule — aktywny cykl pary", () => {
  it("`GET /v1/trainees/{id}/consultation-schedule` rozpakowuje `schedule`", async () => {
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, { schedule: HARMONOGRAM });
    });

    const wynik = await getActiveSchedule(api, "t-1");

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/trainees/t-1/consultation-schedule");
    expect(wynik).toEqual(HARMONOGRAM);
  });

  it("para bez cyklu to `{ schedule: null }` ze statusem `200` — `null` bez `orNull`", async () => {
    const api = klient(() => json(200, { schedule: null }));

    expect(await getActiveSchedule(api, "t-1")).toBeNull();
  });

  it("`404` (cudzy podopieczny) NIE staje się `null` — leci jako ApiError", async () => {
    // Odpowiedź jest opakowana właśnie po to, żeby „nie ma cyklu” i „nie twój
    // podopieczny” były różnymi rzeczami; zlanie ich w `null` cofnęłoby tę decyzję.
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono podopiecznego."));

    const blad = await getActiveSchedule(api, "t-x").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
  });
});

const TYGODNIOWY: ScheduleForm = {
  cadence: "weekly",
  weekday: 3,
  dayOfMonth: null,
  timeOfDay: "18:00",
  durationMin: 45,
  startsOn: "2026-07-01",
  defaultMeetingUrl: null,
};

describe("upsertSchedule — zapis cyklu", () => {
  it("`PUT` z ciałem pole po polu; przy cyklu tygodniowym bez klucza `dayOfMonth`", async () => {
    // DTO ma `weekday?`/`dayOfMonth?` bez `null` — klucz z `null` to pole spoza
    // DTO, czyli `400`. Formularz niesie oba, więc moduł wybiera właściwy.
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(200, HARMONOGRAM);
    });

    const wynik = await upsertSchedule(api, { traineeId: "t-1", form: TYGODNIOWY });

    expect(metoda).toBe("PUT");
    expect(sciezka).toBe("/v1/trainees/t-1/consultation-schedule");
    expect(cialo).toEqual({
      cadence: "weekly",
      weekday: 3,
      timeOfDay: "18:00",
      durationMin: 45,
      startsOn: "2026-07-01",
      defaultMeetingUrl: null,
    });
    expect(wynik).toEqual(HARMONOGRAM);
  });

  it("przy cyklu miesięcznym idzie `dayOfMonth`, a `weekday` z formularza zostaje w domu", async () => {
    let cialo: unknown;
    const api = klient(async (req) => {
      cialo = await req.json();
      return json(200, { ...HARMONOGRAM, cadence: "monthly", weekday: null, dayOfMonth: 15 });
    });

    await upsertSchedule(api, {
      traineeId: "t-1",
      form: {
        ...TYGODNIOWY,
        cadence: "monthly",
        dayOfMonth: 15,
        defaultMeetingUrl: "https://meet.example/x",
      },
    });

    expect(cialo).toEqual({
      cadence: "monthly",
      dayOfMonth: 15,
      timeOfDay: "18:00",
      durationMin: 45,
      startsOn: "2026-07-01",
      defaultMeetingUrl: "https://meet.example/x",
    });
  });

  it("`400` (walidacja BE ostrzejsza niż Zod) idzie do paska akcji jako ScheduleError, `500` leci jako ApiError", async () => {
    const zaDlugi = klient(() =>
      odmowa(400, "VALIDATION_FAILED", "Czas trwania musi mieścić się w 5–480 minut."),
    );
    const awaria = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const bladWalidacji = await upsertSchedule(zaDlugi, {
      traineeId: "t-1",
      form: TYGODNIOWY,
    }).catch((e) => e);
    const bladAwarii = await upsertSchedule(awaria, { traineeId: "t-1", form: TYGODNIOWY }).catch(
      (e) => e,
    );

    expect(bladWalidacji).toBeInstanceOf(ScheduleError);
    expect((bladWalidacji as ScheduleError).userMessage).toBe(
      "Czas trwania musi mieścić się w 5–480 minut.",
    );
    expect(bladAwarii).toBeInstanceOf(ApiError);
    expect(bladAwarii).not.toBeInstanceOf(ScheduleError);
  });
});

describe("deactivateSchedule — wyłączenie cyklu", () => {
  it("`DELETE /v1/trainees/{id}/consultation-schedule`, `204` bez ciała", async () => {
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return pusto(204);
    });

    await deactivateSchedule(api, "t-1");

    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/trainees/t-1/consultation-schedule");
  });

  it("`404` (cudzy podopieczny) zamienia na ScheduleError z komunikatem BE", async () => {
    const api = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono podopiecznego."));

    const blad = await deactivateSchedule(api, "t-x").catch((e) => e);

    expect(blad).toBeInstanceOf(ScheduleError);
    expect((blad as ScheduleError).userMessage).toBe("Nie znaleziono podopiecznego.");
  });
});

describe("defaultTitle — nagłówek terminu bez tytułu z kontraktu", () => {
  it("składa datę z czasu ściennego w konwencji FE", () => {
    expect(defaultTitle("2026-06-11T18:00:00.000Z")).toBe("Konsultacja — 11.06.2026");
    expect(defaultTitle("2026-01-05T09:30:00.000Z")).toBe("Konsultacja — 05.01.2026");
  });
});
