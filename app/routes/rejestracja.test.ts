// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env", () => ({
  getEnv: () => ({ API_URL: "http://be.test" }),
}));

import { RouterContextProvider } from "react-router";
import { createApiClient } from "~/lib/api/client";
import { type AuthUser, apiContext } from "~/lib/api/context";
import { ApiError } from "~/lib/api/errors";
import { RegistrationError } from "~/lib/auth";
import { action, loader } from "./rejestracja";

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
function bladBE(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message: "Komunikat z BE, którego FE nie pokazuje." } }),
    { status, headers: { "content-type": "application/json" } },
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

    expect(wynik).toEqual({
      blad: "Ten adres ma już konto. Zaloguj się.",
      odmowa: "email-taken",
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
    });
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
