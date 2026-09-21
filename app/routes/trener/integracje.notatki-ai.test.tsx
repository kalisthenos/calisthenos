import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { createApiClient } from "~/lib/api/client";
import { apiContext } from "~/lib/api/context";
import { action, loader } from "./integracje.notatki-ai";

/**
 * Ekran włącznika notatek AI (`integracje.notatki-ai.tsx`, Zadania 15/17) —
 * przy przeglądzie tej gałęzi (W2, `fe-review.md`) gałąź WŁĄCZANIA nie miała
 * w FE żadnego dowodu, ani e2e, ani jednostkowego: `notatki-ai.spec.ts`
 * dowodzi wyłącznie trenera BEZ kalendarza (jedyny stan, jaki gwarantuje
 * seeder), a tego pliku nie było. Wzorzec: `integracje.google.test.tsx`
 * w tym samym katalogu — `scenariusz()`/`formularz()` podstawiają `fetch`,
 * bez przeglądarki i bez bazy.
 *
 * Cztery gałęzie o realnym skutku dla trenera, każda z własnym testem niżej:
 * `enable` → `PUT`, `disable` → `DELETE`, `409 NOTETAKER_REQUIRES_CALENDAR`
 * → dane akcji (`{ error }`) zamiast granicy błędu, i KONTRAST — inny błąd
 * NIE dostaje tego samego traktowania (mapowanie jest po kodzie, nie po
 * samym `catch`). Loader dostaje trzy testy dla trzech stanów kalendarza
 * (`connected`/`disconnected`/`broken`), którymi żywi się `canEnable`
 * i `calendarBlocked` w komponencie — ten plik NIE renderuje komponentu
 * (ten katalog nie ma `@testing-library/react`, patrz `ai-notes-panel.
 * test.tsx`), więc sprawdza dane u ŹRÓDŁA, tym samym zakresem co precedens
 * (`integracje.google.test.tsx:63–70` sprawdza `broken` tak samo — status
 * przechodzi NIETKNIĘTY, nie sam derywowany warunek w komponencie).
 */

const TRENER = {
  id: "u-1",
  email: "t@example.pl",
  displayName: "Trener",
  roles: ["trainer"] as const,
  trainerId: null,
  trainerName: null,
};

function scenariusz(odpowiedz: (req: Request) => Response) {
  const context = new RouterContextProvider();
  context.set(apiContext, {
    api: createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: (async (req: Request) => odpowiedz(req)) as unknown as typeof fetch,
    }),
    user: TRENER as never,
  });
  return context;
}

