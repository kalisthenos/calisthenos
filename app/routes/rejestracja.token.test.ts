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
import { readSessionCookie } from "~/lib/api/session";
import { RegistrationError } from "~/lib/auth";
import RejestracjaToken, { action, headers, loader, meta } from "./rejestracja.$token";

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

function json(status: number, cialo: unknown, naglowki: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json", ...naglowki },
  });
}

// Koperta błędu BE: `{ error: { code, message } }`. `message` przychodzi z BE, ale trasa go
// NIE pokazuje — testy niżej sprawdzają, że użytkownik widzi tekst WŁASNY frontu.
function bladBE(status: number, code: string, naglowki: Record<string, string> = {}): Response {
  return json(
    status,
    { error: { code, message: "Komunikat z BE, którego FE nie pokazuje." } },
    naglowki,
  );
}

const ZGODY = [
  { key: "terms-of-service", versionNumber: 1, title: "Regulamin" },
  { key: "trainer-dpa", versionNumber: 1, title: "Umowa powierzenia przetwarzania danych" },
];

const PODGLAD = { email: "anna@x.pl", requiredConsents: ZGODY };

const SESJA_BE = {
  accessToken: "A1",
  refreshToken: "R1",
  expiresIn: 900,
  profile: {
    partyId: "p-9",
    displayName: "Anna Kowalska",
    email: "anna@x.pl",
    roles: ["trainer"],
    coach: null,
  },
};

// Hasło ma dokładnie osiem znaków — dolną granicę `min(8)` przypina wiersz „hasło 7 znaków” niżej.
const POPRAWNE = { displayName: "Anna Kowalska", password: "osiem123" };
const ZAZNACZONE = ["terms-of-service:1", "trainer-dpa:1"];

function argumentyLoadera(context: RouterContextProvider, token = "tok-1") {
  return {
    request: new Request(`https://fe.test/rejestracja/${token}`),
    params: { token },
    context,
  };
}

// Pola formularza plus zgody jako powtórzone pole `zgoda` — tak je składa przeglądarka.
function dokonczenie(pola: Record<string, string>, zgody: string[] = []): Request {
  const cialo = new URLSearchParams(pola);
  for (const zgoda of zgody) cialo.append("zgoda", zgoda);
  return new Request("https://fe.test/rejestracja/tok-1", { method: "POST", body: cialo });
}

// BE, które przyjmuje dokończenie i zapisuje, co dostało — do asercji o tym, co trasa wysłała.
function atrapaDokonczenia() {
  const zadania: { opis: string; cialo: unknown }[] = [];
  const context = kontekst(async (req) => {
    zadania.push({ opis: `${req.method} ${new URL(req.url).pathname}`, cialo: await req.json() });
    return json(200, SESJA_BE);
  });
  return { context, zadania };
}

function wyslij(request: Request, context: RouterContextProvider) {
  return action({ request, params: { token: "tok-1" }, context } as never);
}

