// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env", () => ({
  getEnv: () => ({ API_URL: "http://be.test" }),
}));

// Strefa PROCESU testu ma różnić się od strefy aplikacji (Europe/Warsaw), i to PRZED załadowaniem
// trasy: formatter daty powstaje przy ładowaniu modułu, a `Intl.DateTimeFormat` bez jawnej strefy
// zapamiętuje strefę procesu z chwili budowy. Na maszynie, która sama stoi w Warszawie, test daty
// zostawałby zielony także po usunięciu przypięcia strefy z trasy. `vi.hoisted` biegnie przed
// importami. Że Node respektuje zmianę `process.env.TZ` w locie, nie zakładamy po cichu: pilnuje
// tego przypadek „fixture rozróżnia strefy” niżej.
vi.hoisted(() => {
  vi.stubEnv("TZ", "UTC");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  StaticRouterProvider,
  createStaticHandler,
  createStaticRouter,
} from "react-router";
import { createApiClient } from "~/lib/api/client";
import { type AuthUser, apiContext } from "~/lib/api/context";
import { ApiError } from "~/lib/api/errors";
import Dokument, { loader, meta } from "./dokumenty.$klucz.$wersja";

const TRENER: AuthUser = {
  id: "p-1",
  email: "anna@x.pl",
  displayName: "Anna",
  roles: ["trainer"],
  trainerId: null,
  trainerName: null,
};

const PODOPIECZNY: AuthUser = { ...TRENER, id: "p-2", displayName: "Ola", roles: ["trainee"] };

function kontekst(reguly: (req: Request) => Response | Promise<Response>, user?: AuthUser | null) {
  const context = new RouterContextProvider();
  context.set(apiContext, {
    api: createApiClient({
      baseUrl: "http://be.test",
      getToken: () => undefined,
      fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
    }),
    user: user ?? null,
  });
  return context;
}

function json(status: number, cialo: unknown, naglowki: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json", ...naglowki },
  });
}

// Koperta błędu BE: `{ error: { code, message } }`.
function bladBE(status: number, code: string, naglowki: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: "Komunikat z BE." } }, naglowki);
}

const DOKUMENT = {
  key: "terms-of-service",
  versionNumber: 2,
  title: "Regulamin",
  content: "Treść **dokumentu** w Markdownie.",
  // 22:30 UTC to już 1 października w Warszawie (CEST): data na stronie idzie za strefą aplikacji,
  // nie za strefą serwera, więc UTC i Warszawa wskazują tu różne dni. Proces testu stoi w UTC
  // (`TZ` na górze pliku), więc o wyniku rozstrzyga przypięcie strefy w trasie, nie położenie maszyny.
  effectiveFrom: "2026-09-30T22:30:00.000Z",
};

// BE, które odpowiada (domyślnie dokumentem) i zapisuje, o co je zapytano — do asercji na
// ścieżce żądania i do licznika wywołań.
function atrapaBE(odpowiedz: () => Response = () => json(200, DOKUMENT), user?: AuthUser | null) {
  const zadania: string[] = [];
  const context = kontekst((req) => {
    zadania.push(`${req.method} ${new URL(req.url).pathname}`);
    return odpowiedz();
  }, user);
  return { context, zadania };
}

function argumenty(context: RouterContextProvider, klucz: string, wersja: string) {
  return {
    request: new Request(`https://fe.test/dokumenty/${klucz}/${wersja}`),
    params: { klucz, wersja },
    context,
  };
}

