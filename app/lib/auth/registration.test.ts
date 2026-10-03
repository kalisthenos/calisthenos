import { describe, expect, it } from "vitest";
import { createApiClient } from "../api/client";
import { ApiError } from "../api/errors";
import {
  RegistrationError,
  type RegistrationRefusal,
  odmowaRejestracji,
  previewRegistration,
  requestRegistration,
} from "./registration";

// `Promise<Response>` w sygnaturze jest konieczne: przypadki niżej czytają ciało
// żądania (`await req.json()`), więc reguła bywa funkcją asynchroniczną.
function klient(reguly: (req: Request) => Response | Promise<Response>) {
  return createApiClient({
    baseUrl: "http://be.test",
    // Rejestracja biegnie bez sesji — to trasy dla kogoś, kto konta jeszcze nie ma.
    getToken: () => undefined,
    fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
  });
}

function json(status: number, cialo: unknown, naglowki: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json", ...naglowki },
  });
}

// Koperta błędu BE: `{ error: { code, message } }` — dokładnie to, co rozbiera `parseApiError`.
// `message` przychodzi z BE po polsku, ale ten moduł go NIE pokazuje: testy niżej sprawdzają,
// że użytkownik widzi tekst WŁASNY.
function odmowa(status: number, code: string, naglowki: Record<string, string> = {}): Response {
  return json(
    status,
    { error: { code, message: "Komunikat z BE, którego FE nie pokazuje." } },
    naglowki,
  );
}

type Krok = "zgloszenie" | "dokonczenie";

const ZGLOSZENIE: Krok[] = ["zgloszenie"];
const DOKONCZENIE: Krok[] = ["dokonczenie"];
const OBA: Krok[] = ["zgloszenie", "dokonczenie"];

interface Wiersz {
  status: number;
  code: string;
  /** Sekundy z nagłówka `Retry-After` — tylko tam, gdzie BE je podaje. */
  retryAfter?: number;
  /** Kroki, na których BE zwraca tę odpowiedź; wiersz „oba” rozwija się w dwa przypadki. */
  kroki: Krok[];
  refusal: RegistrationRefusal;
  userMessage: string;
}

// Teksty są wpisane literalnie, nie importowane z modułu: to treść, którą widzi człowiek,
// i test, który czyta ją z kodu, nie złapałby jej zmiany.
const ZGODY_ZMIENIONE = "Dokument się zmienił — zapoznaj się z aktualną wersją.";

const WIERSZE: Wiersz[] = [
  {
    status: 400,
    code: "INVALID_EMAIL",
    kroki: ZGLOSZENIE,
    refusal: "invalid-email",
    userMessage: "Podaj poprawny adres e-mail.",
  },
  {
    status: 400,
    code: "VALIDATION_FAILED",
    kroki: ZGLOSZENIE,
    refusal: "invalid-email",
    userMessage: "Podaj poprawny adres e-mail.",
  },
  {
    status: 400,
    code: "DISPOSABLE_EMAIL_DOMAIN",
    kroki: ZGLOSZENIE,
    refusal: "disposable-domain",
    userMessage: "Adresy tymczasowych skrzynek nie są obsługiwane — podaj inny adres.",
  },
  {
    status: 409,
    code: "EMAIL_ALREADY_TAKEN",
    kroki: OBA,
    refusal: "email-taken",
    userMessage: "Ten adres ma już konto. Zaloguj się.",
  },
  {
    status: 409,
    code: "REGISTRATION_CLOSED",
    kroki: OBA,
    refusal: "registration-closed",
    userMessage: "Rejestracja kont trenerów jest chwilowo zamknięta.",
  },
  {
    status: 429,
    code: "TOO_MANY_LINK_REQUESTS",
    kroki: ZGLOSZENIE,
    refusal: "too-many-links",
    userMessage:
      "Wysłaliśmy już kilka wiadomości na ten adres — sprawdź skrzynkę (także folder spam) albo spróbuj za godzinę.",
  },
  {
    status: 429,
    code: "RATE_LIMITED",
    retryAfter: 120,
    kroki: OBA,
    refusal: "rate-limited",
    userMessage: "Za dużo prób. Spróbuj ponownie za 2 min.",
  },
  {
    // Dodatkowy wiersz: `429` bez koperty i bez `Retry-After` (proxy, nie BE) też jest limitem —
    // gałąź po `switch` idzie po statusie, nie po kodzie — i nie wolno jej dać „za NaN min”.
    status: 429,
    code: "UNKNOWN",
    kroki: OBA,
    refusal: "rate-limited",
    userMessage: "Za dużo prób. Spróbuj ponownie za chwilę.",
  },
  {
    status: 404,
    code: "REGISTRATION_LINK_NOT_FOUND",
    kroki: DOKONCZENIE,
    refusal: "link-invalid",
    userMessage: "Link jest nieważny albo wygasł.",
  },
  {
    status: 409,
    code: "CONSENT_VERSION_OUTDATED",
    kroki: DOKONCZENIE,
    refusal: "consents-changed",
    userMessage: ZGODY_ZMIENIONE,
  },
  {
    status: 409,
    code: "REQUIRED_CONSENTS_MISSING",
    kroki: DOKONCZENIE,
    refusal: "consents-changed",
    userMessage: ZGODY_ZMIENIONE,
  },
  {
    status: 404,
    code: "CONSENT_DEFINITION_NOT_FOUND",
    kroki: DOKONCZENIE,
    refusal: "consents-changed",
    userMessage: ZGODY_ZMIENIONE,
  },
  {
    status: 404,
    code: "CONSENT_VERSION_NOT_FOUND",
    kroki: DOKONCZENIE,
    refusal: "consents-changed",
    userMessage: ZGODY_ZMIENIONE,
  },
  {
    status: 400,
    code: "INVALID_DISPLAY_NAME",
    kroki: DOKONCZENIE,
    refusal: "invalid-input",
    userMessage: "Nazwa wyświetlana musi mieć od 1 do 200 znaków.",
  },
  {
    status: 400,
    code: "PASSWORD_TOO_SHORT",
    kroki: DOKONCZENIE,
    refusal: "invalid-input",
    userMessage: "Hasło musi mieć co najmniej 8 znaków.",
  },
  {
    status: 400,
    code: "VALIDATION_FAILED",
    kroki: DOKONCZENIE,
    refusal: "invalid-input",
    userMessage: "Sprawdź pola formularza.",
  },
];

