/**
 * Sesja FE po integracji z BE: para tokenów zamiast identyfikatora wiersza.
 *
 * Do integracji sesja była wierszem w bazie, a ciastko niosło jego identyfikator
 * (`app/lib/auth/cookie.ts`). BE trzyma sesje u siebie, więc FE przestaje mieć
 * czego identyfikować — nosi **poświadczenia**: token dostępowy, token
 * odświeżający i moment wygaśnięcia tego pierwszego.
 *
 * BE oddaje token odświeżający w ciastku `sameSite: 'strict'` **oraz w ciele
 * odpowiedzi**, jawnie „dla klientów bez ciastek". Serwer FE wołający BE
 * server-do-serwera jest właśnie takim klientem: ciastka BE nie dotyczą
 * przeglądarki użytkownika, bo ta z BE nie rozmawia (decyzja D3 specu).
 */

/**
 * Nazwa **inna** niż `__Host-kth_session` i to jest celowe. Stare ciastko niesie
 * identyfikator wiersza w bazie, której po cutoverze nie ma. Osobna nazwa
 * sprawia, że stare ciastko nie ma jak zostać odczytane jako nowe — przy
 * wspólnej nazwie każdy zalogowany przed cutoverem dostałby przy pierwszym
 * żądaniu treść nie do sparsowania w miejscu, które biegnie na KAŻDYM żądaniu.
 *
 * Prefiks `__Host-` zostaje: przeglądarka odrzuca takie ciastko bez `Secure`,
 * z `Domain` albo ze ścieżką inną niż `/`, więc sąsiedni subdomain nie podstawi
 * swojego. Odrzuca **po cichu**, dlatego wymogi pilnuje test obok.
 */
export const API_SESSION_COOKIE = "__Host-kth_api";

/**
 * 30 dni — tyle, ile `SESSION_TTL_S` w BE (`libs/shared/config/env.schema.ts`).
 * Ciastko przeżywające sesję po tamtej stronie nie daje nic poza gorszym
 * objawem: zamiast ekranu logowania użytkownik dostaje ekran ładowania
 * zakończony wylogowaniem.
 */
const COOKIE_MAX_AGE_S = 2_592_000;

/**
 * Margines, o który token uznajemy za wygasły wcześniej, niż wygasa naprawdę.
 *
 * Token ważny jeszcze dwie sekundy zdąży wygasnąć w locie — między złożeniem
 * żądania tutaj a jego obsługą w BE. Bez marginesu ścieżka reaktywna (`401`
 * → odśwież → powtórz) przestaje być wyjątkiem i staje się normą dla każdego
 * żądania trafiającego w koniec piętnastominutowego okna. Trzydzieści sekund
 * pokrywa i przelot, i rozjazd zegarów obu maszyn.
 */
const REFRESH_MARGIN_MS = 30_000;

export interface ApiSession {
  accessToken: string;
  refreshToken: string;
  /** Moment wygaśnięcia tokenu dostępowego (ms epoch), nie jego długość życia. */
  accessExpiresAt: number;
}

/** Odpowiedź `POST /v1/auth/login` i `/refresh` — `AuthTokensDto` w kontrakcie. */
export interface ApiTokens {
  accessToken: string;
  refreshToken: string;
  /** Sekundy życia tokenu dostępowego. */
  expiresIn: number;
}

/**
 * BE oddaje DŁUGOŚĆ życia, a sesja musi znać MOMENT: przy następnym żądaniu nie
 * ma już od czego odmierzać sekund.
 */
export function sessionFromTokens(tokens: ApiTokens, now: Date): ApiSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: now.getTime() + tokens.expiresIn * 1_000,
  };
}

export function buildSessionCookie(session: ApiSession): string {
  return [
    `${API_SESSION_COOKIE}=${encode(session)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    // `Lax`, nie `Strict`: podopieczny wchodzi w link zaproszenia z poczty,
    // a przy `Strict` pierwsze żądanie po takim przejściu przychodzi bez
    // ciastka i wygląda jak wylogowanie.
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_S}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${API_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

/**
 * Zwraca `null` na **każdym** wejściu, którego nie da się odczytać — nigdy nie
 * rzuca. To biegnie na każdym żądaniu, a treść ciastka pochodzi z przeglądarki:
 * wyjątek tutaj jest `500` zamiast przekierowania na logowanie.
 */
export function readSessionCookie(cookieHeader: string | null): ApiSession | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(/;\s*/)) {
    const [name, ...rest] = part.split("=");
    if (name !== API_SESSION_COOKIE) continue;

    const raw = rest.join("=");
    return raw ? decode(raw) : null;
  }

  return null;
}

/** Czy token dostępowy jest wygasły albo wygaśnie w granicach marginesu. */
export function needsRefresh(session: ApiSession, now: Date): boolean {
  return session.accessExpiresAt - now.getTime() <= REFRESH_MARGIN_MS;
}

/**
 * base64url zamiast gołego JSON-a, bo `;` i `=` kończyłyby wartość ciastka.
 * Bez podpisu i to jest świadome: zawartością są tokeny na okaziciela, które
 * i tak weryfikuje BE. Podpis chroniłby wyłącznie przed podmianą, której
 * jedynym skutkiem jest `401`.
 */
function encode(session: ApiSession): string {
  return btoa(JSON.stringify(session))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decode(raw: string): ApiSession | null {
  try {
    const parsed: unknown = JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/")));

    if (!parsed || typeof parsed !== "object") return null;
    const { accessToken, refreshToken, accessExpiresAt } = parsed as Record<string, unknown>;

    if (typeof accessToken !== "string" || accessToken === "") return null;
    if (typeof refreshToken !== "string" || refreshToken === "") return null;
    if (typeof accessExpiresAt !== "number" || !Number.isFinite(accessExpiresAt)) {
      return null;
    }

    return { accessToken, refreshToken, accessExpiresAt };
  } catch {
    return null;
  }
}