describe("rejestracja/:token — loader", () => {
  it("200: oddaje formularz z adresem z linku i zgodami z BE", async () => {
    const zadania: string[] = [];
    const context = kontekst((req) => {
      zadania.push(`${req.method} ${new URL(req.url).pathname}`);
      return json(200, PODGLAD);
    });

    const dane = await loader(argumentyLoadera(context) as never);

    expect(dane).toEqual({ stan: "formularz", email: "anna@x.pl", zgody: ZGODY });
    // Token jedzie do BE dosłownie, w ścieżce — tak jak stoi w adresie.
    expect(zadania).toEqual(["GET /v1/registrations/tok-1"]);
  });

  // Każda odmowa BE przy podglądzie to stan ekranu, nie wyjątek. Ostatni wiersz to rozstrzygnięcie
  // koordynatora do specu §9.2: limit żądań ma komunikat na WSZYSTKICH ekranach rejestracji.
  const STANY: [string, () => Response, unknown][] = [
    [
      "404 REGISTRATION_LINK_NOT_FOUND → link nieważny",
      () => bladBE(404, "REGISTRATION_LINK_NOT_FOUND"),
      { stan: "link-niewazny" },
    ],
    [
      "409 EMAIL_ALREADY_TAKEN → adres zajęty",
      () => bladBE(409, "EMAIL_ALREADY_TAKEN"),
      { stan: "adres-zajety" },
    ],
    [
      "409 REGISTRATION_CLOSED → rejestracja zamknięta",
      () => bladBE(409, "REGISTRATION_CLOSED"),
      { stan: "rejestracja-zamknieta" },
    ],
    [
      "429 RATE_LIMITED z Retry-After: 120 → limit z minutami",
      () => bladBE(429, "RATE_LIMITED", { "retry-after": "120" }),
      { stan: "limit", blad: "Za dużo prób. Spróbuj ponownie za 2 min." },
    ],
  ];

  it.each(STANY)("%s", async (_opis, odpowiedz, oczekiwane) => {
    const context = kontekst(odpowiedz);

    const dane = await loader(argumentyLoadera(context) as never);

    expect(dane).toEqual(oczekiwane);
  });

  it("awaria BE (500) NIE udaje żadnego stanu — leci do granicy błędu", async () => {
    // Gdyby awaria wracała jako „link nieważny”, ekran kazałby prosić o nowy link komuś, czyj link
    // jest w porządku. Asercja na klasie błędu: błąd własny trasy (np. `TypeError`) nie dowodzi nic.
    const context = kontekst(() => bladBE(500, "INTERNAL_ERROR"));

    const blad = await loader(argumentyLoadera(context) as never).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(RegistrationError);
  });

  const ZALOGOWANI: [string, AuthUser, string][] = [
    ["trener", TRENER, "/trener"],
    ["podopieczny", PODOPIECZNY, "/podopieczny"],
  ];

  it.each(ZALOGOWANI)(
    "zalogowany (%s) nie widzi formularza — odsyła do swojej sekcji, bez wołania BE",
    async (_rola, user, sekcja) => {
      // Domyślna atrapa BE w `kontekst` rzuca: loader, który zawołałby podgląd dla zalogowanego,
      // skończyłby błędem sieci, a nie przekierowaniem.
      const rzucone = await loader(argumentyLoadera(kontekst(undefined, user)) as never).catch(
        (e: unknown) => e,
      );

      expect(rzucone).toBeInstanceOf(Response);
      expect((rzucone as Response).headers.get("location")).toBe(sekcja);
    },
  );
});

