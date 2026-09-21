import {
  consultationSyncControllerRun,
  consultationsControllerCancel,
  consultationsControllerCreate,
  consultationsControllerDocument,
  consultationsControllerGet,
  consultationsControllerList,
  consultationsControllerRemove,
  consultationsControllerReschedule,
  consultationsControllerRespond,
  consultationsControllerSetActionItemStatus,
} from "@kalisthenos/api-client";
import type {
  ConsultationActionItemView,
  ConsultationDetail,
  ConsultationSyncResult,
  ConsultationView,
} from "@kalisthenos/api-client";
import { orNull } from "~/lib/api/client";
import type { Api } from "~/lib/api/client";
import { ApiError } from "~/lib/api/errors";
import type { ConsultationDocForm, TraineeAction } from "~/lib/consultation-types";
import { APP_TIME_ZONE } from "~/lib/format";

/**
 * Typy kontraktu re-eksportowane dla tras: trasa nie importuje pakietu klienta
 * wprost (bramka, która zastąpi `no-direct-db`), a kształt terminu jest
 * własnością kontraktu, nie tego modułu.
 */
export type {
  ConsultationActionItemView,
  ConsultationDetail,
  ConsultationSyncResult,
  ConsultationView,
};
export type ConsultationStatus = ConsultationView["status"];

/**
 * Własny typ błędu obszaru, bo trasy pokazują `userMessage` w formularzu albo
 * w pasku akcji (precedens: `PlanError`, `WorkoutSaveError`). Źródłem
 * `userMessage` jest `message` z koperty BE — po polsku i dla użytkownika.
 */
export class ConsultationError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

// ============================================================
// Czas: moment BE ↔ czas ścienny FE
// ============================================================

/**
 * BE mówi MOMENTAMI (`timestamptz`, ISO z `Z`; harmonogram o 18:00 daje latem
 * `16:00Z`), a cały FE — od `<input type="datetime-local">` po `fmtDateTime`
 * i grupowanie siatki po `getUTCDate` — trzyma godzinę jako CZAS ŚCIENNY
 * zapisany w komponentach UTC (`APP_TIME_ZONE` w `format.ts`). Do integracji
 * obie strony były jednym procesem i konwencja nigdy nie przekraczała granicy;
 * teraz przekracza ją w każdym żądaniu. Przeliczenie mieszka TUTAJ, na brzegu
 * modułu — jak origin adresów plików (`publicFileUrl`) — więc trasy
 * i komponenty nie wiedzą, że po drugiej stronie stoi inna strefa. Bez tego
 * termin z harmonogramu ustawiony na 18:00 pokazywałby się latem jako 16:00.
 *
 * `Intl` zamiast własnej tabeli zmian czasu: reguły DST należą do bazy stref
 * środowiska, nie do tego pliku.
 */
const WALL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Składowe czasu ściennego strefy aplikacji dla momentu, zapisane jako „UTC” (ms). */
function wallClockMs(instantMs: number): number {
  const parts = WALL_CLOCK.formatToParts(new Date(instantMs));
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(at("year"), at("month") - 1, at("day"), at("hour"), at("minute"), at("second"));
}

/** Przesunięcie strefy aplikacji w danym momencie (ms). `Intl` oddaje sekundy, więc liczone na pełnych. */
function offsetAt(instantMs: number): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallClockMs(whole) - whole;
}

/** Moment (ISO z BE) → ten sam czas ścienny strefy aplikacji zapisany jako ISO „UTC” (konwencja FE). */
export function toAppWallClock(instantISO: string): string {
  return new Date(wallClockMs(new Date(instantISO).getTime())).toISOString();
}

/**
 * Czas ścienny w konwencji FE (ISO „UTC”) → prawdziwy moment w strefie aplikacji.
 * Dwa przejścia, jak `instantOf` po stronie BE: przesunięcie zależy od momentu,
 * który dopiero liczymy, więc jedno przejście myli się przez godzinę wokół
 * zmiany czasu.
 */
export function fromAppWallClock(wallClockISO: string): string {
  const wall = new Date(wallClockISO).getTime();
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first)).toISOString();
}

