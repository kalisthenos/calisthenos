import {
  notetakerControllerDisable,
  notetakerControllerEnable,
  notetakerControllerGet,
} from "@kalisthenos/api-client";
import type { NotetakerIntegrationView } from "@kalisthenos/api-client";
import type { Api } from "~/lib/api/client";

/**
 * AI Notetaker — jedyne wejście FE do tego obszaru.
 *
 * **Nie `meetingbaas.ts`**: dostawca jest szczegółem BE, nigdy częścią nazwy
 * (ta sama zasada co w `calendar.ts`, ADR-0012 po stronie BE) — tu jeszcze
 * ostrzejsza, bo MeetingBaaS nie przecieka do kontraktu ani jako WARTOŚĆ.
 * `CalendarConnectionView.provider` przynajmniej wychodzi do FE jako pole;
 * `NotetakerIntegrationView` niesie wyłącznie `enabled`.
 */

export async function getNotetakerStatus(api: Api): Promise<NotetakerIntegrationView> {
  // `throwOnError: true` jawnie, choć klient ma je w konfiguracji: generyk
  // funkcji SDK domyślnie schodzi do `false`, więc bez tego `data` typuje się
  // jako `… | undefined`. Zero zmiany w czasie wykonania.
  const { data } = await notetakerControllerGet({ client: api, throwOnError: true });
  return data;
}

/**
 * Włącza integrację. Backend odmawia `409 NOTETAKER_REQUIRES_CALENDAR`, gdy
 * trener nie ma podłączonego kalendarza produkującego odnośnik do spotkania —
 * notetaker nie ma pod jaki adres wysłać bota. Błąd leci wyjątkiem `ApiError`
 * nierozpakowanym: ten moduł go nie mapuje, wywołujący czyta `error.code`.
 */
export async function enableNotetaker(api: Api): Promise<NotetakerIntegrationView> {
  const { data } = await notetakerControllerEnable({ client: api, throwOnError: true });
  return data;
}

/** Powtórzenie jest bezskutkowe — wyłączenie już wyłączonej integracji nie jest błędem. */
export async function disableNotetaker(api: Api): Promise<void> {
  await notetakerControllerDisable({ client: api, throwOnError: true });
}