describe("rejestracja/:token — akcja", () => {
  it("poprawne pola i dwie zaznaczone zgody: BE dostaje zgody z wersjami, odpowiedź loguje i odsyła na /", async () => {
    const { context, zadania } = atrapaDokonczenia();

    const res = (await wyslij(dokonczenie(POPRAWNE, ZAZNACZONE), context)) as Response;

    expect(zadania).toEqual([
      {
        opis: "POST /v1/registrations/tok-1/complete",
        cialo: {
          displayName: "Anna Kowalska",
          password: "osiem123",
          acceptedConsents: [
            { key: "terms-of-service", versionNumber: 1 },
            { key: "trainer-dpa", versionNumber: 1 },
          ],
        },
      },
    ]);
    // Na `/`, nie do sekcji: sekcję rozstrzyga `/v1/me` z następnego żądania.
    expect(res.headers.get("location")).toBe("/");
    const ciastko = res.headers.get("set-cookie");
    expect(ciastko).toContain("__Host-kth_api=");
    // Ciastko niesie tokeny z BE — sama nazwa nie dowodzi, że to ta sesja.
    expect(readSessionCookie(ciastko)).toMatchObject({ accessToken: "A1", refreshToken: "R1" });
  });

  it("zgody idą z numerem wersji z formularza; wpisy w złym kształcie nie jadą do BE", async () => {
    // Wersje 2 i 3, nie 1: numer pochodzi z wartości pola, nie jest stałą. Pięć wpisów spoza
    // kształtu `klucz:wersja` (brak numeru, zero, ułamek, pusty klucz, nie-liczba) odpada.
    const { context, zadania } = atrapaDokonczenia();
    const zgody = [
      "terms-of-service:2",
      "trainer-dpa:3",
      "bez-numeru",
      "x:0",
      "x:1.5",
      ":4",
      "y:abc",
    ];

    await wyslij(dokonczenie(POPRAWNE, zgody), context);

    expect(zadania[0]?.cialo).toEqual({
      ...POPRAWNE,
      acceptedConsents: [
        { key: "terms-of-service", versionNumber: 2 },
        { key: "trainer-dpa", versionNumber: 3 },
      ],
    });
  });

  it("nazwa jedzie do BE przycięta, hasło nietknięte", async () => {
    // Przycięcie hasła po cichu rozjechałoby je z tym, co człowiek wpisze przy logowaniu.
    const { context, zadania } = atrapaDokonczenia();

    await wyslij(
      dokonczenie({ displayName: "  Anna  ", password: " osiem123 " }, ZAZNACZONE),
      context,
    );

    expect(zadania[0]?.cialo).toMatchObject({ displayName: "Anna", password: " osiem123 " });
  });

  it("wartości graniczne przechodzą: nazwa 200 znaków, hasło 1024", async () => {
    const { context, zadania } = atrapaDokonczenia();
    const pola = { displayName: "a".repeat(200), password: "b".repeat(1024) };

    const res = await wyslij(dokonczenie(pola, ZAZNACZONE), context);

    expect(res).toBeInstanceOf(Response);
    expect(zadania[0]?.cialo).toMatchObject(pola);
  });

  // Wiersze: to, co przeszło przez formularz mimo `required`, `minLength` i `maxLength` —
  // przeglądarka to blokuje, ale akcja to zwykły `POST`. Wiersze 201 i 1025 przypinają górne
  // granice od zewnątrz, a siedem znaków hasła — dolną.
  const ZLE_POLA: [string, Record<string, string>][] = [
    ["pusta nazwa", { displayName: "", password: "osiem123" }],
    ["nazwa z samych odstępów", { displayName: "   ", password: "osiem123" }],
    ["nazwa 201 znaków", { displayName: "a".repeat(201), password: "osiem123" }],
    ["hasło 7 znaków", { displayName: "Anna", password: "siedem7" }],
    ["hasło 1025 znaków", { displayName: "Anna", password: "b".repeat(1025) }],
    ["brak pól w formularzu", {}],
  ];

  it.each(ZLE_POLA)("%s odbija się od walidacji, bez wywołania BE", async (_opis, pola) => {
    // Licznik, nie sam brak wyjątku: atrapa BE odpowiada `200` z sesją, więc pominięta walidacja
    // objawiłaby się dopiero jako przekierowanie.
    const { context, zadania } = atrapaDokonczenia();

    const wynik = await wyslij(dokonczenie(pola, ZAZNACZONE), context);

    expect(wynik).toEqual({ blad: "Sprawdź pola formularza." });
    expect(zadania).toEqual([]);
  });

  // Każda odmowa BE przy dokończeniu wraca komunikatem formularza z kodem odmowy, którym ekran
  // rozstrzyga o dodatkowym odnośniku. Komunikaty wpisane literalnie, nie importowane z modułu.
  const ODMOWY: [string, () => Response, { blad: string; odmowa: string }][] = [
    [
      "409 CONSENT_VERSION_OUTDATED",
      () =>
        json(409, {
          error: {
            code: "CONSENT_VERSION_OUTDATED",
            message: "Wyszła nowsza wersja zgody.",
            details: { key: "terms-of-service", currentVersion: 2 },
          },
        }),
      {
        blad: "Dokument się zmienił — zapoznaj się z aktualną wersją.",
        odmowa: "consents-changed",
      },
    ],
    [
      "404 REGISTRATION_LINK_NOT_FOUND",
      () => bladBE(404, "REGISTRATION_LINK_NOT_FOUND"),
      { blad: "Link jest nieważny albo wygasł.", odmowa: "link-invalid" },
    ],
    [
      "409 REGISTRATION_CLOSED",
      () => bladBE(409, "REGISTRATION_CLOSED"),
      { blad: "Rejestracja kont trenerów jest chwilowo zamknięta.", odmowa: "registration-closed" },
    ],
    [
      "429 RATE_LIMITED z Retry-After: 120",
      () => bladBE(429, "RATE_LIMITED", { "retry-after": "120" }),
      { blad: "Za dużo prób. Spróbuj ponownie za 2 min.", odmowa: "rate-limited" },
    ],
  ];

  it.each(ODMOWY)(
    "%s wraca jako komunikat formularza, nie wyjątek",
    async (_opis, odpowiedz, oczekiwane) => {
      const context = kontekst(odpowiedz);

      const wynik = await wyslij(dokonczenie(POPRAWNE, ZAZNACZONE), context);

      expect(wynik).toEqual(oczekiwane);
    },
  );

  it("awaria BE (500) NIE jest komunikatem formularza — leci do granicy błędu", async () => {
    const context = kontekst(() => bladBE(500, "INTERNAL_ERROR"));

    const blad = await wyslij(dokonczenie(POPRAWNE, ZAZNACZONE), context).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(RegistrationError);
  });
});