describe("dokumenty/:klucz/:wersja — loader", () => {
  it("200: oddaje dokument z BE nietknięty, jednym GET-em na ścieżkę z kontraktu", async () => {
    const { context, zadania } = atrapaBE();

    const dane = await loader(argumenty(context, "terms-of-service", "2") as never);

    expect(dane).toEqual(DOKUMENT);
    expect(zadania).toEqual(["GET /v1/consents/terms-of-service/versions/2"]);
  });

  // Klucz jest dla trasy nieprzejrzysty: to nazwa dokumentu z adresu, a o jej istnieniu rozstrzyga
  // BE. Trasa niczego w nim nie przycina, nie zmienia wielkości liter ani nie zamienia miejscami
  // z numerem wersji — ostatni wiersz ma wielkie litery, kropkę i podkreślnik właśnie po to.
  const KLUCZE: [string, string][] = [
    ["terms-of-service", "1"],
    ["trainer-dpa", "3"],
    ["Polityka_Prywatnosci.v2", "12"],
  ];

  it.each(KLUCZE)(
    "klucz „%s” i wersja %s trafiają do ścieżki żądania dosłownie",
    async (klucz, wersja) => {
      const { context, zadania } = atrapaBE();

      await loader(argumenty(context, klucz, wersja) as never);

      expect(zadania).toEqual([`GET /v1/consents/${klucz}/versions/${wersja}`]);
    },
  );

  it.each([["CONSENT_DEFINITION_NOT_FOUND"], ["CONSENT_VERSION_NOT_FOUND"]])(
    "BE 404 %s daje rzucony Response 404 — brak klucza i brak wersji wyglądają tak samo",
    async (code) => {
      const { context } = atrapaBE(() => bladBE(404, code));

      const rzucone = await loader(argumenty(context, "nie-ma", "1") as never).catch(
        (e: unknown) => e,
      );

      expect(rzucone).toBeInstanceOf(Response);
      expect((rzucone as Response).status).toBe(404);
    },
  );

  // Wersja z adresu to tekst, więc `Number()` łapie wszystko, co nie jest dodatnią liczbą całkowitą.
  // Wiersze `1.5` i `-1` przypinają obie połowy warunku: ułamek odpada na `isInteger`, ujemna na
  // dolnej granicy.
  const BLEDNE_WERSJE: [string, string][] = [
    ["nie liczba", "abc"],
    ["zero", "0"],
    ["ułamek", "1.5"],
    ["ujemna", "-1"],
  ];

  it.each(BLEDNE_WERSJE)("wersja: %s (%s) → 404, bez wołania BE", async (_opis, wersja) => {
    // Licznik, nie sam rzucony `Response`: atrapa BE odpowiada `200` z dokumentem, więc pominięta
    // walidacja objawiłaby się oddanym dokumentem, a licznik łapie też wariant, w którym `404`
    // dopiero by przyszło z BE.
    const { context, zadania } = atrapaBE();

    const rzucone = await loader(argumenty(context, "terms-of-service", wersja) as never).catch(
      (e: unknown) => e,
    );

    expect(rzucone).toBeInstanceOf(Response);
    expect((rzucone as Response).status).toBe(404);
    expect(zadania).toEqual([]);
  });

  // `429` zostaje tym, czym jest: komunikat limitu ze specu §9.2 dotyczy ekranów rejestracji, a ta
  // strona ma tylko hojny limit `default`, więc jego przekroczenie trafia na granicę błędu.
  it.each([
    [500, "INTERNAL_ERROR"],
    [429, "RATE_LIMITED"],
  ])(
    "awaria BE (%i %s) NIE udaje braku dokumentu — leci do granicy błędu",
    async (status, code) => {
      const { context } = atrapaBE(() => bladBE(status, code, { "retry-after": "120" }));

      const blad = await loader(argumenty(context, "terms-of-service", "2") as never).catch(
        (e: unknown) => e,
      );

      // Klasa błędu, nie „coś rzucono”: `Response` 404 kazałby uznać regulamin, który istnieje,
      // za nieistniejący, a błąd własny trasy (np. `TypeError`) nie dowodziłby niczego.
      expect(blad).toBeInstanceOf(ApiError);
      expect((blad as ApiError).status).toBe(status);
    },
  );

  const KTO: [string, AuthUser | null][] = [
    ["gość", null],
    ["trener", TRENER],
    ["podopieczny", PODOPIECZNY],
  ];

  it.each(KTO)(
    "%s dostaje dokument — strona jest dla każdego, bez przekierowania",
    async (_kto, user) => {
      // W odróżnieniu od stron rejestracji zalogowany tu nie jest odsyłany do swojej sekcji:
      // regulamin ma być do przeczytania także przez kogoś, kto już ma konto.
      const { context } = atrapaBE(undefined, user);

      const dane = await loader(argumenty(context, "terms-of-service", "2") as never);

      expect(dane).toEqual(DOKUMENT);
    },
  );
});

