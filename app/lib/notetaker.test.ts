import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { disableNotetaker, enableNotetaker, getNotetakerStatus } from "./notetaker";

function klient(reguly: (req: Request) => Response) {
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

describe("notetaker — integracja AI Notetaker na kontrakcie", () => {
  it("stan integracji przychodzi z kontraktu bez identyfikatora najemcy", async () => {
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, { enabled: false });
    });

    const wynik = await getNotetakerStatus(api);

    expect(sciezka).toBe("/v1/me/integrations/notetaker");
    // Wszystkie trzy operacje (GET/PUT/DELETE) siedzą pod TYM SAMYM adresem —
    // bez tej asercji podmiana `notetakerControllerGet` na `…Enable` w
    // `getNotetakerStatus` (ten sam kształt wywołania, trzy linie od siebie
    // w `notetaker.ts`) przechodziłaby ten test na zielono, mimo że loader
    // trasy woła tę funkcję przy KAŻDYM wejściu na ekran.
    expect(metoda).toBe("GET");
    expect(wynik).toEqual({ enabled: false });
  });

  it("włączenie idzie metodą PUT i oddaje nowy stan", async () => {
    let metoda = "";
    let sciezka = "";
    const api = klient((req) => {
      metoda = req.method;
      sciezka = new URL(req.url).pathname;
      return json(200, { enabled: true });
    });

    const wynik = await enableNotetaker(api);

    expect(metoda).toBe("PUT");
    expect(sciezka).toBe("/v1/me/integrations/notetaker");
    expect(wynik).toEqual({ enabled: true });
  });

  it("odmowa włączenia bez kalendarza wraca jako rozpoznany błąd", async () => {
    // Backend odmawia `409 NOTETAKER_REQUIRES_CALENDAR`, gdy trener nie ma
    // podłączonego kalendarza produkującego odnośnik do spotkania — notetaker
    // nie ma pod jaki adres wysłać bota. Trasa rozgałęzia się po `error.code`,
    // więc moduł ma go przepuścić nierozpakowanego, nie połknąć w generyczny wyjątek.
    const api = klient(() =>
      json(409, {
        error: {
          code: "NOTETAKER_REQUIRES_CALENDAR",
          message: "Podłącz kalendarz, zanim włączysz AI Notetaker.",
        },
      }),
    );

    await expect(enableNotetaker(api)).rejects.toMatchObject({
      code: "NOTETAKER_REQUIRES_CALENDAR",
    });
  });

  it("wyłączenie idzie metodą DELETE", async () => {
    let metoda = "";
    let sciezka = "";
    const api = klient((req) => {
      metoda = req.method;
      sciezka = new URL(req.url).pathname;
      return new Response(null, { status: 204 });
    });

    await disableNotetaker(api);

    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/me/integrations/notetaker");
  });
});