/**
 * „Teraz” **w konwencji tego modułu** — tej samej, w której wychodzi stąd
 * `scheduledAt`.
 *
 * Istnieje, bo `Date.now()` jest PRAWDZIWYM momentem, a `scheduledAt` opuszcza
 * `withAppWallClock` jako czas ŚCIENNY zapisany w komponentach UTC. Porównanie
 * jednego z drugim myli się dokładnie o offset strefy — dwie godziny latem,
 * godzinę zimą — i tak było w trzech miejscach naraz, aż do D-FE-3: spotkanie
 * sprzed półtorej godziny siedziało latem w sekcji „Nadchodzące", a etykieta
 * „do udokumentowania" zapalała się u trenera z dwugodzinnym opóźnieniem.
 *
 * **Ilekroć porównujesz coś z `scheduledAt`, bierzesz to, nie `Date.now()`.**
 * Odwrotność też jest regułą: momentu z BE (np. `nowISO` dla zapytania o zakres)
 * NIE przeliczamy — tam konwencja jest ta druga.
 *
 * Milisekundy są obcinane do pełnych sekund, bo `Intl` nie oddaje ułamków —
 * granica „minione/nadchodzące" tego nie zauważa.
 */
export function appWallClockNow(now: Date = new Date()): number {
  return wallClockMs(now.getTime());
}

const DATE_TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Wartość `<input type="datetime-local">` („YYYY-MM-DDTHH:MM”, czas ścienny) →
 * moment dla BE. Kształt sprawdzany tutaj, bo `rescheduleOccurrence` bierze go
 * z formularza bez Zoda, a `new Date("…")` z byle czego rzuca dopiero przy
 * `toISOString` — ekranem błędu zamiast zdaniem w formularzu.
 */
function instantFromLocalInput(local: string): string {
  if (!DATE_TIME_LOCAL.test(local)) {
    throw new ConsultationError("bad datetime", "Niepoprawna data/godzina.");
  }
  return fromAppWallClock(`${local}:00.000Z`);
}

/**
 * Tylko `scheduledAt` — jedyny moment, który UI czyta jako godzinę ścienną.
 * `resolvedAt` punktów zostaje momentem: żaden ekran go nie pokazuje.
 */
