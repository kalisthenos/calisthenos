// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env", () => ({
  getEnv: () => ({ API_URL: "http://be.test" }),
}));

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
import { RegistrationError } from "~/lib/auth";
import Rejestracja, { action, loader } from "./rejestracja";

const TRENER: AuthUser = {
  id: "p-1",
  email: "anna@x.pl",
  displayName: "Anna",
  roles: ["trainer"],
  trainerId: null,
  trainerName: null,
};

const PODOPIECZNY: AuthUser = { ...TRENER, id: "p-2", displayName: "Ola", roles: ["trainee"] };

function kontekst(
  reguly: (req: Request) => Response | Promise<Response> = () => {
    throw new Error("BE nie miało być wołane");
  },
  user: AuthUser | null = null,
) {
  const context = new RouterContextProvider();
  context.set(apiContext, {
    api: createApiClient({
      baseUrl: "http://be.test",
      getToken: () => undefined,
      fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
    }),
    user,
  });
  return context;
}

// Koperta błędu BE: `{ error: { code, message } }`. `message` przychodzi z BE, ale trasa go
// NIE pokazuje — testy niżej sprawdzają, że użytkownik widzi tekst WŁASNY frontu.
function bladBE(status: number, code: string, naglowki: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ error: { code, message: "Komunikat z BE, którego FE nie pokazuje." } }),
    { status, headers: { "content-type": "application/json", ...naglowki } },
  );
}

function zgloszenie(pola: Record<string, string>): Request {
  return new Request("https://fe.test/rejestracja", {
    method: "POST",
    body: new URLSearchParams(pola),
  });
}