const PRZYPADKI = WIERSZE.flatMap((wiersz) => wiersz.kroki.map((krok) => ({ ...wiersz, krok })));

describe("odmowaRejestracji — odpowiedź BE na odmowę dla formularza", () => {
  it.each(PRZYPADKI)(
    "$status $code (krok: $krok) → $refusal",
    ({ status, code, retryAfter, krok, refusal, userMessage }) => {
      const blad = new ApiError(status, code, "Komunikat z BE.", undefined, retryAfter);

      const wynik = odmowaRejestracji(blad, krok);

      expect(wynik).toBeInstanceOf(RegistrationError);
      expect(wynik?.refusal).toBe(refusal);
      expect(wynik?.userMessage).toBe(userMessage);
    },
  );

  it.each(OBA)("`500 INTERNAL_ERROR` (krok: %s) → null — awaria BE ma zostać awarią", (krok) => {
    expect(odmowaRejestracji(new ApiError(500, "INTERNAL_ERROR", "Ups."), krok)).toBeNull();
  });

  it.each([
    ["nieznany kod na `400`", new ApiError(400, "CZEGOS_NOWEGO", "Nowa odmowa.")],
    // Kontrakt zna ten kod na dokończeniu (zgoda spoza katalogu trenera), ale FE wysyła tylko
    // zgody, które sam dostał z podglądu — wystąpienie znaczy błąd po naszej stronie, nie literówkę
    // użytkownika, więc formularz nie ma czego mu powiedzieć.
    ["`403 ACCESS_DENIED`", new ApiError(403, "ACCESS_DENIED", "Brak dostępu.")],
    [
      "`502` bez koperty (fetch nie doszedł do skutku)",
      new ApiError(502, "UNKNOWN", "Brak połączenia."),
    ],
    ["zwykły `Error`", new Error("fetch failed")],
    ["nie-błąd", "tekst"],
    ["`undefined`", undefined],
  ])("%s → null, dla obu kroków", (_opis, blad) => {
    for (const krok of OBA) {
      expect(odmowaRejestracji(blad, krok)).toBeNull();
    }
  });

  it("rzucony `Response` (sygnał sterowania z interceptora) → null, nie odmowa", () => {
    // `client.ts` rzuca `Response` zamiast błędu, gdy martwa sesja kończy się przekierowaniem.
    // To nie jest dana z BE, więc moduł nie ma prawa go połknąć ani zamienić w odmowę —
    // opakowania puszczają go dalej (`?? e`) i dopiero router odczyta przekierowanie.
    const przekierowanie = new Response(null, { status: 302, headers: { Location: "/login" } });

    for (const krok of OBA) {
      expect(odmowaRejestracji(przekierowanie, krok)).toBeNull();
    }
  });
});

