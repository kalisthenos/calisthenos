import {
  calendarConnectionControllerAuthorize,
  calendarConnectionControllerDisconnect,
  calendarConnectionControllerGet,
  calendarSyncFailuresControllerList,
  calendarSyncFailuresControllerRetry,
} from "@kalisthenos/api-client";
import type { CalendarConnectionView, CalendarSyncFailureView } from "@kalisthenos/api-client";
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

export async function listCalendarSyncFailures(api: Api): Promise<CalendarSyncFailureView[]> {
  const { data } = await calendarSyncFailuresControllerList({ client: api, throwOnError: true });
  return data;
}

export async function retryCalendarSyncFailure(api: Api, id: string): Promise<void> {
  await calendarSyncFailuresControllerRetry({ client: api, path: { id }, throwOnError: true });
}

/**
 * Czego system nie zdołał zrobić — dopełniacz, bo wchodzi po zaprzeczeniu
 * („Nie udało się …").
 *
 * **`Record<string, …>` z gałęzią domyślną, nie `Record<Kind, …>`, i to jest
 * wymóg kontraktu, nie ostrożność.** `kind` jest zadeklarowany jako
 * `x-extensible-enum` (ADR-0042): zbiór ma rosnąć, a konsument jest zobowiązany
 * obsłużyć wartość nieznaną. Mapa wyczerpująca kompilowałaby się dziś i pękała
 * przy pierwszej nowej wartości — u użytkownika, nie u nas.
 *
 * Gałąź domyślna **nie zgaduje, o którą operację chodzi**. Zdanie ogólne jest
 * prawdziwe dla każdej przyszłej wartości; zdanie konkretne byłoby prawdziwe
 * dla trzech dzisiejszych i fałszywe dla czwartej.
 */
const SYNC_FAILURE_KIND_COPY: Record<string, string> = {
  schedule: "wpisać terminu do kalendarza",
  reschedule: "przenieść terminu na nową godzinę",
  cancel: "usunąć odwołanego terminu z kalendarza",
};

export function syncFailureKindCopy(kind: string): string {
  return SYNC_FAILURE_KIND_COPY[kind] ?? "wykonać zmiany tego terminu w kalendarzu";
}

/**
 * Ostrzeżenie nad listą zaległości — albo `null`, gdy nie ma o czym ostrzegać.
 *
 * **Jedyny przypadek, w którym ponowienie kłamie.** Bez podłączonego kalendarza
 * `CalendarSyncService` wychodzi na `credentials === null` i **nie robi nic**,
 * a zdarzenie zostaje uznane za obsłużone — więc pozycja znika z listy, choć
 * u dostawcy nic się nie wydarzyło. Przycisk wyglądałby wtedy jak sprzątanie,
 * a był tylko kasowaniem dowodu.
 *
 * Trafia się tu częściej, niż wygląda: po błędzie `gone` rozłączenie jest
 * jedyną drogą wyjścia (D-24), więc trener ląduje bez połączenia dokładnie
 * wtedy, gdy zaległości jest najwięcej.
 */
export function syncFailuresNotice(
  status: CalendarConnectionView["status"],
  count: number,
): string | null {
  if (count === 0 || status !== "disconnected") return null;

  return (
    "Te wpisy powstały, gdy kalendarz był jeszcze podłączony. Bez połączenia ponowienie " +
    "usunie je z listy, ale NIE zmieni niczego w Google — jeśli terminy nadal tam wiszą, " +
    "połącz konto ponownie albo posprzątaj je ręcznie."
  );
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