describe("rejestracja/:token — nagłówki i meta", () => {
  // To, co `root.tsx` ustawia na każdej stronie; rodzic przekazuje to trasie w `parentHeaders`.
  const NAGLOWKI_ROOT = {
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };

  function naglowkiStrony(): Headers {
    return new Headers(
      headers({
        parentHeaders: new Headers(NAGLOWKI_ROOT),
        loaderHeaders: new Headers(),
        actionHeaders: new Headers(),
        errorHeaders: undefined,
      }),
    );
  }

  it("odpowiada z Referrer-Policy: strict-origin i Cache-Control: no-store", () => {
    const naglowki = naglowkiStrony();

    // `strict-origin` wygrywa z polityką rodzica (`strict-origin-when-cross-origin` z `root.tsx`),
    // która przy żądaniach na ten sam origin wysyła w `Referer` PEŁNY adres — a ten niesie token.
    // To nie ma być `no-referrer`: przy nim natywny POST formularza (bez JS albo przed hydratacją)
    // dostaje `Origin: null`, a sprawdzenie CSRF w react-router odrzuca go odpowiedzią `400`.
    // `strict-origin` wysyła w `Referer` sam origin, bez ścieżki, i zostawia prawdziwy `Origin`.
    expect(naglowki.get("referrer-policy")).toBe("strict-origin");
    expect(naglowki.get("cache-control")).toBe("no-store");
  });

  it("zachowuje pozostałe nagłówki bezpieczeństwa rodzica", () => {
    // Trasa z własnym `headers` nie dziedziczy ich sama — router składa nagłówki od nowa z tego,
    // co ona zwróci. Zwrócenie samych dwóch nagłówków zdjęłoby ze strony z hasłem CSP i HSTS
    // bez żadnego objawu; ten przypadek jest jedynym, który to widzi.
    const naglowki = naglowkiStrony();

    expect(naglowki.get("content-security-policy")).toBe(NAGLOWKI_ROOT["Content-Security-Policy"]);
    expect(naglowki.get("x-content-type-options")).toBe("nosniff");
    expect(naglowki.get("permissions-policy")).toBe(NAGLOWKI_ROOT["Permissions-Policy"]);
    expect(naglowki.get("strict-transport-security")).toBe(
      NAGLOWKI_ROOT["Strict-Transport-Security"],
    );
  });

  it("meta zakazuje indeksowania strony", () => {
    expect(meta({} as never)).toContainEqual({ name: "robots", content: "noindex" });
  });
});

// Komponent bez `@testing-library/react` (tego drzewa nie ma): render po stronie serwera przez
// statyczny router danych. To te same hooki (`useLoaderData`, `useActionData`), `Form` i `Link`,
// co w przeglądarce — sprawdzamy kształt HTML, który ekran wysyła człowiekowi, nie zachowanie
// przeglądarki (`required` i `minLength` blokują wysyłkę dopiero tam).
async function wyrenderuj(context: RouterContextProvider, request?: Request): Promise<string> {
  const handler = createStaticHandler([
    { path: "rejestracja/:token", Component: RejestracjaToken, loader, action },
  ]);
  const wynik = await handler.query(request ?? new Request("https://fe.test/rejestracja/tok-1"), {
    requestContext: context,
  });
  if (wynik instanceof Response)
    throw new Error(`zamiast widoku przyszła odpowiedź ${wynik.status}`);
  const router = createStaticRouter(handler.dataRoutes, wynik);
  return renderToStaticMarkup(
    createElement(StaticRouterProvider, { router, context: wynik, hydrate: false }),
  );
}

