import { createClient, createConfig } from "@kalisthenos/api-client";
import type { Client } from "@kalisthenos/api-client";
import { getEnv } from "~/lib/env";
import { ApiError, parseApiError } from "./errors";

/**
 * Nazwa, którą moduły `app/lib` biorą pierwszym parametrem — dokładnie tam,
 * gdzie do integracji stało `Db`. Konwencja wstrzykiwania zostaje ta sama;
 * zmienia się wyłącznie to, co po drugiej stronie odpowiada na pytanie.
 */
export type Api = Client;

export interface ApiClientOptions {
  /** Domyślnie `API_URL` z konfiguracji. Jawny wyłącznie w testach. */
  baseUrl?: string;
  /**
   * **Funkcja, nie wartość.** Klient powstaje raz na żądanie, a token może się
   * w jego trakcie zmienić — odświeżenie w interceptorze podmienia go w uchwycie
   * sesji. Domknięta wartość sprawiłaby, że ponowienie idzie ze starym tokenem.
   */
  getToken: () => string | undefined;
  /**
   * Nagłówki dokładane do KAŻDEGO wywołania (ADR-0048 w BE): adres i przeglądarka klienta
   * oraz sekret, którym BE odróżnia serwer FE od kogoś, kto by je podstawił. Liczy je
   * `naglowkiPrzekazania` raz na żądanie przychodzące do FE — klient niczego nie wyprowadza.
   *
   * Idą w konfiguracji klienta, nie przez opakowanie `fetch`: hey-api scala `headers`
   * konfiguracji z nagłówkami wywołania przy każdym żądaniu, więc dostaje je także wywołanie
   * z własnymi (`Content-Type`, `Authorization`), a ponowienie po `401` — klonowane z żądania,
   * które klient już zbudował — niesie je w sobie.
   */
  forwardedHeaders?: Record<string, string>;
  /** Podstawiany wyłącznie w testach; produkcyjnie `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export function createApiClient({
  baseUrl,
  getToken,
  forwardedHeaders,
  fetch: transport,
}: ApiClientOptions): Api {
  const api = createClient(
    createConfig({
      baseUrl: baseUrl ?? getEnv().API_URL,
      // Moduły domenowe nie rozbierają `{ data, error }`. Błąd leci wyjątkiem
      // do trasy, gdzie `toRouteResponse` zamienia go na `Response`.
      throwOnError: true,
      auth: () => getToken(),
      ...(forwardedHeaders ? { headers: forwardedHeaders } : {}),
      ...(transport ? { fetch: transport } : {}),
    }),
  );

  api.interceptors.error.use((error, response) => {
    // `Response` rzucony z interceptora odpowiedzi (middleware kończący
    // martwą sesję przekierowaniem) jest SYGNAŁEM STEROWANIA, nie błędem
    // danych z BE — przepuszczany nietknięty, przed sprawdzeniem `ApiError`,
    // bo to inna kategoria niż to, co niżej rozpoznaje. Bez tej gałęzi
    // `parseApiError` nie znalazłby na obiekcie `Response` koperty `{error}`
    // i przemielił przekierowanie na generyczny `401/UNKNOWN` — tracąc jego
    // treść, zanim dotrze do miejsca, które umie je odczytać jako `Response`.
    if (error instanceof Response) return error;

    // Już zamieniony — ścieżka ponowienia po odświeżeniu przechodzi tędy drugi raz.
    if (error instanceof ApiError) return error;

    // `response` jest niezdefiniowane, gdy `fetch` w ogóle nie doszedł do skutku.
    // `502` zamiast `0`, bo `0` nie jest poprawnym statusem `Response` i wysadziłby
    // `toRouteResponse` w miejscu, które ma ratować sytuację, a nie ją pogarszać.
    // `Retry-After` dopuszcza sekundy ALBO datę HTTP. Bierzemy wyłącznie
    // pierwszy kształt: data wymagałaby zegara i strefy, a jedyny nasz
    // wystawca (throttler BE) podaje sekundy. Śmieć od proxy ma dać brak
    // wartości, nigdy `NaN` — `NaN` przeciekłby do komunikatu jako „za NaN min".
    // Surowy nagłówek sprawdzany PRZED konwersją, bo `Number(null)` to **zero**,
    // nie `NaN` — naiwne `Number(headers.get(...))` nadawałoby `retryAfter: 0`
    // każdej odpowiedzi błędnej, a `0` znaczy „próbuj teraz", czyli co innego
    // niż „nie wiem". Wywołujący nie miałby jak tych dwóch przypadków odróżnić.
    const surowy = response?.headers.get("retry-after");
    const sekundy = surowy == null ? Number.NaN : Number(surowy);
    const retryAfter = Number.isFinite(sekundy) && sekundy >= 0 ? sekundy : undefined;

    return parseApiError(response?.status ?? 502, error, retryAfter);
  });

  return api;
}

/**
 * Podpisany odnośnik do pliku przychodzi z BE jako **ścieżka, nie adres**:
 * `FileUrlSigner.sign` zwraca `/v1/files/{id}?exp=…&partyId=…&trainerId=…&sig=…`.
 * Włożona wprost w `src` rozwiązałaby się względem origin **FE**, gdzie takiej
 * trasy nie ma — i to bez żadnego błędu, bo puste `<video>` wygląda dokładnie
 * jak brak nagrania. Origin dokłada `API_PUBLIC_URL`, zmienna istniejąca
 * dokładnie po to: `API_URL` bywa siecią prywatną Railway, a ten adres trafia
 * do HTML-a, czyli do przeglądarki użytkownika.
 *
 * `new URL(x, base)` zwraca wejście BEZWZGLĘDNE nietknięte, więc funkcja
 * przeżyje ewentualną zmianę po stronie BE bez podwójnego origin.
 */
export function publicFileUrl(path: string): string {
  return new URL(path, getEnv().API_PUBLIC_URL).toString();
}

/**
 * Reguła D3 specu: **funkcja deklarująca `Promise<… | null>` łapie `404`;
 * każda inna pozwala mu lecieć.**
 *
 * Regułę wyznacza sygnatura, nie ocena piszącego — dzięki temu przepięcie
 * 24 modułów nie wymaga decyzji przy żadnym z nich. Wąska celowo: `orNull`
 * łykający wszystko zamieniałby błędną ścieżkę w kliencie i awarię BE w pusty
 * ekran, czyli w objaw nie do odróżnienia od „nic tu nie ma".
 */
export async function orNull<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
