// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env", () => ({
  getEnv: () => ({ API_URL: "http://be.test" }),
}));

import { RouterContextProvider } from "react-router";
import { createApiClient } from "~/lib/api/client";
import { apiContext } from "~/lib/api/context";
import { action, loader } from "./integracje.google";

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

/**
 * Atrapa rozróżniająca DWIE trasy, które loader czyta od 2026-09-25.
 *
 * Bez rozróżnienia atrapa oddawałaby obiekt połączenia także na
 * `GET /v1/calendar/sync-failures`, a `syncFailures` przestałby być tablicą
 * **w sposób niewidoczny** dla asercji o połączeniu — ekran wywróciłby się
 * dopiero w przeglądarce, na `pozycje.length`.
 */
function odpowiedzi(o: { polaczenie: unknown; zaleglosci?: unknown }) {
  return (req: Request): Response => {
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    return new URL(req.url).pathname.includes("/sync-failures")
      ? json(o.zaleglosci ?? [])
      : json(o.polaczenie);
  };
}

const POLACZONE = { status: "connected", provider: "google", accountLabel: "a@b.pl" };

function formularz(intent: string, pola: Record<string, string> = {}): Request {
  const body = new URLSearchParams({ intent, ...pola });
  return new Request("https://fe.test/trener/integracje/google", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

describe("integracje.google — ekran na kontrakcie", () => {
  it("loader oddaje stan połączenia z kontraktu", async () => {
    const context = scenariusz(odpowiedzi({ polaczenie: POLACZONE }));

    const wynik = (await loader({
      request: new Request("https://fe.test/trener/integracje/google"),
      params: {},
      context,
    } as never)) as { connection: { accountLabel: string | null }; syncFailures: unknown[] };

    expect(wynik.connection.accountLabel).toBe("a@b.pl");
    // Zaległości jadą tym samym loaderem i MUSZĄ być tablicą także wtedy, gdy
    // nie ma ani jednej — ekran liczy na nich `length`.
    expect(wynik.syncFailures).toEqual([]);
  });

  it("loader oddaje zaległości OBOK połączenia, nie zamiast niego", async () => {
    // Dwa niezależne odczyty w jednym loaderze. Lista NIE zależy od stanu
    // połączenia — czyta outbox po trenerze — więc trener rozłączony wciąż
    // musi zobaczyć, co po sobie zostawił (D-24: po błędzie `gone` rozłączenie
    // jest jedyną drogą wyjścia, czyli ląduje tu z największą zaległością).
    const context = scenariusz(
      odpowiedzi({
        polaczenie: { status: "disconnected", provider: "google", accountLabel: null },
        zaleglosci: [
          {
            id: "z-1",
            kind: "cancel",
            scheduledAt: "2026-09-24T10:00:00.000Z",
            failedAt: "2026-09-24T08:00:00.000Z",
            traineeName: "Ala",
          },
        ],
      }),
    );

    const wynik = (await loader({
      request: new Request("https://fe.test/trener/integracje/google"),
      params: {},
      context,
    } as never)) as { connection: { status: string }; syncFailures: { id: string }[] };

    expect(wynik.connection.status).toBe("disconnected");
    expect(wynik.syncFailures.map((z) => z.id)).toEqual(["z-1"]);
  });

  it("loader oddaje stan `broken` nietknięty — to jest połączenie, nie awaria", async () => {
    // Kontrakt zna trzy stany: `disconnected`, `connected`, `broken`. Ekran
    // liczy połączenie przez `status !== "disconnected"`, więc `broken`
    // pokazuje ten sam ekran co `connected` — z przyciskiem „Rozłącz", bo to
    // JEDYNA droga wyjścia z zepsutego połączenia (ten sam podział, co przed
    // integracją z kontraktem, gdzie o połączeniu decydowała sama obecność
    // wiersza). Bez tego przypadku zmiana warunku na `=== "connected"`
    // przeszłaby cały ten plik i zostawiła trenera z zepsutym połączeniem
    // bez żadnego sposobu, żeby je usunąć.
    const context = scenariusz(
      odpowiedzi({
        polaczenie: { status: "broken", provider: "google", accountLabel: "a@b.pl" },
      }),
    );

    const wynik = (await loader({
      request: new Request("https://fe.test/trener/integracje/google"),
      params: {},
      context,
    } as never)) as { connection: { status: string } };

    expect(wynik.connection.status).toBe("broken");
  });

  it("Połącz przekierowuje na zgodę i PRZEKAZUJE oba ciastka", async () => {
    // Bez tego przekazania ciastko z nonce'em zostaje u serwera FE, a każda
    // zgoda kończy się `reason=state` — objawem nieodróżnialnym od poprawnie
    // zadziałanej bramki CSRF. To jest jedyny test, który tego pilnuje.
    const context = scenariusz(
      () =>
        new Response(JSON.stringify({ url: "https://accounts.google.test/auth?state=S" }), {
          status: 200,
          headers: [
            ["content-type", "application/json"],
            ["set-cookie", "kal_calendar_nonce=N; Path=/v1/calendar/connection/callback"],
            ["set-cookie", "drugie=2"],
          ],
        }),
    );

    const res = (await action({
      request: formularz("connect"),
      params: {},
      context,
    } as never)) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://accounts.google.test/auth?state=S");
    expect(res.headers.getSetCookie()).toEqual([
      "kal_calendar_nonce=N; Path=/v1/calendar/connection/callback",
      "drugie=2",
    ]);
  });

  it("wyłączona integracja wraca komunikatem z kontraktu, nie granicą błędu", async () => {
    const context = scenariusz(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "CALENDAR_NOT_CONFIGURED",
              message: "Integracja kalendarza nie jest włączona na tym serwerze.",
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );

    const wynik = (await action({
      request: formularz("connect"),
      params: {},
      context,
    } as never)) as { error: string };

    expect(wynik.error).toContain("nie jest włączona");
  });

  it("Rozłącz woła DELETE i wraca komunikatem", async () => {
    let metoda = "";
    const context = scenariusz((req) => {
      metoda = req.method;
      return new Response(null, { status: 204 });
    });

    const wynik = (await action({
      request: formularz("disconnect"),
      params: {},
      context,
    } as never)) as { success: string };

    expect(metoda).toBe("DELETE");
    expect(wynik.success).toContain("odłączone");
  });

  it("Ponów trafia pod adres TEJ zaległości i nie obiecuje dostarczenia", async () => {
    let trafiony = "";
    let metoda = "";
    const context = scenariusz((req) => {
      trafiony = new URL(req.url).pathname;
      metoda = req.method;
      return new Response(null, { status: 204 });
    });

    const wynik = (await action({
      request: formularz("retry", { id: "z-1" }),
      params: {},
      context,
    } as never)) as { success: string };

    expect(metoda).toBe("POST");
    expect(trafiony).toBe("/v1/calendar/sync-failures/z-1/retry");
    // Kontrakt oddaje `204`, bo dostarczenie jest ASYNCHRONICZNE. Komunikat
    // mówiący „gotowe" kłamałby dokładnie w tym miejscu — pozycja znika
    // z listy, bo wróciła do kolejki, a nie dlatego, że kalendarz ją przyjął.
    expect(wynik.success).not.toMatch(/gotowe|dostarczon|zsynchronizowan/i);
    expect(wynik.success).toMatch(/wróci/i);
  });

  it("ponowienie bez wskazania zaległości nie idzie do backendu", async () => {
    let wolano = false;
    const context = scenariusz(() => {
      wolano = true;
      return new Response(null, { status: 204 });
    });

    const wynik = (await action({
      request: formularz("retry"),
      params: {},
      context,
    } as never)) as { error: string };

    expect(wolano).toBe(false);
    expect(wynik.error).toContain("Brak wskazania");
  });

  it("404 przy ponowieniu NIE wywraca ekranu", async () => {
    // Podwójne kliknięcie albo nieodświeżona lista. Bez tej gałęzi
    // `toRouteResponse` wyrzuciłby trenera do granicy błędu za czynność,
    // która w najgorszym razie była zbędna.
    const context = scenariusz(
      () =>
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Nie znaleziono." } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );

    const wynik = (await action({
      request: formularz("retry", { id: "z-1" }),
      params: {},
      context,
    } as never)) as { error: string };

    expect(wynik.error).toContain("już nie ma na liście");
  });
});