/** Surowe atrybuty każdego odnośnika o danej treści, w kolejności na stronie. */
function atrybutyOdnosnikow(html: string, tekst: string): string[] {
  return [...html.matchAll(new RegExp(`<a ([^>]*)>${tekst}</a>`, "g"))].map((o) => o[1] ?? "");
}

/** Wartość atrybutu z surowego tekstu atrybutów, bez względu na ich kolejność; brak → `undefined`. */
function atrybut(atrybuty: string, nazwa: string): string | undefined {
  return new RegExp(`(?:^|\\s)${nazwa}="([^"]*)"`).exec(atrybuty)?.[1];
}

/** `href` każdego odnośnika o danej treści, w kolejności na stronie. */
function hrefyOdnosnikow(html: string, tekst: string): string[] {
  return atrybutyOdnosnikow(html, tekst).flatMap((atrybuty) => {
    const href = atrybut(atrybuty, "href");
    return href === undefined ? [] : [href];
  });
}

/** Znacznik `<input>` o danej nazwie pola; błąd, gdy go nie ma. */
function pole(html: string, nazwa: string): string {
  const znacznik = new RegExp(`<input [^>]*name="${nazwa}"[^>]*>`).exec(html)?.[0];
  if (!znacznik) throw new Error(`na stronie nie ma pola „${nazwa}”`);
  return znacznik;
}

