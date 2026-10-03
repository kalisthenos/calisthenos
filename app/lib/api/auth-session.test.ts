// @vitest-environment node
//
// Środowisko `node` wspólnie z resztą tej warstwy: `Request`/`Response` mają się
// zachowywać jak na serwerze, a nie jak w atrapie przeglądarki z happy-dom.
import { describe, expect, it, vi } from "vitest";

// `createApiClient` sięga po `getEnv().API_URL` tylko wtedy, gdy `baseUrl` nie
// zostanie podany — testy podają go jawnie. Mock stoi tu mimo to, bo import
// modułu wciąga `~/lib/env` i brak zmiennych wywróciłby plik na `ZodError`
// jeszcze przed pierwszą asercją.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({ API_URL: "http://be.test" }),
}));

import { RegistrationError } from "../auth/registration";
import {
  AuthError,
  acceptInvite,
  completeRegistration,
  endSession,
  startSession,
} from "./auth-session";
import { createApiClient } from "./client";
import { ApiError } from "./errors";

const PROFIL = {
  partyId: "p-1",
  displayName: "Anna Kowalska",
  email: "anna@example.pl",
  roles: ["trainer"],
  coach: null,
};

const TERAZ = new Date("2026-09-01T10:00:00Z");

function klient(reguly: (req: Request) => Response | Promise<Response>) {
  return createApiClient({
    baseUrl: "http://be.test",
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

describe("startSession — wystawienie sesji na tokenach BE", () => {
  it("jedno wywołanie daje i sesję, i użytkownika", async () => {
    // Kontrakt oddaje profil RAZEM z tokenami, więc logowanie nie potrzebuje
    // osobnego `/v1/me`. Asercja stoi na LIŚCIE trafień, nie na samym wyniku —
    // dołożone drugie wywołanie przeszłoby test patrzący tylko na wynik.
    const trafienia: string[] = [];
    const api = klient((req) => {
      trafienia.push(new URL(req.url).pathname);
      return json(200, { accessToken: "A1", refreshToken: "R1", expiresIn: 900, profile: PROFIL });
    });

    const { session, user } = await startSession(
      api,
      { email: "anna@example.pl", password: "tajne123" },
      () => TERAZ,
    );

    expect(trafienia).toEqual(["/v1/auth/login"]);
    expect(session.refreshToken).toBe("R1");
    expect(session.accessExpiresAt).toBe(TERAZ.getTime() + 900_000);
    expect(user.id).toBe("p-1");
    expect(user.roles).toEqual(["trainer"]);
  });

  it("401 daje JEDEN komunikat, niezależnie od kształtu odmowy", async () => {
    // Trasa nie może odróżnić „nie ma konta" od „złe hasło" — BE ich nie
    // odróżnia i to jest celowe. Dwa różne kształty odpowiedzi, jedno wyjście.
    const bezKoperty = klient(() => json(401, {}));
    const zKoperta = klient(() =>
      json(401, { error: { code: "UNAUTHENTICATED", message: "Zły adres albo hasło." } }),
    );

    for (const api of [bezKoperty, zKoperta]) {
      const blad = await startSession(api, { email: "a@e.pl", password: "x" }).catch(
        (e: unknown) => e,
      );
      expect(blad).toBeInstanceOf(AuthError);
      expect((blad as AuthError).userMessage).toBe("Niepoprawne dane logowania.");
    }
  });

  it("429 niesie liczbę minut z nagłówka", async () => {
    // 900 s to 15 min — dokładnie okno throttlera BE. Bez `retryAfter`
    // komunikat mówiłby „za chwilę", a użytkownik próbowałby od razu i dostał
    // to samo.
    const api = klient(() =>
      json(
        429,
        { error: { code: "RATE_LIMITED", message: "Za dużo prób." } },
        { "retry-after": "900" },
      ),
    );

    const blad = await startSession(api, { email: "a@e.pl", password: "x" }).catch(
      (e: unknown) => e,
    );

    expect(blad).toBeInstanceOf(AuthError);
    expect((blad as AuthError).userMessage).toBe("Za dużo prób. Spróbuj ponownie za 15 min.");
  });

  it("429 bez nagłówka mówi ogólnie, nie „za NaN min”", async () => {
    const api = klient(() => json(429, { error: { code: "RATE_LIMITED", message: "Za dużo." } }));

    const blad = await startSession(api, { email: "a@e.pl", password: "x" }).catch(
      (e: unknown) => e,
    );

    expect((blad as AuthError).userMessage).toBe("Za dużo prób. Spróbuj ponownie za chwilę.");
  });

  it("awaria BE NIE jest błędem poświadczeń", async () => {
    // Gdyby moduł łykał każdy status, awaria backendu pokazałaby się jako
    // „niepoprawne dane logowania" — czyli kazałaby użytkownikowi sprawdzać
    // hasło w odpowiedzi na cudzą usterkę, ukrywając usterkę przed nami.
    const api = klient(() => json(500, { error: { code: "INTERNAL", message: "Ups." } }));

    const blad = await startSession(api, { email: "a@e.pl", password: "x" }).catch(
      (e: unknown) => e,
    );

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(AuthError);
  });
});

describe("acceptInvite — przyjęcie zaproszenia", () => {
  it("wystawia sesję i NIE interpretuje ról z odpowiedzi", async () => {
    // Kontrakt typuje tu `roles` jako `Array<string>`, szerzej niż w `MeDto`.
    // Moduł świadomie nie buduje z tego `AuthUser` — o sekcji rozstrzyga `/`
    // na podstawie wąskiego `/v1/me` z następnego żądania (D4 specu). Rola
    // „cokolwiek" w tym teście jest tu po to, żeby próba zawężenia jej filtrem
    // rzuciła się w oczy przy najbliższej zmianie.
    let opis = "";
    const api = klient((req) => {
      opis = `${req.method} ${new URL(req.url).pathname}`;
      return json(200, {
        accessToken: "A1",
        refreshToken: "R1",
        expiresIn: 900,
        profile: {
          partyId: "p-2",
          displayName: "Ola",
          email: "ola@e.pl",
          roles: ["cokolwiek"],
          coach: null,
        },
      });
    });

    const session = await acceptInvite(
      api,
      "tok-1",
      { email: "ola@e.pl", displayName: "Ola", password: "tajne123" },
      () => TERAZ,
    );

    expect(opis).toBe("POST /v1/invites/tok-1/accept");
    expect(session.refreshToken).toBe("R1");
    expect(session.accessExpiresAt).toBe(TERAZ.getTime() + 900_000);
  });

  it("404 znaczy nieprawidłowe zaproszenie, bez rozróżniania dlaczego", async () => {
    // BE zwraca jeden kod dla nieistniejącego, zużytego, wygasłego i takiego,
    // przy którym nie zgadza się adres — osobne kody byłyby wyrocznią
    // pozwalającą dobierać adres serią prób (ADR-0032).
    const api = klient(() =>
      json(404, { error: { code: "RESOURCE_NOT_FOUND", message: "Brak." } }),
    );

    const blad = await acceptInvite(api, "tok-1", {
      email: "ola@e.pl",
      displayName: "Ola",
      password: "tajne123",
    }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(AuthError);
    expect((blad as AuthError).userMessage).toBe("Zaproszenie nieprawidłowe lub już wykorzystane.");
  });

  it("409 znaczy adres zajęty", async () => {
    const api = klient(() =>
      json(409, { error: { code: "EMAIL_ALREADY_TAKEN", message: "Zajęty." } }),
    );

    const blad = await acceptInvite(api, "tok-1", {
      email: "ola@e.pl",
      displayName: "Ola",
      password: "tajne123",
    }).catch((e: unknown) => e);

    expect((blad as AuthError).userMessage).toBe("Ten adres e-mail jest już zajęty.");
  });

  it("awaria BE nie zamienia się w komunikat o zaproszeniu", async () => {
    const api = klient(() => json(500, { error: { code: "INTERNAL", message: "Ups." } }));

    const blad = await acceptInvite(api, "tok-1", {
      email: "ola@e.pl",
      displayName: "Ola",
      password: "tajne123",
    }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(AuthError);
  });
});

describe("completeRegistration — dokończenie rejestracji trenera", () => {
  const WEJSCIE = {
    displayName: "Anna Kowalska",
    password: "tajne1234",
    acceptedConsents: [
      { key: "terms-of-service", versionNumber: 1 },
      { key: "trainer-dpa", versionNumber: 1 },
    ],
  };

  it("wystawia samą sesję z tokenów i wysyła dokładnie nazwę, hasło i zgody", async () => {
    // Adresu w ciele nie ma: BE bierze go z linku. Pole spoza DTO nie zostałoby zignorowane,
    // tylko odrzucone (`forbidNonWhitelisted`) — czyli `400`, który unit test z podstawionym
    // transportem zobaczy dopiero wtedy, gdy ktoś go tu przypnie. Wynik to sama sesja, bez
    // profilu: ten sam powód co przy `acceptInvite` (role w odpowiedzi typowane szerzej).
    let opis = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      opis = `${req.method} ${new URL(req.url).pathname}`;
      cialo = await req.json();
      return json(200, { accessToken: "A1", refreshToken: "R1", expiresIn: 900, profile: PROFIL });
    });

    const session = await completeRegistration(api, "tok-1", WEJSCIE, () => TERAZ);

    expect(opis).toBe("POST /v1/registrations/tok-1/complete");
    expect(cialo).toEqual(WEJSCIE);
    expect(Object.keys(cialo as Record<string, unknown>).sort()).toEqual([
      "acceptedConsents",
      "displayName",
      "password",
    ]);
    expect(session).toEqual({
      accessToken: "A1",
      refreshToken: "R1",
      accessExpiresAt: TERAZ.getTime() + 900_000,
    });
  });

  it("`404 REGISTRATION_LINK_NOT_FOUND` to odmowa „link nieważny”", async () => {
    const api = klient(() =>
      json(404, { error: { code: "REGISTRATION_LINK_NOT_FOUND", message: "Brak." } }),
    );

    const blad = await completeRegistration(api, "tok-1", WEJSCIE).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("link-invalid");
    expect((blad as RegistrationError).userMessage).toBe("Link jest nieważny albo wygasł.");
  });

  it("`409 CONSENT_VERSION_OUTDATED` (z `details`) to odmowa „dokument się zmienił”", async () => {
    // `details` niesie `key` i `currentVersion`; FE ich nie czyta — po odmowie loader trasy
    // przeładuje podgląd linku, a ten niesie aktualną listę zgód z numerami wersji.
    const api = klient(() =>
      json(409, {
        error: {
          code: "CONSENT_VERSION_OUTDATED",
          message: "Wyszła nowsza wersja zgody.",
          details: { key: "terms-of-service", currentVersion: 2 },
        },
      }),
    );

    const blad = await completeRegistration(api, "tok-1", WEJSCIE).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("consents-changed");
    expect((blad as RegistrationError).userMessage).toBe(
      "Dokument się zmienił — zapoznaj się z aktualną wersją.",
    );
  });

  it("`400 VALIDATION_FAILED` pokazuje komunikat WŁASNY, nie tekst walidatora z BE", async () => {
    // BE kładzie w `details.fields` teksty walidatora — hasło po polsku, nazwę po angielsku.
    // Formularz mówi ogólnie „Sprawdź pola formularza.”: nie miesza języków i nie przepuszcza
    // cudzej treści, której kształt może się zmienić bez zmiany kontraktu.
    const api = klient(() =>
      json(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Ładunek nie przechodzi walidacji.",
          details: {
            fields: {
              displayName: ["displayName must be shorter than or equal to 200 characters"],
            },
          },
        },
      }),
    );

    const blad = await completeRegistration(api, "tok-1", WEJSCIE).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("invalid-input");
    expect((blad as RegistrationError).userMessage).toBe("Sprawdź pola formularza.");
  });

  it("`429` niesie minuty z nagłówka — ten sam komunikat limitu co logowanie", async () => {
    const api = klient(() =>
      json(
        429,
        { error: { code: "RATE_LIMITED", message: "Za dużo prób." } },
        { "retry-after": "120" },
      ),
    );

    const blad = await completeRegistration(api, "tok-1", WEJSCIE).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(RegistrationError);
    expect((blad as RegistrationError).refusal).toBe("rate-limited");
    expect((blad as RegistrationError).userMessage).toBe(
      "Za dużo prób. Spróbuj ponownie za 2 min.",
    );
  });

  it("awaria BE nie zamienia się w odmowę formularza", async () => {
    const api = klient(() => json(500, { error: { code: "INTERNAL_ERROR", message: "Ups." } }));

    const blad = await completeRegistration(api, "tok-1", WEJSCIE).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(RegistrationError);
    expect(blad).not.toBeInstanceOf(AuthError);
  });
});

describe("endSession — wylogowanie", () => {
  it("podaje token odświeżający w ciele", async () => {
    // FE trzyma token we WŁASNYM ciastku, nie w tym, którego szuka BE, więc
    // musi go podać jawnie — `RefreshDto.refreshToken` jest opcjonalny
    // wyłącznie dla klientów mających ciastko BE.
    let cialo = "";
    const api = klient(async (req) => {
      cialo = await req.text();
      return new Response(null, { status: 204 });
    });

    await endSession(api, { accessToken: "A1", refreshToken: "R1", accessExpiresAt: 0 });

    expect(JSON.parse(cialo)).toEqual({ refreshToken: "R1" });
  });

  it("nie rzuca, gdy BE odmawia", async () => {
    // D5 specu: wylogowanie, które nie wylogowuje, bo backend akurat nie
    // odpowiada, jest gorsze niż osierocona sesja po tamtej stronie.
    // Czyszczenie ciastka w trasie NIE MOŻE zależeć od tego wywołania.
    const api = klient(() => json(503, {}));

    await expect(
      endSession(api, { accessToken: "A1", refreshToken: "R1", accessExpiresAt: 0 }),
    ).resolves.toBeUndefined();
  });
});