describe("requestRegistration — krok 1, zgłoszenie adresu", () => {
  it("to `POST /v1/registrations` z samym adresem w ciele i kończy się bez wyniku przy `202`", async () => {
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return new Response(null, { status: 202 });
    });

    await expect(requestRegistration(api, "anna@example.pl")).resolves.toBeUndefined();

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/registrations");
    expect(cialo).toEqual({ email: "anna@example.pl" });
  });

  it("`VALIDATION_FAILED` czyta jako zły adres — to krok „zgłoszenie”", async () => {
    // Na tym kroku jest jedno pole, więc walidacja ładunku może dotyczyć tylko adresu. To samo
    // `VALIDATION_FAILED` na dokończeniu znaczy „sprawdź pola” — rozróżnia je wyłącznie krok,
    // który opakowanie przekazuje. Tabela wyżej woła `odmowaRejestracji` z krokiem wprost, więc
    // pomyłkę w opakowaniu łapie dopiero ten przypadek (a dla `completeRegistration` — jego
    // odpowiednik w `api/auth-session.test.ts`).
    const api = klient(() => odmowa(400, "VALIDATION_FAILED"));

    const blad = await requestRegistration(api, "nie-adres").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("invalid-email");
    expect((blad as RegistrationError).userMessage).toBe("Podaj poprawny adres e-mail.");
  });

  it("`429 TOO_MANY_LINK_REQUESTS` (bez `Retry-After`) to odmowa „za dużo linków”", async () => {
    const api = klient(() => odmowa(429, "TOO_MANY_LINK_REQUESTS"));

    const blad = await requestRegistration(api, "anna@example.pl").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("too-many-links");
  });

  it("`429 RATE_LIMITED` niesie minuty z nagłówka `Retry-After` aż do komunikatu", async () => {
    // Cała droga: nagłówek → interceptor klienta → `ApiError.retryAfter` → `komunikatLimitu`.
    // Tabela wyżej sprawdza ostatni odcinek; ten przypadek pilnuje, że nagłówek w ogóle dochodzi.
    const api = klient(() => odmowa(429, "RATE_LIMITED", { "retry-after": "120" }));

    const blad = await requestRegistration(api, "anna@example.pl").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("rate-limited");
    expect((blad as RegistrationError).userMessage).toBe(
      "Za dużo prób. Spróbuj ponownie za 2 min.",
    );
  });

  it("`500` przechodzi jako ApiError — awaria BE nie jest odmową formularza", async () => {
    const api = klient(() => odmowa(500, "INTERNAL_ERROR"));

    const blad = await requestRegistration(api, "anna@example.pl").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(RegistrationError);
  });
});

describe("previewRegistration — podgląd linku przez kontrakt", () => {
  const PODGLAD = {
    email: "anna@example.pl",
    requiredConsents: [
      { key: "terms-of-service", versionNumber: 1, title: "Regulamin" },
      { key: "trainer-dpa", versionNumber: 1, title: "Umowa powierzenia przetwarzania danych" },
    ],
  };

  it("to `GET /v1/registrations/{token}` po SUROWYM tokenie z linku i oddaje dane nietknięte", async () => {
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, PODGLAD);
    });

    const podglad = await previewRegistration(api, "tok-surowy");

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/registrations/tok-surowy");
    expect(podglad).toEqual(PODGLAD);
  });

  it("`404` daje `null` — link nieistniejący, zamknięty i wygasły są nieodróżnialne", async () => {
    // Reguła D3: funkcja z `| null` w sygnaturze łapie `404`. BE oddaje jeden kod na trzy
    // stany, więc rozróżnienia nie ma czym zrobić — trasa zamienia `null` na ekran „link nieważny”.
    const api = klient(() => odmowa(404, "REGISTRATION_LINK_NOT_FOUND"));

    await expect(previewRegistration(api, "tok-zly")).resolves.toBeNull();
  });

  it("`409 EMAIL_ALREADY_TAKEN` — adres dostał tymczasem konto — to odmowa, nie `null`", async () => {
    const api = klient(() => odmowa(409, "EMAIL_ALREADY_TAKEN"));

    const blad = await previewRegistration(api, "tok-1").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("email-taken");
    expect((blad as RegistrationError).userMessage).toBe("Ten adres ma już konto. Zaloguj się.");
  });

  it("`409 REGISTRATION_CLOSED` — wyłącznik rejestracji — to odmowa, nie `null`", async () => {
    // Zamknięta rejestracja nie jest „linkiem nieważnym”: komuś z ważnym linkiem trasa ma
    // powiedzieć, że wrócić trzeba później, a nie kazać mu prosić o nowy link.
    const api = klient(() => odmowa(409, "REGISTRATION_CLOSED"));

    const blad = await previewRegistration(api, "tok-1").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("registration-closed");
    expect((blad as RegistrationError).userMessage).toBe(
      "Rejestracja kont trenerów jest chwilowo zamknięta.",
    );
  });

  it("`500` przechodzi jako ApiError, nie jako brak linku", async () => {
    // Gdyby awaria BE wracała tu jako `null`, ekran pokazałby „link nieważny” komuś,
    // czyj link jest w porządku.
    const api = klient(() => odmowa(500, "INTERNAL_ERROR"));

    const blad = await previewRegistration(api, "tok-1").catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(RegistrationError);
  });
});
