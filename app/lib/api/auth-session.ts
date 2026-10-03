import {
  authControllerLogin,
  authControllerLogout,
  invitesControllerAccept,
  registrationsControllerComplete,
} from "@kalisthenos/api-client";
import { odmowaRejestracji } from "~/lib/auth/registration";
import type { Api } from "./client";
import type { AuthUser } from "./context";
import { ApiError, komunikatLimitu } from "./errors";
import { type ApiSession, sessionFromTokens } from "./session";

const NIEPOPRAWNE_DANE = "Niepoprawne dane logowania.";

/**
 * Błąd, który trasa pokazuje **w formularzu**, a nie na granicy błędu.
 *
 * Ten sam wzorzec co `CategoryError` w `categories.ts`: moduł zachowuje własny
 * typ dla tych statusów, dla których trasa ma komunikat, a każdy inny puszcza
 * dalej jako `ApiError`. Granica jest tu ostra, bo po jednej jej stronie stoi
 * „popraw to, co wpisałeś", a po drugiej „to nie twoja wina" — i pomylenie ich
 * każe użytkownikowi sprawdzać hasło w odpowiedzi na awarię serwera.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Wspólne dla logowania i przyjęcia zaproszenia — oba mają ten sam limit w BE. Treść liczy
 * `komunikatLimitu`, wspólna też z rejestracją, która niesie własny typ odmowy.
 */
function limitPrzekroczony(retryAfter: number | undefined): AuthError {
  return new AuthError("rate limited", komunikatLimitu(retryAfter));
}

/**
 * Wystawia sesję. **Jedno wywołanie, nie dwa**: kontrakt oddaje `profile` razem
 * z tokenami, więc `GET /v1/me` byłoby tu zbędnym nawrotem po dane, które już
 * przyszły. `MeDto.roles` jest przy tym wąskie (`'trainer' | 'trainee'`), więc
 * `AuthUser` powstaje bez zawężania i bez zgadywania.
 *
 * `now` jest wstrzykiwane wyłącznie dla testów — `sessionFromTokens` przelicza
 * `expiresIn` na moment, a bez ustalonego zegara asercja na `accessExpiresAt`
 * byłaby wyścigiem z zegarem maszyny. Trasy wołają dwuargumentowo.
 */
export async function startSession(
  api: Api,
  credentials: { email: string; password: string },
  now: () => Date = () => new Date(),
): Promise<{ session: ApiSession; user: AuthUser }> {
  try {
    const { data } = await authControllerLogin({
      client: api,
      body: credentials,
      throwOnError: true,
    });

    return {
      session: sessionFromTokens(data, now()),
      user: {
        id: data.profile.partyId,
        email: data.profile.email,
        displayName: data.profile.displayName,
        roles: data.profile.roles,
        trainerId: data.profile.coach?.partyId ?? null,
        trainerName: data.profile.coach?.displayName ?? null,
      },
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // Komunikat WŁASNY, nie z BE: jedno zdanie dla nieistniejącego konta
      // i dla złego hasła. Przepuszczenie treści z tamtej strony groziłoby
      // tym, że kiedyś zacznie się różnić i stanie się wyrocznią, po której
      // da się sprawdzać, czy dany adres ma u nas konto.
      throw new AuthError("invalid credentials", NIEPOPRAWNE_DANE);
    }
    if (e instanceof ApiError && e.status === 429) throw limitPrzekroczony(e.retryAfter);
    throw e;
  }
}

/**
 * Przyjmuje zaproszenie i oddaje **samą sesję**, bez użytkownika.
 *
 * Nie z lenistwa: `AcceptedProfileResponse.roles` jest w kontrakcie typowane
 * jako `Array<string>`, szerzej niż `MeDto.roles`. Zbudowanie z tego `AuthUser`
 * wymagałoby zawężenia filtrem — czyli cichego wyrzucenia roli, której nie
 * znamy — a to jest dokładnie ten kształt błędu, przed którym broni się reguła
 * z kroku 1: trzecia rola ma zapalić `typecheck`, nie zniknąć. Trasa
 * przekierowuje na `/`, gdzie o sekcji rozstrzyga wąskie `/v1/me` z następnego
 * żądania.
 */