/** Treść etykiety `<label for="…">` pola o danym `id`; błąd, gdy takiej etykiety nie ma. */
function etykieta(html: string, id: string): string {
  const tresc = new RegExp(`<label [^>]*for="${id}"[^>]*>(.*?)</label>`).exec(html)?.[1];
  if (tresc === undefined) throw new Error(`na stronie nie ma etykiety pola „${id}”`);
  return tresc;
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

describe("rejestracja/:token — widoki stanów", () => {
  it("link nieważny: objaśnienie i droga po nowy link, bez formularza", async () => {
    const html = await wyrenderuj(kontekst(() => bladBE(404, "REGISTRATION_LINK_NOT_FOUND")));

    expect(html).toContain("Link jest nieważny albo wygasł");
    expect(html).toContain("Linki działają 24 godziny i jeden raz.");
    expect(hrefyOdnosnikow(html, "Wyślij nowy link")).toEqual(["/rejestracja"]);
    expect(html).not.toContain("<form");
  });

  it("adres zajęty: odnośnik do logowania, bez formularza", async () => {
    const html = await wyrenderuj(kontekst(() => bladBE(409, "EMAIL_ALREADY_TAKEN")));

    expect(html).toContain("Ten adres ma już konto");
    expect(hrefyOdnosnikow(html, "Zaloguj się")).toEqual(["/login"]);
    expect(html).not.toContain("<form");
  });

  it("rejestracja zamknięta: komunikat i wyjście na logowanie — bez formularza i bez „Wyślij nowy link”", async () => {
    const html = await wyrenderuj(kontekst(() => bladBE(409, "REGISTRATION_CLOSED")));

    expect(html).toContain("Rejestracja kont trenerów jest chwilowo zamknięta.");
    expect(html).not.toContain("<form");
    expect(hrefyOdnosnikow(html, "Wyślij nowy link")).toEqual([]);
    // Każdy inny stan tej trasy ma odnośnik dalej; karta bez żadnego była ślepym zaułkiem.
    // Droga jest jedna — logowanie: nowy link nie pomoże, dopóki rejestracja jest zamknięta.
    expect(hrefyOdnosnikow(html, "Przejdź do logowania")).toEqual(["/login"]);
  });

  it("limit: komunikat z minutami i „Spróbuj ponownie” na TEJ SAMEJ stronie, z tokenem", async () => {
    const html = await wyrenderuj(
      kontekst(() => bladBE(429, "RATE_LIMITED", { "retry-after": "120" })),
    );

    expect(html).toContain("Za dużo prób");
    expect(html).toContain("Za dużo prób. Spróbuj ponownie za 2 min.");
    // `to="."` rozwiązuje się do ścieżki trasy razem z parametrem — odnośnik do bieżącego adresu,
    // którego kliknięcie przeładowuje loader (a ten pyta BE jeszcze raz).
    expect(hrefyOdnosnikow(html, "Spróbuj ponownie")).toEqual(["/rejestracja/tok-1"]);
    expect(html).not.toContain("<form");
  });

  it("formularz: adres tylko do odczytu, pola z ograniczeniami i po jednym polu na zgodę", async () => {
    const html = await wyrenderuj(kontekst(() => json(200, PODGLAD)));

    // Formularz wysyła na bieżącą trasę (token w adresie), metodą POST.
    expect(html).toContain("<form");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/rejestracja/tok-1"');

    const email = pole(html, "email");
    expect(email).toContain('value="anna@x.pl"');
    expect(email).toContain('readonly=""');

    const nazwa = pole(html, "displayName");
    expect(nazwa).toContain('required=""');
    expect(nazwa).toMatch(/maxlength="200"/i);

    const haslo = pole(html, "password");
    expect(haslo).toContain('type="password"');
    expect(haslo).toContain('required=""');
    expect(haslo).toMatch(/minlength="8"/i);
    expect(haslo).toMatch(/autocomplete="new-password"/i);

    // Wartość pola zgody to `klucz:numerWersji` — wersja, którą człowiek właśnie widzi.
    const zgody = html.match(/<input [^>]*name="zgoda"[^>]*>/g) ?? [];
    expect(zgody.map((z) => z.match(/value="([^"]*)"/)?.[1])).toEqual([
      "terms-of-service:1",
      "trainer-dpa:1",
    ]);
    for (const z of zgody) {
      expect(z).toContain('type="checkbox"');
      expect(z).toContain('required=""');
      // Odznaczone: zgodę człowiek daje sam, po zobaczeniu wersji.
      expect(z).not.toMatch(/\bchecked\b/);
    }
    // Nazwa pola wyboru to treść jego etykiety, a odnośnik „przeczytaj” stoi POZA nią: wewnątrz
    // jego `aria-label` wszedłby do tej nazwy („Akceptuję: Regulamin (przeczytaj: Regulamin
    // (otwiera się w nowej karcie))”). Etykieta każdego pola jest znajdowana po jego `id`, więc
    // brak `id` albo `for` kończy się błędem, nie pustą asercją.
    const nazwy = zgody.map((z) => etykieta(html, atrybut(z, "id") ?? ""));
    expect(nazwy).toEqual([
      "Akceptuję: Regulamin",
      "Akceptuję: Umowa powierzenia przetwarzania danych",
    ]);
    for (const nazwa of nazwy) expect(nazwa).not.toContain("przeczytaj");
    expect(hrefyOdnosnikow(html, "przeczytaj")).toEqual([
      "/dokumenty/terms-of-service/1",
      "/dokumenty/trainer-dpa/1",
    ]);
    // W nowej karcie i bez `Referer`: adres tej strony niesie token. Każdy odnośnik osobno, bez
    // zakładania kolejności atrybutów ani słów w `rel`. Długość rozstrzyga PRZED pętlą: pusta
    // lista przeszłaby ją bez ani jednej asercji.
    const odnosniki = atrybutyOdnosnikow(html, "przeczytaj");
    expect(odnosniki).toHaveLength(2);
    for (const atrybuty of odnosniki) {
      expect(atrybut(atrybuty, "target")).toBe("_blank");
      const rel = (atrybut(atrybuty, "rel") ?? "").split(/\s+/);
      expect(rel).toContain("noreferrer");
      expect(rel).toContain("noopener");
    }
    // Nazwa dostępna zaczyna się od widocznego tekstu (WCAG 2.5.3), wskazuje dokument i uprzedza
    // o nowej karcie.
    expect(odnosniki.map((atrybuty) => atrybut(atrybuty, "aria-label"))).toEqual([
      "przeczytaj: Regulamin (otwiera się w nowej karcie)",
      "przeczytaj: Umowa powierzenia przetwarzania danych (otwiera się w nowej karcie)",
    ]);

    expect(html).toContain("Załóż konto");
    // Stan spoczynku: przycisk aktywny — to pilnuje, że `busy` nie jest odwrócone. Samej blokady
    // na czas wysyłki ten test NIE dowodzi: statyczny router zawsze stoi w stanie "idle", więc
    // `busy` jest tu zawsze fałszem.
    expect(przycisk(html, "Załóż konto")).not.toMatch(/\bdisabled\b/);
    expect(html).not.toContain('role="alert"');
  });

  it("odmowa „dokument się zmienił”: komunikat przy formularzu, bez drogi po nowy link", async () => {
    // BE odpowiada na podgląd (po akcji router przeładowuje loader) i odrzuca dokończenie.
    const context = kontekst((req) =>
      req.method === "GET" ? json(200, PODGLAD) : bladBE(409, "CONSENT_VERSION_OUTDATED"),
    );

    const html = await wyrenderuj(context, dokonczenie(POPRAWNE, ZAZNACZONE));

    expect(html).toContain("<form");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Dokument się zmienił — zapoznaj się z aktualną wersją.");
    expect(hrefyOdnosnikow(html, "Wyślij nowy link")).toEqual([]);
  });

  it("odmowa „link nieważny” przy wysyłce: komunikat i odnośnik „Wyślij nowy link”", async () => {
    // Atrapa jest niespójna celowo: podgląd ważny, dokończenie odrzucone. Dzięki temu widać gałąź
    // komponentu w izolacji — w życiu po takiej odmowie loader też dostałby `404`.
    const context = kontekst((req) =>
      req.method === "GET" ? json(200, PODGLAD) : bladBE(404, "REGISTRATION_LINK_NOT_FOUND"),
    );

    const html = await wyrenderuj(context, dokonczenie(POPRAWNE, ZAZNACZONE));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Link jest nieważny albo wygasł.");
    expect(hrefyOdnosnikow(html, "Wyślij nowy link")).toEqual(["/rejestracja"]);
  });

  it("odmowa „adres ma już konto” po akcji: widok końcowy rozstrzyga przeładowany loader", async () => {
    // Obie odpowiedzi BE to `409 EMAIL_ALREADY_TAKEN`: dokończenie odrzucone, a podgląd — wołany
    // jeszcze raz po akcji — potwierdza, że adres tymczasem dostał konto. Akcja oddaje wtedy ten
    // sam komunikat jako dane („Ten adres ma już konto. Zaloguj się.”), ale bez odnośnika; to
    // karta z logowaniem, którą rysuje loader, jest widokiem końcowym.
    const zadania: string[] = [];
    const context = kontekst((req) => {
      zadania.push(`${req.method} ${new URL(req.url).pathname}`);
      return bladBE(409, "EMAIL_ALREADY_TAKEN");
    });

    const html = await wyrenderuj(context, dokonczenie(POPRAWNE, ZAZNACZONE));

    // Kolejność żądań dowodzi, że loader poszedł PO akcji. To nie jest dowód na `shouldRevalidate`:
    // trasa go dziś nie eksportuje, a statyczny router i tak przeładowuje loadery zawsze (o tym
    // decyduje klient w przeglądarce). Gdyby trasa dostała `shouldRevalidate` zawężone do
    // `consents-changed`, ten widok zepsułby się po cichu, a żaden test jednostkowy by tego nie
    // zobaczył. Test pilnuje czegoś innego — że o widoku końcowym rozstrzyga loader.
    expect(zadania).toEqual([
      "POST /v1/registrations/tok-1/complete",
      "GET /v1/registrations/tok-1",
    ]);
    expect(html).toMatch(/<h1[^>]*>Ten adres ma już konto<\/h1>/);
    expect(hrefyOdnosnikow(html, "Zaloguj się")).toEqual(["/login"]);
    // Karta, nie formularz z alertem: komunikat akcji nie ma tu miejsca na ekranie.
    expect(html).not.toContain("<form");
    expect(html).not.toContain('role="alert"');
  });
});