describe("rejestracja — krok 1, zgłoszenie adresu", () => {
  it("poprawny adres: 202 z BE daje { wyslano }, a do BE jedzie jedno zgłoszenie", async () => {
    const zadania: { metoda: string; sciezka: string; cialo: unknown }[] = [];
    const context = kontekst(async (req) => {
      zadania.push({
        metoda: req.method,
        sciezka: new URL(req.url).pathname,
        cialo: await req.json(),
      });
      return new Response(null, { status: 202 });
    });

    const wynik = await action({
      request: zgloszenie({ email: "anna@x.pl" }),
      params: {},
      context,
    } as never);

    expect(wynik).toEqual({ wyslano: "anna@x.pl" });
    expect(zadania).toEqual([
      { metoda: "POST", sciezka: "/v1/registrations", cialo: { email: "anna@x.pl" } },
    ]);
  });

  it("adres z odstępami jedzie do BE i wraca w wyniku przycięty", async () => {
    // Wklejony adres bywa z odstępem na końcu. Bez przycięcia Zod uznałby go za zły albo BE
    // dostałby adres, którego nikt nie wpisał.
    let cialo: unknown;
    const context = kontekst(async (req) => {
      cialo = await req.json();
      return new Response(null, { status: 202 });
    });

    const wynik = await action({
      request: zgloszenie({ email: "  anna@x.pl " }),
      params: {},
      context,
    } as never);

    expect(wynik).toEqual({ wyslano: "anna@x.pl" });
    expect(cialo).toEqual({ email: "anna@x.pl" });
  });

  it("zajęty adres wraca jako komunikat formularza, nie wyjątek", async () => {
    const context = kontekst(() => bladBE(409, "EMAIL_ALREADY_TAKEN"));

    const wynik = await action({
      request: zgloszenie({ email: "anna@x.pl" }),
      params: {},
      context,
    } as never);

    // Odmowa po poprawnym adresie niesie ten adres z powrotem — formularz pokaże go w polu.
    expect(wynik).toEqual({
      blad: "Ten adres ma już konto. Zaloguj się.",
      odmowa: "email-taken",
      email: "anna@x.pl",
    });
  });

  it("zamknięta rejestracja (wyłącznik BE) wraca tą samą ścieżką co inne odmowy", async () => {
    // U6 specu: przy `REGISTRATION_OPEN=false` BE odpowiada `409 REGISTRATION_CLOSED` na każde
    // zgłoszenie. Ekran dowiaduje się o zamknięciu z odmowy — nie ma trasy „czy otwarta”.
    const context = kontekst(() => bladBE(409, "REGISTRATION_CLOSED"));

    const wynik = await action({
      request: zgloszenie({ email: "anna@x.pl" }),
      params: {},
      context,
    } as never);

    expect(wynik).toEqual({
      blad: "Rejestracja kont trenerów jest chwilowo zamknięta.",
      odmowa: "registration-closed",
      email: "anna@x.pl",
    });
  });

  // „Wyślij ponownie” to ta sama akcja z ukrytym polem `email`, więc odmowa przy ponownym wysłaniu
  // wraca tą samą ścieżką co każda inna. Wynik akcji zastępuje poprzedni: widok „Sprawdź skrzynkę”
  // znika razem z adresem, a formularz, który go zastępuje, miałby puste pole pod komunikatem
  // o „tym adresie”. Dlatego odmowa po poprawnym adresie niesie ten adres — pole pokazuje go
  // z powrotem (test widoku niżej).
  const ODMOWY_PRZY_PONOWNYM_WYSLANIU: [
    string,
    () => Response,
    { blad: string; odmowa: string },
  ][] = [
    [
      "429 TOO_MANY_LINK_REQUESTS",
      () => bladBE(429, "TOO_MANY_LINK_REQUESTS"),
      {
        blad: "Wysłaliśmy już kilka wiadomości na ten adres — sprawdź skrzynkę (także folder spam) albo spróbuj za godzinę.",
        odmowa: "too-many-links",
      },
    ],
    [
      "429 RATE_LIMITED z Retry-After: 120",
      () => bladBE(429, "RATE_LIMITED", { "retry-after": "120" }),
      { blad: "Za dużo prób. Spróbuj ponownie za 2 min.", odmowa: "rate-limited" },
    ],
    [
      "409 REGISTRATION_CLOSED",
      () => bladBE(409, "REGISTRATION_CLOSED"),
      { blad: "Rejestracja kont trenerów jest chwilowo zamknięta.", odmowa: "registration-closed" },
    ],
  ];

  it.each(ODMOWY_PRZY_PONOWNYM_WYSLANIU)(
    "%s przy ponownym wysłaniu: odmowa niesie adres z formularza",
    async (_opis, odpowiedz, oczekiwane) => {
      const context = kontekst(odpowiedz);

      const wynik = await action({
        request: zgloszenie({ email: "anna@x.pl" }),
        params: {},
        context,
      } as never);

      expect(wynik).toEqual({ ...oczekiwane, email: "anna@x.pl" });
    },
  );

  it("adres w odmowie to ten przycięty, który pojechał do BE — nie surowe pole formularza", async () => {
    // Zwraca się wartość po Zod, tak jak przy sukcesie. Surowe pole mogłoby mieć odstępy (albo nie
    // być tekstem w ogóle), a wynik akcji trafia z powrotem do atrybutu na stronie.
    let cialo: unknown;
    const context = kontekst(async (req) => {
      cialo = await req.json();
      return bladBE(429, "TOO_MANY_LINK_REQUESTS");
    });

    const wynik = await action({
      request: zgloszenie({ email: "  anna@x.pl " }),
      params: {},
      context,
    } as never);

    expect(cialo).toEqual({ email: "anna@x.pl" });
    expect(wynik).toMatchObject({ odmowa: "too-many-links", email: "anna@x.pl" });
  });

  // Wiersze: to, co użytkownik wpisał, albo to, co przeszło przez formularz mimo `required`
  // i `type="email"` — przeglądarka to blokuje, ale akcja to zwykły `POST`. Ostatni wiersz
  // przypina `.max(254)`: 255 znaków samo przechodzi wzorzec adresu.
  const ZLE_ADRESY: [string, Record<string, string>][] = [
    ["pusty adres", { email: "" }],
    ["same odstępy", { email: "   " }],
    ["tekst bez małpy", { email: "to-nie-adres" }],
    ["brak pola w formularzu", {}],
    ["adres dłuższy niż 254 znaki", { email: `${"a".repeat(250)}@x.pl` }],
  ];

  it.each(ZLE_ADRESY)("%s odbija się od walidacji, bez wywołania BE", async (_opis, pola) => {
    // Licznik, nie sam brak wyjątku: atrapa BE odpowiada `202`, więc pominięta walidacja
    // objawiłaby się dopiero jako wynik `{ wyslano }`.
    let wywolan = 0;
    const context = kontekst(() => {
      wywolan += 1;
      return new Response(null, { status: 202 });
    });

    const wynik = await action({ request: zgloszenie(pola), params: {}, context } as never);

    expect(wynik).toEqual({ blad: "Podaj poprawny adres e-mail.", odmowa: "invalid-email" });
    expect(wywolan).toBe(0);
  });

  it("awaria BE (500) NIE jest komunikatem formularza — leci do granicy błędu", async () => {
    // Druga strona tej samej granicy: `500` ma wylecieć, a nie kazać poprawiać adres
    // w odpowiedzi na cudzą usterkę. Asercja na klasie błędu, nie na „coś rzucono”: błąd własny
    // trasy (np. `TypeError`) też jest „czymś” i nie dowodziłby niczego.
    const context = kontekst(() => bladBE(500, "INTERNAL_ERROR"));

    const blad = await action({
      request: zgloszenie({ email: "anna@x.pl" }),
      params: {},
      context,
    } as never).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(RegistrationError);
  });
});