export async function acceptInvite(
  api: Api,
  token: string,
  input: { email: string; displayName: string; password: string },
  now: () => Date = () => new Date(),
): Promise<ApiSession> {
  try {
    const { data } = await invitesControllerAccept({
      client: api,
      path: { token },
      body: input,
      throwOnError: true,
    });
    return sessionFromTokens(data, now());
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // Jeden komunikat dla nieistniejącego, zużytego, wygasłego i takiego,
      // przy którym nie zgadza się adres — BE nie rozróżnia ich celowo
      // (ADR-0032), bo osobny kod pozwalałby dobierać adres serią prób.
      throw new AuthError("invite unusable", "Zaproszenie nieprawidłowe lub już wykorzystane.");
    }
    if (e instanceof ApiError && e.status === 409) {
      throw new AuthError("email taken", "Ten adres e-mail jest już zajęty.");
    }
    if (e instanceof ApiError && e.status === 429) throw limitPrzekroczony(e.retryAfter);
    throw e;
  }
}

/**
 * Dokańcza rejestrację trenera z linku z maila (`POST /v1/registrations/{token}/complete`):
 * BE zakłada konto, zapisuje zgody z numerami wersji, które człowiek widział, i wystawia sesję.
 *
 * Oddaje **samą sesję**, tak jak `acceptInvite` — profil w odpowiedzi typuje role szerzej niż
 * `MeDto`, więc o sekcji rozstrzyga wąskie `/v1/me` z następnego żądania, nie ta funkcja.
 *
 * Ciało składane jawnie pole po polu, także zgody: BE odrzuca pola spoza DTO
 * (`forbidNonWhitelisted`), a zgoda z podglądu linku niesie jeszcze `title` — wołający, który
 * poda ją wprost, przeszedłby `tsc` (zmienna, nie literał) i dostałby `400` dopiero na żywym BE.
 * Adresu w ciele nie ma — BE bierze go z linku.
 *
 * Odmowy dla formularza mapuje `odmowaRejestracji` (krok „dokończenie”); każda inna odpowiedź
 * leci dalej jako `ApiError`.
 */
export async function completeRegistration(
  api: Api,
  token: string,
  input: {
    displayName: string;
    password: string;
    acceptedConsents: { key: string; versionNumber: number }[];
  },
  now: () => Date = () => new Date(),
): Promise<ApiSession> {
  try {
    const { data } = await registrationsControllerComplete({
      client: api,
      path: { token },
      body: {
        displayName: input.displayName,
        password: input.password,
        acceptedConsents: input.acceptedConsents.map(({ key, versionNumber }) => ({
          key,
          versionNumber,
        })),
      },
      throwOnError: true,
    });
    return sessionFromTokens(data, now());
  } catch (e) {
    throw odmowaRejestracji(e, "dokonczenie") ?? e;
  }
}

/**
 * Gasi sesję po stronie BE. **Best-effort i to jest decyzja, nie niedbałość**
 * (D5 specu): wywołujący ma wyczyścić ciastko niezależnie od wyniku, bo
 * wylogowanie, które nie wylogowuje przez chwilową awarię backendu, zostawia
 * użytkownika zalogowanego wbrew jego kliknięciu. Sesję osieroconą po tamtej
 * stronie zamknie wygaśnięcie; ciastka w przeglądarce nie zamknie nic.
 *
 * Token idzie w ciele jawnie: `RefreshDto.refreshToken` jest opcjonalny tylko
 * dla klientów, którzy mają ciastko BE. FE trzyma go we własnym.
 */
export async function endSession(api: Api, session: ApiSession): Promise<void> {
  try {
    await authControllerLogout({
      client: api,
      body: { refreshToken: session.refreshToken },
      throwOnError: true,
    });
  } catch {
    // Świadomie połknięty — patrz komentarz wyżej.
  }
}