function formularz(intent: string): Request {
  const body = new URLSearchParams({ intent });
  return new Request("https://fe.test/trener/integracje/notatki-ai", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Loader woła DWA zasoby pod jednym wspólnym `fetch` (`Promise.all` w
 * `integracje.notatki-ai.tsx`) — atrapa rozdziela je ścieżką, żeby
 * przypadkowa zamiana pozycji w `Promise.all` albo pomylenie zasobu nie
 * prześlizgnęła się przez atrapę, która odpowiada tym samym na wszystko.
 */
function odpowiedzDlaLoadera(
  notetakerEnabled: boolean,
  calendarStatus: "connected" | "disconnected" | "broken",
) {
  return (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === "/v1/me/integrations/notetaker") return json(200, { enabled: notetakerEnabled });
    if (path === "/v1/calendar/connection") {
      return json(200, {
        status: calendarStatus,
        provider: "google",
        accountLabel: calendarStatus === "disconnected" ? null : "a@b.pl",
      });
    }
    throw new Error(`scenariusz nie obsługuje ścieżki ${path}`);
  };
}

describe("integracje.notatki-ai — loader: dwa zasoby, trzy stany kalendarza", () => {
  it("oddaje stan notetakera I kalendarza z jednego wywołania (Promise.all)", async () => {
    const context = scenariusz(odpowiedzDlaLoadera(true, "connected"));

    const wynik = (await loader({
      request: new Request("https://fe.test/trener/integracje/notatki-ai"),
      params: {},
      context,
    } as never)) as { notetaker: { enabled: boolean }; calendar: { status: string } };

    expect(wynik.notetaker.enabled).toBe(true);
    expect(wynik.calendar.status).toBe("connected");
  });

  it("kalendarz `disconnected` przechodzi nietknięty — stan, w którym `canEnable` musi być fałszywe", async () => {
    const context = scenariusz(odpowiedzDlaLoadera(false, "disconnected"));

    const wynik = (await loader({
      request: new Request("https://fe.test/trener/integracje/notatki-ai"),
      params: {},
      context,
    } as never)) as { calendar: { status: string } };

    expect(wynik.calendar.status).toBe("disconnected");
  });

  it("kalendarz `broken` NIE zlewa się z `disconnected` — dwie różne czynności naprawcze", async () => {
    // Ten sam przypadek co `integracje.google.test.tsx:63–70`: `broken` to
    // POŁĄCZENIE, tyle że zepsute — `CALENDAR_BLOCK_MESSAGES` w
    // `integracje.notatki-ai.tsx` ma dla niego INNY komunikat niż dla
    // `disconnected`. Gdyby loader (albo warstwa pod nim) zwinął `broken` do
    // `disconnected`, trener czytałby złą instrukcję naprawczą.
    const context = scenariusz(odpowiedzDlaLoadera(false, "broken"));

    const wynik = (await loader({
      request: new Request("https://fe.test/trener/integracje/notatki-ai"),
      params: {},
      context,
    } as never)) as { calendar: { status: string } };

    expect(wynik.calendar.status).toBe("broken");
  });
});

describe("integracje.notatki-ai — action: enable/disable/409", () => {
  it("Włącz woła PUT i wraca komunikatem sukcesu", async () => {
    // Scenariusz W2 najostrzejszy: zamiana miejscami gałęzi `enable`/`disable`
    // (trzy linie od siebie w akcji) dałaby zielony komunikat przy WCIĄŻ
    // włączonej integracji. Asercja metody to jedyna rzecz, która to łapie —
    // sam komunikat sukcesu przeszedłby identycznie po obu stronach zamiany.
    let metoda = "";
    const context = scenariusz((req) => {
      metoda = req.method;
      return json(200, { enabled: true });
    });

    const wynik = (await action({
      request: formularz("enable"),
      params: {},
      context,
    } as never)) as { success: string };

    expect(metoda).toBe("PUT");
    expect(wynik.success).toBe("Notatki AI włączone.");
  });

  it("Wyłącz woła DELETE i wraca komunikatem sukcesu", async () => {
    let metoda = "";
    const context = scenariusz((req) => {
      metoda = req.method;
      return new Response(null, { status: 204 });
    });

    const wynik = (await action({
      request: formularz("disable"),
      params: {},
      context,
    } as never)) as { success: string };

    expect(metoda).toBe("DELETE");
    expect(wynik.success).toBe("Notatki AI wyłączone.");
  });

  it("409 NOTETAKER_REQUIRES_CALENDAR wraca DANYMI (`{ error }`), nie granicą błędu", async () => {
    const context = scenariusz(() =>
      json(409, {
        error: {
          code: "NOTETAKER_REQUIRES_CALENDAR",
          message: "Podłącz kalendarz, zanim włączysz AI Notetaker.",
        },
      }),
    );

    const wynik = (await action({
      request: formularz("enable"),
      params: {},
      context,
    } as never)) as { error: string };

    expect(wynik.error).toBe("Podłącz kalendarz, zanim włączysz AI Notetaker.");
  });

  it("błąd BEZ kodu NOTETAKER_REQUIRES_CALENDAR leci na granicę błędu (Response RZUCONY, nie zwrócony)", async () => {
    // Kontrast dla testu wyżej: mapowanie w akcji jest po KODZIE błędu, nie
    // po samym `catch`. Gdyby ktoś zamienił `e.code === "NOTETAKER_REQUIRES_
    // CALENDAR"` na gołe `e instanceof ApiError`, TEN test złapałby to jako
    // pierwszy — dostałby zwrócone dane zamiast rzuconego `Response`.
    const context = scenariusz(() =>
      json(500, { error: { code: "INTERNAL", message: "Błąd serwera." } }),
    );

    const wynik = await action({
      request: formularz("enable"),
      params: {},
      context,
    } as never).catch((e) => e);

    expect(wynik).toBeInstanceOf(Response);
    expect((wynik as Response).status).toBe(500);
  });
});