describe("rejestracja — loader", () => {
  // Loader jest SYNCHRONICZNY i nie dotyka sieci (jak w `login`): użytkownika załadował
  // middleware raz na żądanie. Domyślna atrapa BE w `kontekst` rzuca, gdyby ktoś to zmienił.
  function argumenty(user: AuthUser | null) {
    return {
      request: new Request("https://fe.test/rejestracja"),
      params: {},
      context: kontekst(undefined, user),
    };
  }

  it.each([
    ["trener", TRENER, "/trener"],
    ["podopieczny", PODOPIECZNY, "/podopieczny"],
  ])("zalogowany (%s) nie widzi formularza — odsyła do swojej sekcji", (_rola, user, sekcja) => {
    let rzucone: unknown;
    try {
      loader(argumenty(user) as never);
    } catch (e) {
      rzucone = e;
    }

    expect(rzucone).toBeInstanceOf(Response);
    expect((rzucone as Response).headers.get("location")).toBe(sekcja);
  });

  it("gość dostaje formularz — loader niczego nie oddaje i nie przekierowuje", () => {
    expect(loader(argumenty(null) as never)).toBeNull();
  });
});

// Komponent bez `@testing-library/react` (tego drzewa nie ma): render po stronie serwera przez
// statyczny router danych, jak w `rejestracja.token.test.ts`. Statyczny router stoi zawsze w stanie
// "idle", więc te testy NIE dowodzą blokady przycisków na czas wysyłki — pilnują wyłącznie, że
// w spoczynku są aktywne, czyli że `busy` nie jest odwrócone.
async function wyrenderuj(context: RouterContextProvider, request?: Request): Promise<string> {
  const handler = createStaticHandler([
    { path: "rejestracja", Component: Rejestracja, loader, action },
  ]);
  const wynik = await handler.query(request ?? new Request("https://fe.test/rejestracja"), {
    requestContext: context,
  });
  if (wynik instanceof Response)
    throw new Error(`zamiast widoku przyszła odpowiedź ${wynik.status}`);
  const router = createStaticRouter(handler.dataRoutes, wynik);
  return renderToStaticMarkup(
    createElement(StaticRouterProvider, { router, context: wynik, hydrate: false }),
  );
}

/**
 * Otwierający znacznik `<button>` o danej treści; błąd, gdy go nie ma — asercja o NIEobecności
 * atrybutu przeszłaby pusta, gdyby przycisku nie było.
 */
function przycisk(html: string, tekst: string): string {
  const znacznik = new RegExp(`(<button [^>]*>)${tekst}</button>`).exec(html)?.[1];
  if (!znacznik) throw new Error(`na stronie nie ma przycisku „${tekst}”`);
  return znacznik;
}

/** Znacznik `<input>` pola adresu z formularza kroku 1; błąd, gdy go nie ma. */
function poleAdresu(html: string): string {
  const znacznik = /<input [^>]*id="reg-email"[^>]*>/.exec(html)?.[0];
  if (!znacznik) throw new Error("na stronie nie ma pola adresu („reg-email”)");
  return znacznik;
}

describe("rejestracja — widok", () => {
  it("krok 1 w spoczynku: formularz z aktywnym „Wyślij link” i pustym polem adresu", async () => {
    const html = await wyrenderuj(kontekst());

    expect(html).toContain("Załóż konto trenera");
    expect(przycisk(html, "Wyślij link")).not.toMatch(/\bdisabled\b/);
    // Świeży formularz nie ma wartości w polu. To zarazem kontrola dla testu niżej: pole jest
    // znajdowane, a brak `value` widać na nim jako brak — nie jako pudło wyszukiwania.
    expect(poleAdresu(html)).not.toContain("value=");
  });

  it("odmowa przy „Wyślij ponownie”: formularz z adresem w polu, a nie pusty ani „Sprawdź skrzynkę”", async () => {
    // Odmowa zastępuje widok „Sprawdź skrzynkę” formularzem, a komunikat mówi o „tym adresie”.
    // Bez adresu w polu wskazywałby adres, którego nie ma już na ekranie.
    const context = kontekst(() => bladBE(429, "TOO_MANY_LINK_REQUESTS"));

    const html = await wyrenderuj(context, zgloszenie({ email: "anna@x.pl" }));

    expect(html).not.toContain("Sprawdź skrzynkę");
    expect(html).toContain("Załóż konto trenera");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Wysłaliśmy już kilka wiadomości na ten adres");
    expect(poleAdresu(html)).toContain('value="anna@x.pl"');
  });

  it("po wysłaniu adresu: „Sprawdź skrzynkę” z aktywnym „Wyślij ponownie”", async () => {
    const context = kontekst(() => new Response(null, { status: 202 }));

    const html = await wyrenderuj(context, zgloszenie({ email: "anna@x.pl" }));

    expect(html).toContain("Sprawdź skrzynkę");
    expect(przycisk(html, "Wyślij ponownie")).not.toMatch(/\bdisabled\b/);
  });
});
