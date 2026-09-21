import {
  calendarConnectionControllerAuthorize,
  calendarConnectionControllerDisconnect,
  calendarConnectionControllerGet,
} from "@kalisthenos/api-client";
import type { CalendarConnectionView } from "@kalisthenos/api-client";
import type { Api } from "~/lib/api/client";

/**
 * Kalendarz zewnętrzny — jedyne wejście FE do tego obszaru.
 *
 * **Nie `google.ts`**: dostawca jest WARTOŚCIĄ pola `provider`, nigdy częścią
 * nazwy (ADR-0012 po stronie BE). Kontrakt typuje `provider` jako `string`,
 * a nie enum, dokładnie po to, żeby drugi dostawca był zmianą addytywną.
 */

/** Adres ekranu zgody wraz z ciastkiem, które musi trafić do przeglądarki. */
export interface CalendarAuthorization {
  readonly url: string;
  readonly setCookie: string[];
}

export async function getCalendarConnection(api: Api): Promise<CalendarConnectionView> {
  // `throwOnError: true` jawnie, choć klient ma je w konfiguracji: generyk
  // funkcji SDK domyślnie schodzi do `false`, więc bez tego `data` typuje się
  // jako `… | undefined`. Zero zmiany w czasie wykonania.
  const { data } = await calendarConnectionControllerGet({ client: api, throwOnError: true });
  return data;
}

/**
 * Rozpoczyna zgodę i wydobywa ciastko, które BE ustawił przy tej odpowiedzi.
 *
 * **Jedyne miejsce w tej warstwie, które przenosi ciastko BE dalej**, i jest to
 * wyjątek świadomy. Reguła („token w ciele, nie w ciastku") istnieje, bo FE woła
 * BE serwer-do-serwera i ciastka BE do niczego mu się nie przydają. Tutaj jest
 * odwrotnie: ciastko z nonce'em jest przeznaczone dla PRZEGLĄDARKI, a serwer FE
 * jest po drodze. Rozdzielenie adresu zgody od ciastka nie wchodzi w grę —
 * wiąże je ze sobą `state`, a docblock `CalendarAuthorizeResponse.url` w
 * kontrakcie mówi to wprost.
 *
 * `getSetCookie()`, nie `headers.get("set-cookie")`: tylko ono nie skleja
 * powtórzonego nagłówka w jeden napis.
 */
export async function startCalendarAuthorization(api: Api): Promise<CalendarAuthorization> {
  const { data, response } = await calendarConnectionControllerAuthorize({
    client: api,
    throwOnError: true,
  });
  return { url: data.url, setCookie: response.headers.getSetCookie() };
}

export async function disconnectCalendar(api: Api): Promise<void> {
  await calendarConnectionControllerDisconnect({ client: api, throwOnError: true });
}

/** Co ekran integracji pokazuje dla danego stanu połączenia. */
export interface CalendarConnectionCopy {
  /** Zdanie ostrzegawcze albo `null`, gdy nie ma o czym ostrzegać. */
  readonly ostrzezenie: string | null;
  /** Czy pokazać etykietę połączonego konta. `broken` TEŻ ją pokazuje. */
  readonly pokazKonto: boolean;
  /** Czy przycisk zgody ma mówić „połącz ponownie", a nie „połącz". */
  readonly polaczOdNowa: boolean;
  /** Czy pokazać „Rozłącz". */
  readonly mozliwoscRozlaczenia: boolean;
}

/**
 * Trzy stany kontraktu → trzy różne ekrany (D-FE-2).
 *
 * Ta trasa liczyła dotąd jedną regułę — `status !== "disconnected"` — i przez
 * nią **`broken` wyglądał identycznie jak `connected`**: „Połączone konto:
 * jan@…" i przycisk „Rozłącz". Nic się przy tym nie synchronizowało. BE
 * zbudował ten stan celowo i ostrzega przed dokładnie tym skutkiem w docblocku
 * `connectionIsDead` (`calendar-sync.service.ts`): „połączenie, które wiecznie
 * nic nie synchronizuje, podczas gdy interfejs mówi »połączone« — czyli wadę
 * 3 legacy słowo w słowo".
 *
 * **Dlaczego `broken` dostaje OBIE drogi wyjścia naraz.** Kontrakt nie mówi,
 * co połączenie zepsuło, a naprawa zależy właśnie od tego:
 *
 * - `auth-permanent` (cofnięta zgoda — przypadek częstszy): wystarcza ponowna
 *   zgoda, bo `save()` po stronie BE zeruje `broken_at`;
 * - `gone` (kalendarz skasowany): sama zgoda NIE wystarcza, bo w wierszu
 *   zostaje `calendar_id` wskazujący nieistniejący kalendarz — trzeba najpierw
 *   rozłączyć, żeby kolejna zgoda założyła wiersz z wartością domyślną.
 *
 * Ekran nie umie ich rozróżnić, więc oferuje obie i nie zgaduje. Wariant
 * „zawsze rozłącz" byłby radą błędną dla przypadku częstszego, a „zawsze połącz
 * ponownie" — pętlą bez wyjścia dla rzadszego.
 */
export function calendarConnectionCopy(
  status: CalendarConnectionView["status"],
): CalendarConnectionCopy {
  if (status === "broken") {
    return {
      ostrzezenie:
        "Połączenie z Google wymaga odnowienia — terminy nie trafiają teraz do kalendarza. " +
        "Połącz ponownie; jeśli to nie pomoże, najpierw rozłącz konto.",
      pokazKonto: true,
      polaczOdNowa: true,
      mozliwoscRozlaczenia: true,
    };
  }

  return {
    ostrzezenie: null,
    pokazKonto: status === "connected",
    polaczOdNowa: false,
    mozliwoscRozlaczenia: status === "connected",
  };
}