function withAppWallClock<T extends { scheduledAt: string }>(row: T): T {
  return { ...row, scheduledAt: toAppWallClock(row.scheduledAt) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftISO(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

// ============================================================
// Odczyt
// ============================================================

/** Zakres w konwencji FE (czas ścienny jako ISO „UTC”) — tak liczy `monthRangeUTC`. */
export interface DateRange {
  fromISO: string;
  toISO: string;
}

/**
 * Terminy w zakresie `[fromISO, toISO]` — jedno `GET /v1/consultations` dla obu
 * ról, bo kontrakt nie rozdziela tras: KTO pyta, rozstrzyga token. Trener
 * dostaje terminy WSZYSTKICH swoich podopiecznych (nazwa w `trainee`) — to
 * dawne `listTrainerOccurrencesInRange`; podopieczny wyłącznie własne — dawne
 * `listOccurrencesForTrainee`. Odwołane pomija BE; stronicowania nie ma, bo
 * wynik ogranicza zakres, zamknięty z obu stron (`docs/04` §Konsultacje).
 * Kolejność z kontraktu: rosnąco po terminie, `id` rozstrzyga remis.
 */
export async function listOccurrencesInRange(
  api: Api,
  range: DateRange,
): Promise<ConsultationView[]> {
  const { data } = await consultationsControllerList({
    client: api,
    query: { from: fromAppWallClock(range.fromISO), to: fromAppWallClock(range.toISO) },
    throwOnError: true,
  });
  return data.map(withAppWallClock);
}

/**
 * Okno list liczonych od „teraz”: kontrakt wymaga zakresu zamkniętego z obu
 * stron, a dawne zapytania (`listOccurrencesForTrainer` bez zakresu,
 * `nextUpcomingForTrainee` bez górnej granicy) go nie miały. Rok — bo horyzont
 * materializacji BE to 84 dni, a termin poza serią wolno umówić dalej.
 */
export const LIST_WINDOW_DAYS = 365;

/**
 * Terminy jednej pary z perspektywy trenera — ten sam `GET /v1/consultations`
 * co kalendarz zbiorczy (kontrakt nie ma listy per podopieczny), zawężony do
 * `traineeId` TUTAJ, jednym wywołaniem, nie N. `nowISO` to prawdziwy moment
 * (`new Date().toISOString()`), bez przeliczenia — okno to rok wstecz i rok
 * w przód. Do integracji lista pary nie miała zakresu i niosła też odwołane;
 * odwołanych i tak nikt nie pokazywał, a historia starsza niż rok jest luką
 * zgłoszoną w raporcie, nie cichą stratą.
 */
export async function listOccurrencesForTrainer(
  api: Api,
  traineeId: string,
  opts: { nowISO: string },
): Promise<ConsultationView[]> {
  const { data } = await consultationsControllerList({
    client: api,
    query: {
      from: shiftISO(opts.nowISO, -LIST_WINDOW_DAYS),
      to: shiftISO(opts.nowISO, LIST_WINDOW_DAYS),
    },
    throwOnError: true,
  });
  return data.filter((c) => c.trainee.id === traineeId).map(withAppWallClock);
}

const LIVE_STATUSES: ReadonlySet<ConsultationStatus> = new Set([
  "planned",
  "confirmed",
  "change_requested",
]);

/** Trzy akcje kontraktu, które wolno wykonać podopiecznemu. Reszta jest trenera. */
const TRAINEE_ACTIONS: ReadonlySet<string> = new Set(["confirm", "request_change", "decline"]);

/**
 * Czy podopieczny ma cokolwiek do zrobienia z tym terminem — **z listy
 * `allowedActions` wyliczonej przez BE, nie ze statusu**. To zamiennik dawnego
 * guardu `canTraineeAct` z `consultation-types.ts`, który tabelę przejść trzymał
 * po tej stronie: kontrakt niesie ją teraz przy każdym terminie, a dwie kopie
 * tej samej tabeli rozjeżdżają się w ciszy (BE nie daje dziś akcji podopiecznego
 * dla `confirmed`, dawny guard je dopuszczał).
 *
 * Bierze cokolwiek z `allowedActions` — także `ConsultationDetail`, bo oba
 * widoki niosą to pole.
 */
export function canTraineeRespond(c: { allowedActions: readonly string[] }): boolean {
  return c.allowedActions.some((a) => TRAINEE_ACTIONS.has(a));
}

export interface UpcomingConsultations {
  /** Najbliższy żywy termin (`planned`/`confirmed`/`change_requested`) po `nowISO` albo `null`. */
  next: ConsultationView | null;
  /** Ile nadchodzących czeka na reakcję podopiecznego (`planned`). */
  pending: number;
}

/**
 * Jedno wywołanie zamiast dwóch dawnych zapytań (`nextUpcomingForTrainee`,
 * `countPendingForTrainee`): lista od `nowISO` (prawdziwy moment, bez
 * przeliczenia) do roku w przód, z której moduł wybiera najbliższy żywy termin
 * i liczy oczekujące. `traineeId` zawęża do pary — podaje trener (przegląd
 * klienta); podopieczny go nie podaje, bo token i tak zawęża do własnych.
 *
 * Różnica wobec legacy: `pending` liczy wyłącznie NADCHODZĄCE `planned` —
 * przeszły `planned` to dla trenera „do udokumentowania”, nie „do
 * potwierdzenia”. Licznik nawigacji podopiecznego (z przeszłymi, jak liczył
 * legacy) niesie `TraineeNavView.pendingConsultations` z `views.ts`.
 */
export async function loadUpcomingConsultations(
  api: Api,
  opts: { nowISO: string; traineeId?: string },
): Promise<UpcomingConsultations> {
  const { data } = await consultationsControllerList({
    client: api,
    query: { from: opts.nowISO, to: shiftISO(opts.nowISO, LIST_WINDOW_DAYS) },
    throwOnError: true,
  });
  const rows = (
    opts.traineeId == null ? data : data.filter((c) => c.trainee.id === opts.traineeId)
  ).map(withAppWallClock);

  // Najwcześniejszy z żywych liczony tu, nie brany z pozycji zerowej: to, co
  // funkcja obiecuje, nie ma zależeć od kolejności transportu.
  let next: ConsultationView | null = null;
  for (const row of rows) {
    if (!LIVE_STATUSES.has(row.status)) continue;
    if (next == null || row.scheduledAt < next.scheduledAt) next = row;
  }

  return { next, pending: rows.filter((c) => c.status === "planned").length };
}

/**
 * Szczegół z punktami akcji i nazwą podopiecznego. Zakres tenanta rozstrzyga
 * BE: cudzy termin — także termin kolegi u tego samego trenera, gdy pyta
 * podopieczny — jest nieodróżnialny od nieistniejącego (`404`), tu `null`
 * przez `orNull`. Dawne `trainerId`/`traineeId` w argumentach zniknęły razem
 * z filtrem tenanta; trasa trenera sprawdza zgodność `trainee.id` ze ścieżką
 * sama, bo to jej adres, nie kontrakt, może być pomylony.
 */
export async function getConsultationDetail(
  api: Api,
  consultationId: string,
): Promise<ConsultationDetail | null> {
  const detail = await orNull(
    consultationsControllerGet({
      client: api,
      path: { id: consultationId },
      throwOnError: true,
    }).then((r) => r.data),
  );
  return detail == null ? null : withAppWallClock(detail);
}

// ============================================================
// Zapis
// ============================================================

/**
 * Wąski `catch`: trasy pokazują `userMessage` w formularzu albo pasku akcji,
 * więc własny typ dostają `400` (walidacja BE ostrzejsza niż Zod — np. notatka
 * wymagana przy prośbie o zmianę, czas trwania 5–480 min), `404` (cudzy albo
 * nieistniejący termin lub podopieczny — §2 `docs/04`) i `409` (niedozwolone
 * przejście, odwołanie udokumentowanego, trwający przebieg synchronizacji).
 * Reszta leci `ApiError`-em — awaria BE ma zostać awarią.
 */
function toConsultationError(e: unknown): never {
  if (e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 409)) {
    throw new ConsultationError(e.code, e.message);
  }
  throw e;
}

export interface CreateAdhocConsultationInput {
  traineeId: string;
  form: ConsultationDocForm;
  documented: boolean;
}

/**
 * Termin poza serią — od razu `planned` albo od razu `documented`. Ciało
 * składane pole po polu, bo BE odrzuca pola spoza DTO (`400`), a
 * `ConsultationDocForm` jest szerszy niż `CreateConsultationDto`: `title` nie
 * istnieje w `/v1` (BE nadaje własny), `periodFrom`/`periodTo` kontrakt
 * przemilcza, a statusów punktów DTO nie niesie — idą same treści. Podsumowanie
 * i punkty WYŁĄCZNIE dla `documented`: przy `planned` BE odmawia (`409`).
 * Przynależność podopiecznego sprawdza BE (`404`), nie ten moduł.
 */
export async function createAdhocConsultation(
  api: Api,
  input: CreateAdhocConsultationInput,
): Promise<string> {
  const f = input.form;
  try {
    const { data } = await consultationsControllerCreate({
      client: api,
      body: {
        traineeId: input.traineeId,
        scheduledAt: instantFromLocalInput(f.scheduledAt),
        durationMin: f.durationMin,
        meetingUrl: f.meetingUrl ?? null,
        status: input.documented ? "documented" : "planned",
        ...(input.documented
          ? { summary: f.summary, actionItems: f.items.map((it) => it.body) }
          : {}),
      },
      throwOnError: true,
    });
    return data.id;
  } catch (e) {
    return toConsultationError(e);
  }
}

export interface DocumentConsultationInput {
  consultationId: string;
  form: ConsultationDocForm;
}

/**
 * Podsumowanie i punkty — „podmienia dotychczasowe”, więc wolno powtórzyć
 * (status `documented` się wtedy nie zmienia). Z formularza idą WYŁĄCZNIE
 * `summary` i treści punktów: DTO nie niesie terminu/czasu/odnośnika (te
 * zmienia `rescheduleOccurrence`), tytułu, okresu ani statusów punktów —
 * patrz luki S3 w raporcie fali. Odwołanego udokumentować nie wolno (`409`).
 */
export async function documentConsultation(
  api: Api,
  input: DocumentConsultationInput,
): Promise<void> {
  try {
    await consultationsControllerDocument({
      client: api,
      path: { id: input.consultationId },
      body: {
        summary: input.form.summary,
        actionItems: input.form.items.map((it) => it.body),
      },
      throwOnError: true,
    });
  } catch (e) {
    toConsultationError(e);
  }
}

export interface RescheduleOccurrenceInput {
  consultationId: string;
  /** Wartość `<input type="datetime-local">` — czas ścienny „YYYY-MM-DDTHH:MM”. */
  scheduledAtLocal: string;
  durationMin?: number;
}

/**
 * Nowy moment (i opcjonalnie czas trwania). Co robił dawny `UPDATE` — powrót
 * do `planned`, wyczyszczenie notatki podopiecznego, zdarzenie dla kalendarza
 * — robi BE. `meetingUrl` nie idzie w ciele: brak klucza to „zostaw”.
 */
export async function rescheduleOccurrence(
  api: Api,
  input: RescheduleOccurrenceInput,
): Promise<void> {
  const scheduledAt = instantFromLocalInput(input.scheduledAtLocal);
  try {
    await consultationsControllerReschedule({
      client: api,
      path: { id: input.consultationId },
      body: {
        scheduledAt,
        ...(input.durationMin != null ? { durationMin: input.durationMin } : {}),
      },
      throwOnError: true,
    });
  } catch (e) {
    toConsultationError(e);
  }
}

/**
 * Odwołanie. `409` dla udokumentowanego; powtórne odwołanie NIE daje `409`
 * (ponowienie po zerwanym połączeniu to nie naruszenie niezmiennika).
 * Zdarzenie w kalendarzu zdejmuje BE przez outbox — trasa niczego nie dosyła.
 */
export async function cancelOccurrence(api: Api, consultationId: string): Promise<void> {
  try {
    await consultationsControllerCancel({
      client: api,
      path: { id: consultationId },
      throwOnError: true,
    });
  } catch (e) {
    toConsultationError(e);
  }
}

export interface RespondToOccurrenceInput {
  consultationId: string;
  action: TraineeAction;
  note?: string;
}

/**
 * Reakcja podopiecznego. Dozwolone przejścia sprawdza BE (`409` przy
 * niedozwolonym), więc dawny guard `canTraineeAct` przestał tu stać. Notatka
 * jest WYMAGANA przy `request_change` (BE: `400` bez treści) i pomijana przy
 * pozostałych — do ciała idzie tylko wtedy, gdy jest, bo klucz z `undefined`
 * serializator i tak by wysłał jako brak, a pusty łańcuch to `400`.
 */
export async function respondToOccurrence(
  api: Api,
  input: RespondToOccurrenceInput,
): Promise<void> {
  try {
    await consultationsControllerRespond({
      client: api,
      path: { id: input.consultationId },
      body: {
        response: input.action,
        ...(input.note != null && input.note.length > 0 ? { note: input.note } : {}),
      },
      throwOnError: true,
    });
  } catch (e) {
    toConsultationError(e);
  }
}

export interface SetActionItemStatusInput {
  consultationId: string;
  itemId: string;
  status: ConsultationActionItemView["status"];
}

/** Przełącza punkt „do poprawy” — `open`/`resolved`. Własność sprawdza BE (`404`). */
export async function setActionItemStatus(
  api: Api,
  input: SetActionItemStatusInput,
): Promise<void> {
  try {
    await consultationsControllerSetActionItemStatus({
      client: api,
      path: { id: input.consultationId, itemId: input.itemId },
      body: { status: input.status },
      throwOnError: true,
    });
  } catch (e) {
    toConsultationError(e);
  }
}

/**
 * Usuwa termin wraz z punktami (`204`). Dawny `boolean` „czy coś usunięto”
 * zniknął: cudzy albo nieistniejący to `404` z BE, tu `ConsultationError`
 * do paska akcji — jak `deletePlan`.
 */
export async function deleteConsultation(api: Api, consultationId: string): Promise<void> {
  try {
    await consultationsControllerRemove({
      client: api,
      path: { id: consultationId },
      throwOnError: true,
    });
  } catch (e) {
    toConsultationError(e);
  }
}

// ============================================================
// Kalendarz zewnętrzny
// ============================================================

/**
 * Ręczne uzupełnienie zaległości pary w kalendarzu zewnętrznym — dawne
 * `syncBackfillPair` z `google/sync.ts`, dziś w całości po stronie BE
 * (`POST /v1/trainees/{traineeId}/consultation-sync`). Zwykłe mutacje niczego
 * tu nie wołają: każdą wypycha BE przez outbox sam, więc `syncUpsertOne`
 * i `syncCancelOne` zniknęły bez zamiennika. Wyłączona integracja albo brak
 * połączenia to `200` z `connected: false`, nie błąd — trasa mówi o tym wprost
 * zamiast „0 z 0”. `409`, gdy przebieg dla tej pary już trwa (zamek po stronie
 * BE) — komunikat BE do paska akcji.
 */
export async function runConsultationSync(
  api: Api,
  traineeId: string,
): Promise<ConsultationSyncResult> {
  try {
    const { data } = await consultationSyncControllerRun({
      client: api,
      path: { traineeId },
      throwOnError: true,
    });
    return data;
  } catch (e) {
    return toConsultationError(e);
  }
}