// Komponent bez `@testing-library/react`: render po stronie serwera przez statyczny router danych,
// tak jak w `rejestracja.token.test.ts` — te same hooki co w przeglądarce, asercje na HTML.
async function wyrenderuj(context: RouterContextProvider): Promise<string> {
  const handler = createStaticHandler([
    { path: "dokumenty/:klucz/:wersja", Component: Dokument, loader },
  ]);
  const wynik = await handler.query(new Request("https://fe.test/dokumenty/terms-of-service/2"), {
    requestContext: context,
  });
  if (wynik instanceof Response)
    throw new Error(`zamiast widoku przyszła odpowiedź ${wynik.status}`);
  const router = createStaticRouter(handler.dataRoutes, wynik);
  return renderToStaticMarkup(
    createElement(StaticRouterProvider, { router, context: wynik, hydrate: false }),
  );
}

describe("dokumenty/:klucz/:wersja — widok", () => {
  it("nagłówek niesie wersję i datę obowiązywania, treść Markdown idzie jako elementy", async () => {
    const dokument = {
      ...DOKUMENT,
      content: "## 1. Postanowienia\n\nTreść **dokumentu** w Markdownie.\n\n- pierwszy\n- drugi",
    };

    const html = await wyrenderuj(kontekst(() => json(200, dokument)));

    expect(html).toContain("Wersja 2 · obowiązuje od 1 października 2026");
    expect(html).toMatch(/<h1[^>]*>Regulamin<\/h1>/);
    expect(html).toContain("<h2>1. Postanowienia</h2>");
    expect(html).toContain("<strong>dokumentu</strong>");
    expect(html).toContain("<li>pierwszy</li>");
    // Treść stoi w elemencie ze stylami dokumentu (`dokument-tresc` w `app/styles/tokens.css`).
    // Bez klasy Markdown wraca do zerowych marginesów nagłówków, a nic tego nie zgłasza: arkusz
    // stylów nie ma testu, więc obecność klasy pilnuje tylko ta asercja.
    expect(html).toMatch(/<div class="dokument-tresc">[\s\S]*<h2>1\. Postanowienia<\/h2>/);
  });

  it("fixture rozróżnia strefy: formatter bez przypiętej strefy pokazuje inny dzień niż strona", () => {
    // Kanarek środowiska, nie trasy. Asercja o dacie wyżej ma sens tylko wtedy, gdy strefa procesu
    // różni się od strefy aplikacji; gdyby zmiana `TZ` przestała działać (inna wersja Node, inny
    // system) na maszynie w Warszawie, zapali się ten przypadek — zamiast cichej ślepoty testu daty.
    const bezPrzypiecia = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long" });

    expect(bezPrzypiecia.format(new Date(DOKUMENT.effectiveFrom))).toBe("30 września 2026");
  });

  it("surowy HTML z treści nie staje się elementami, a odnośnik javascript: nie dostaje adresu", async () => {
    // Kanarek na dołożenie `rehype-raw` albo własnego `urlTransform`: przy którymkolwiek z nich
    // te asercje zapalają się na czerwono, a treść dokumentu zaczyna wykonywać kod.
    const dokument = {
      ...DOKUMENT,
      content: [
        "Akapit przed.",
        "",
        "<script>alert(1)</script>",
        "",
        "<img src=x onerror=alert(2)>",
        "",
        "[zły odnośnik](javascript:alert(3))",
      ].join("\n"),
    };

    const html = await wyrenderuj(kontekst(() => json(200, dokument)));

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("zły odnośnik");
  });
});

describe("dokumenty/:klucz/:wersja — meta", () => {
  it("tytuł karty to tytuł dokumentu z nazwą marki", () => {
    expect(meta({ loaderData: DOKUMENT } as never)).toEqual([{ title: "Regulamin — kalisthenos" }]);
  });

  it("bez dokumentu trasa tytułu nie dokłada", () => {
    expect(meta({ loaderData: undefined } as never)).toEqual([]);
  });
});
